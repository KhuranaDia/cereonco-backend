import jwt from "jsonwebtoken";

const secret = process.env.SESSION_SECRET ?? "dev-secret-change-in-production";

export function generateToken(payload: { userId: number }): string {
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

export function verifyToken(token: string): { userId: number } {
  return jwt.verify(token, secret) as { userId: number };
}
