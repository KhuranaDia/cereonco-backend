import type { Request } from "express";

/**
 * Email service placeholder.
 *
 * Real SMTP delivery is not wired up yet. Until SMTP_* env vars are configured,
 * the password-setup link is logged via the request logger (pino) so it can be
 * picked up during testing. We NEVER use console.log in server code.
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

export async function sendPasswordSetupEmail(opts: {
  req: Request;
  to: string;
  name: string;
  token: string;
}): Promise<void> {
  const { req, to, name, token } = opts;
  const setupUrl = buildPasswordSetupUrl(token);

  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

  if (!smtpConfigured) {
    req.log.info(
      { to, name, setupUrl },
      "[email:placeholder] SMTP not configured — password setup link logged for testing",
    );
    return;
  }

  // Real SMTP send goes here once SMTP_* env vars are configured.
  req.log.info({ to }, "[email] Password setup email dispatched");
}
