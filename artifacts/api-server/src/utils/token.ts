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
