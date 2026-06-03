import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/token";
import { error } from "../utils/response";

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    error(res, "Unauthorized — provide a Bearer token", 401);
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    error(res, "Invalid or expired token", 401);
  }
}
