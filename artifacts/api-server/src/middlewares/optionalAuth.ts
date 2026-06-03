import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/token";

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const payload = verifyToken(authHeader.slice(7));
      req.userId = payload.userId;
    } catch {
      // ignore invalid token for optional auth
    }
  }
  next();
}
