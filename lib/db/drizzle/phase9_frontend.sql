-- Phase 9 — Frontend-blocking fixes, Render-compatible, idempotent migration.
--
-- Adds the new nullable columns required by Sudip's frontend fixes when
-- `drizzle-kit push` cannot run (push is interactive and blocks on the
-- pre-existing phone_number drift). Safe to run repeatedly: every statement
-- uses IF NOT EXISTS / guarded DO blocks.
--
-- Run on Render with:  psql "$DATABASE_URL" -f lib/db/drizzle/phase9_frontend.sql

BEGIN;

-- 1. users.image_url — preferred new profile-image field (kept in sync with
--    avatar_url/profile_photo_url on upload for backward compatibility).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image_url" text;

-- 2. comments.mentioned_user_id — optional user mentioned in a comment.
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "mentioned_user_id" integer;

-- comments.mentioned_user_id -> users.id (set null on delete). Add FK only if
-- it doesn't already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'comments_mentioned_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "comments"
      ADD CONSTRAINT "comments_mentioned_user_id_users_id_fk"
      FOREIGN KEY ("mentioned_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
