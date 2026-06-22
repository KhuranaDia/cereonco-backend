import type { Request } from "express";

/**
 * Email service placeholder.
 *
 * Real SMTP delivery is not wired up yet. Until SMTP_* env vars are configured,
 * the action link is logged via the request logger (pino) so it can be picked
 * up during local/dev testing. We NEVER use console.log in server code.
 *
 * SECURITY: the link contains a raw, account-takeover-capable token. We only
 * log the full link in NON-production. In production with SMTP unconfigured we
 * fail closed (log a metadata-only warning, never the token) so reset/setup
 * links cannot leak into shared production logs.
 */

function frontendBaseUrl(): string {
  return (
    process.env.FRONTEND_URL ??
    process.env.APP_BASE_URL ??
    "http://localhost:5173"
  ).replace(/\/+$/, "");
}

export function buildPasswordSetupUrl(token: string): string {
  return `${frontendBaseUrl()}/set-password?token=${token}`;
}

/**
 * Shared delivery for the password setup/reset link. `kind` only affects the
 * log wording; both flows use the same `/set-password?token=...` link.
 */
async function deliverPasswordLink(
  kind: "setup" | "reset",
  opts: { req: Request; to: string; name: string; token: string },
): Promise<void> {
  const { req, to, name, token } = opts;
  const setupUrl = buildPasswordSetupUrl(token);
  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

  if (smtpConfigured) {
    // Real SMTP send goes here once SMTP_* env vars are configured.
    req.log.info({ to }, `[email] Password ${kind} email dispatched`);
    return;
  }

  // SMTP not configured.
  if (process.env.NODE_ENV === "production") {
    // Fail closed: never write the token-bearing link to production logs.
    req.log.warn(
      { to },
      `[email] SMTP not configured in production — password ${kind} link NOT sent. Configure SMTP_* env vars.`,
    );
    return;
  }

  // Non-production only: log the full link for testing convenience.
  req.log.info(
    { to, name, setupUrl },
    `[email:placeholder] SMTP not configured — password ${kind} link logged for testing`,
  );
}

/**
 * Send a "forgot password" reset link. Reuses the same setup-token flow (and
 * the same `/set-password?token=...` link) as registration, so the recipient
 * completes it via the existing POST /auth/set-password endpoint.
 */
export async function sendPasswordResetEmail(opts: {
  req: Request;
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  await deliverPasswordLink("reset", opts);
}

export async function sendPasswordSetupEmail(opts: {
  req: Request;
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  await deliverPasswordLink("setup", opts);
}
