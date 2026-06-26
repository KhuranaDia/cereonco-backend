import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const secret = process.env.SESSION_SECRET ?? "dev-secret-change-in-production";

const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function generateToken(payload: { userId: number }): string {
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number } {
  return jwt.verify(token, secret) as { userId: number };
}

/**
 * Generate a single-use password-setup token. The raw token goes in the email
 * link; only its SHA-256 hash is persisted, so a DB leak cannot be replayed.
 */
export function generateSetupToken(): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSetupToken(token);
  const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

export function hashSetupToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Normalize a setup/reset token that a client may send in several shapes:
 *   - the raw token: "abc123..."
 *   - a full link:   "http://localhost:5173/set-password?token=abc123..."
 *   - a query frag:  "?token=abc123..." or "token=abc123..."
 * Extracts the `token` query param when present, URL-decodes, and trims.
 * Returns the cleaned token (or the trimmed input if no token param is found).
 */
export function extractSetupToken(raw: string): string {
  const trimmed = raw.trim();

  const fromQuery = (qs: string): string | null => {
    const params = new URLSearchParams(qs);
    const t = params.get("token");
    return t ? t.trim() : null;
  };

  // Full URL form.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const t = u.searchParams.get("token");
      if (t) return t.trim();
    } catch {
      // fall through
    }
  }

  // Bare query string form ("token=..." or "?token=...").
  if (trimmed.includes("token=")) {
    const qs = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
    const t = fromQuery(qs);
    if (t) return t;
  }

  // Already a raw token — decode any stray percent-encoding defensively.
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * Generate a random throwaway password. Used as the temp password at
 * registration so passwordHash is never null; the user replaces it via
 * the setup-token flow. The raw value is never persisted or returned.
 */
export function generateTempPassword(): string {
  return crypto.randomBytes(32).toString("hex");
}
