import type { Response } from "express";

export function success(res: Response, message: string, data: unknown = null, status = 200): void {
  res.status(status).json({ success: true, message, data });
}

export function error(res: Response, message: string, status = 400): void {
  res.status(status).json({ success: false, message });
}
