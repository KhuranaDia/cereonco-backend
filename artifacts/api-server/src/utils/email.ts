import type { Request } from "express";
import nodemailer, {
  type Transporter,
  type SentMessageInfo,
} from "nodemailer";
import { logger } from "../lib/logger";

/**
 * Email service.
 *
 * Real SMTP delivery is used when SMTP_* env vars are configured. The transport
 * is built from SMTP_HOST / SMTP_PORT / SMTP_USER / (SMTP_PASS or SMTP_PASSWORD)
 * and messages are sent FROM SMTP_FROM (falling back to SMTP_USER). Credentials
 * are read from the environment only — never hardcoded. We NEVER use
 * console.log in server code.
 *
 * SECURITY: the link contains a raw, account-takeover-capable token.
 * - SMTP configured  → send the link by email (not logged).
 * - SMTP missing + production → fail closed: log a metadata-only warning, never
 *   the token, so reset/setup links cannot leak into shared production logs.
 * - SMTP missing + non-production → log the full link for local/dev testing.
 */

/** Read the SMTP password from either supported env var name. */
function smtpPassword(): string | undefined {
  return process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
}

/** Result metadata returned by nodemailer, safe to log / return (no secrets). */
function sendResultMeta(info: SentMessageInfo): {
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
} {
  return {
    messageId: info.messageId ?? "",
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
    response: info.response ?? "",
  };
}

/**
 * Validate that a candidate base URL is a well-formed http(s) URL. Only the
 * request's Origin header (browser-controlled, not arbitrary request-body input)
 * is ever passed here, so this guards against malformed/missing origins.
 */
function sanitizeOrigin(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

const DEFAULT_FRONTEND_ORIGIN = "http://localhost:5173";

/**
 * Build the set of frontend origins that are allowed to appear as the host of a
 * token-bearing email link. Always includes FRONTEND_URL, TEST_FRONTEND_URL and
 * the local dev default; ALLOWED_FRONTEND_ORIGINS (comma-separated) adds extra
 * production origins. Each entry is normalized to its bare origin for matching.
 */
function allowedFrontendOrigins(): Set<string> {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.TEST_FRONTEND_URL,
    DEFAULT_FRONTEND_ORIGIN,
    ...(process.env.ALLOWED_FRONTEND_ORIGINS?.split(",") ?? []),
  ];
  const allowed = new Set<string>();
  for (const candidate of candidates) {
    const origin = sanitizeOrigin(candidate?.trim());
    if (origin) allowed.add(origin);
  }
  return allowed;
}

/**
 * Reusable resolver for the frontend base URL used to build any email action
 * link (password setup, password reset, future auth emails). Single source of
 * truth — do not duplicate this logic elsewhere.
 *
 * Preferred order:
 *   1. req.headers.origin   (only when it matches an allowed frontend origin)
 *   2. process.env.FRONTEND_URL
 *   3. process.env.TEST_FRONTEND_URL
 *   4. http://localhost:5173
 *
 * SECURITY: only the browser-set Origin header is ever consulted from the
 * request — request-body input is never used. The Origin is additionally
 * checked against an allowlist (FRONTEND_URL / TEST_FRONTEND_URL /
 * ALLOWED_FRONTEND_ORIGINS / localhost dev default) before it is trusted as a
 * link host. This blocks Origin-header poisoning: an attacker who POSTs
 * /auth/forgot-password with a victim's email and a forged Origin must not be
 * able to redirect the victim's reset-token link to an attacker-controlled
 * domain. A non-allowed Origin falls back to the configured defaults.
 */
export function getFrontendBaseUrl(req?: Request): string {
  const requestOrigin = sanitizeOrigin(req?.headers.origin);
  const trustedOrigin =
    requestOrigin && allowedFrontendOrigins().has(requestOrigin)
      ? requestOrigin
      : null;
  const base =
    trustedOrigin ??
    process.env.FRONTEND_URL ??
    process.env.TEST_FRONTEND_URL ??
    DEFAULT_FRONTEND_ORIGIN;
  return base.replace(/\/+$/, "");
}

/** Frontend page that handles each password email action. */
function passwordActionPath(kind: "setup" | "reset"): string {
  return kind === "setup" ? "/set-password" : "/reset-password";
}

/**
 * Build the full, token-bearing password action link for the given email kind,
 * resolving the host via {@link getFrontendBaseUrl}. Setup links point at
 * `/set-password`; reset (forgot-password) links at `/reset-password`.
 */
export function buildPasswordActionUrl(
  kind: "setup" | "reset",
  token: string,
  req?: Request,
): string {
  return `${getFrontendBaseUrl(req)}${passwordActionPath(kind)}?token=${token}`;
}

/**
 * True only when SMTP is fully configured for authenticated sending: host, user,
 * and a password (SMTP_PASS or SMTP_PASSWORD). Partial config is treated as NOT
 * configured so flows fail closed rather than attempting a doomed send.
 */
export function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && smtpPassword(),
  );
}

/**
 * Throw a clear, actionable error when SMTP is not fully configured. Used by the
 * test endpoint and any flow that must fail loudly rather than silently skip.
 */
function assertSmtpConfigured(): void {
  const missing: string[] = [];
  if (!process.env.SMTP_HOST) missing.push("SMTP_HOST");
  if (!process.env.SMTP_USER) missing.push("SMTP_USER");
  if (!smtpPassword()) missing.push("SMTP_PASS (or SMTP_PASSWORD)");
  if (missing.length > 0) {
    throw new Error(
      `SMTP is not configured — missing ${missing.join(", ")}. Set SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS or SMTP_PASSWORD, and optionally SMTP_FROM.`,
    );
  }
}

let cachedTransporter: Transporter | null = null;

/** Lazily build (and cache) the nodemailer transport from env config. */
function getTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = smtpPassword();

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    // 465 = implicit TLS; everything else uses STARTTLS upgrade.
    secure: port === 465,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });

  return cachedTransporter;
}

/**
 * Verify SMTP connectivity + auth without sending a message. Logs success
 * (host/port/user only — never the password) or a clear error. Returns a
 * structured result so callers can surface it without throwing.
 */
export async function verifySmtpConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!smtpConfigured()) {
    const message =
      "SMTP not configured — set SMTP_HOST, SMTP_USER and SMTP_PASS (or SMTP_PASSWORD).";
    logger.warn({}, `[email] ${message}`);
    return { ok: false, message };
  }
  try {
    await getTransporter().verify();
    logger.info(
      {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER,
      },
      "[email] SMTP connection verified",
    );
    return { ok: true, message: "SMTP connection verified" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER,
        err: message,
      },
      "[email] SMTP verification failed",
    );
    return { ok: false, message };
  }
}

/**
 * Send a simple SMTP test email and return nodemailer result metadata. Throws a
 * clear error if SMTP is not configured (so the caller can return a 503/500).
 */
export async function sendTestEmail(to: string): Promise<{
  messageId: string;
  accepted: string[];
  rejected: string[];
  response: string;
}> {
  assertSmtpConfigured();
  const info = await getTransporter().sendMail({
    from: fromAddress(),
    to,
    subject: "CereOnco SMTP Test",
    text: "SMTP email test successful.",
    html: "<p>SMTP email test successful.</p>",
  });
  const meta = sendResultMeta(info);
  logger.info(
    { to, messageId: meta.messageId, accepted: meta.accepted, rejected: meta.rejected },
    "[email] Test email sent",
  );
  return meta;
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
 * Shared delivery for the password setup/reset link. `kind` affects both the
 * email wording and the link path: setup → `/set-password?token=...`, reset →
 * `/reset-password?token=...`. Both still complete via POST /auth/set-password.
 */
async function deliverPasswordLink(
  kind: "setup" | "reset",
  opts: { req: Request; to: string; name: string; token: string },
): Promise<void> {
  const { req, to, name, token } = opts;
  const setupUrl = buildPasswordActionUrl(kind, token, req);

  if (smtpConfigured()) {
    const { subject, text, html } = renderEmail(kind, name, setupUrl);
    try {
      const info = await getTransporter().sendMail({
        from: fromAddress(),
        to,
        subject,
        text,
        html,
      });
      // Metadata only — never log the token-bearing link.
      const meta = sendResultMeta(info);
      req.log.info(
        {
          to,
          messageId: meta.messageId,
          accepted: meta.accepted,
          rejected: meta.rejected,
          response: meta.response,
        },
        `[email] Password ${kind} email sent`,
      );
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
 * Send a "forgot password" reset link. Reuses the same setup-token flow as
 * registration but links to `/reset-password?token=...`; the recipient still
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
