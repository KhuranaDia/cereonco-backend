import type { Request } from "express";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Email service.
 *
 * Real SMTP delivery is used when SMTP_* env vars are configured. The transport
 * is built from SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS and messages are
 * sent FROM SMTP_FROM (falling back to SMTP_USER). Credentials are read from the
 * environment only — never hardcoded. We NEVER use console.log in server code.
 *
 * SECURITY: the link contains a raw, account-takeover-capable token.
 * - SMTP configured  → send the link by email (not logged).
 * - SMTP missing + production → fail closed: log a metadata-only warning, never
 *   the token, so reset/setup links cannot leak into shared production logs.
 * - SMTP missing + non-production → log the full link for local/dev testing.
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

/** True when the minimum SMTP config (host) is present. */
function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

let cachedTransporter: Transporter | null = null;

/** Lazily build (and cache) the nodemailer transport from env config. */
function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    // 465 = implicit TLS; everything else uses STARTTLS upgrade.
    secure: port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });

  return cachedTransporter;
}

function fromAddress(): string {
  return (
    process.env.SMTP_FROM ??
    process.env.SMTP_USER ??
    "no-reply@cereonco.local"
  );
}

function renderEmail(
  kind: "setup" | "reset",
  name: string,
  setupUrl: string,
): { subject: string; text: string; html: string } {
  const action = kind === "setup" ? "set up your password" : "reset your password";
  const subject =
    kind === "setup"
      ? "Set up your CereOnco Community account"
      : "Reset your CereOnco Community password";

  const text = `Hi ${name},\n\nUse the link below to ${action}. This link expires in 24 hours and can be used once.\n\n${setupUrl}\n\nIf you did not request this, you can safely ignore this email.\n\n— CereOnco Community`;

  const html = `<p>Hi ${name},</p><p>Use the button below to ${action}. This link expires in 24 hours and can be used once.</p><p><a href="${setupUrl}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px">${kind === "setup" ? "Set password" : "Reset password"}</a></p><p>Or paste this link into your browser:<br><a href="${setupUrl}">${setupUrl}</a></p><p>If you did not request this, you can safely ignore this email.</p><p>— CereOnco Community</p>`;

  return { subject, text, html };
}

/**
 * Shared delivery for the password setup/reset link. `kind` only affects the
 * email wording; both flows use the same `/set-password?token=...` link.
 */
async function deliverPasswordLink(
  kind: "setup" | "reset",
  opts: { req: Request; to: string; name: string; token: string },
): Promise<void> {
  const { req, to, name, token } = opts;
  const setupUrl = buildPasswordSetupUrl(token);

  if (smtpConfigured()) {
    const { subject, text, html } = renderEmail(kind, name, setupUrl);
    try {
      await getTransporter().sendMail({
        from: fromAddress(),
        to,
        subject,
        text,
        html,
      });
      // Metadata only — never log the token-bearing link.
      req.log.info({ to }, `[email] Password ${kind} email sent`);
    } catch (err) {
      // Fail safe: log (without leaking the token) and let the calling flow
      // continue, rather than 500-ing registration/forgot-password on a
      // transient SMTP error after the account row already exists.
      req.log.error(
        { to, err: err instanceof Error ? err.message : String(err) },
        `[email] Failed to send password ${kind} email via SMTP`,
      );
    }
    return;
  }

  // SMTP not configured.
  if (process.env.NODE_ENV === "production") {
    // Fail closed: never write the token-bearing link to production logs.
    req.log.warn(
      { to },
      `[email] SMTP not configured in production — password ${kind} link NOT sent. Configure SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM.`,
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
