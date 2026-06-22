import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Request, RequestHandler } from "express";
import multer, { MulterError } from "multer";
import { error } from "../utils/response";

/**
 * Local disk upload handling (Task 2 & 3).
 *
 * Files are stored under `<cwd>/uploads/<subdir>` and served statically at
 * `/uploads/<subdir>/<filename>` (see app.ts). The persisted URL is the public
 * relative path so it works behind the Render host and the Replit proxy alike.
 *
 * NOTE: local disk is ephemeral on most PaaS hosts (incl. Render) — uploads do
 * not survive a redeploy. Swap the storage engine for object storage/S3 for
 * durable media. Kept local per the task spec.
 */

export const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm"]);
const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const MB = 1024 * 1024;

function ensureDir(subdir: string): string {
  const dir = path.join(UPLOADS_ROOT, subdir);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildStorage(subdir: string) {
  const dir = ensureDir(subdir);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const unique = `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`;
      cb(null, unique);
    },
  });
}

function makeFileFilter(opts: {
  images: boolean;
  videos: boolean;
}): multer.Options["fileFilter"] {
  return (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const okImage =
      opts.images && IMAGE_EXTS.has(ext) && IMAGE_MIMES.has(file.mimetype);
    const okVideo =
      opts.videos && VIDEO_EXTS.has(ext) && VIDEO_MIMES.has(file.mimetype);
    if (okImage || okVideo) {
      cb(null, true);
      return;
    }
    cb(new MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname));
  };
}

/** Public URL path for a stored file. */
export function publicUrl(subdir: string, filename: string): string {
  return `/uploads/${subdir}/${filename}`;
}

const avatarUpload = multer({
  storage: buildStorage("avatars"),
  limits: { fileSize: 5 * MB, files: 1 },
  fileFilter: makeFileFilter({ images: true, videos: false }),
});

const postMediaUpload = multer({
  storage: buildStorage("posts"),
  limits: { fileSize: 10 * MB, files: 10 },
  fileFilter: makeFileFilter({ images: true, videos: true }),
});

/**
 * Wraps a multer middleware so upload errors return the standard JSON envelope
 * instead of Express's default HTML error page. Multipart bodies that aren't
 * multipart (e.g. application/json) pass straight through untouched.
 */
function wrap(mw: RequestHandler, kind: "avatar" | "post media"): RequestHandler {
  return (req, res, next) => {
    mw(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          error(res, `${kind} file is too large`, 400);
          return;
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          error(
            res,
            `Unsupported ${kind} file type or field. Allowed: ${
              kind === "avatar"
                ? "jpg, jpeg, png, webp"
                : "jpg, jpeg, png, webp, mp4, mov, webm"
            }`,
            400,
          );
          return;
        }
        error(res, `Upload error: ${err.message}`, 400);
        return;
      }
      next(err as Error);
    });
  };
}

/** PATCH /users/me — single optional `avatar` file. */
export const uploadAvatar: RequestHandler = wrap(
  avatarUpload.single("avatar"),
  "avatar",
);

/** POST /posts — multiple optional `media` files. */
export const uploadPostMedia: RequestHandler = wrap(
  postMediaUpload.array("media", 10),
  "post media",
);
