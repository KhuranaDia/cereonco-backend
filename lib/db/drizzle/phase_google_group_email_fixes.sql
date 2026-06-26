-- Phase Google + Group-posts-on-posts + Email fixes — Render-compatible, idempotent.
--
-- Covers Sudip's backend fixes:
--   1. users.google_sub — nullable, unique (Google sign-in).
--   2. posts.group_id   — nullable FK to groups (group posts now live in posts).
--   3. posts.feeling / posts.media_urls — ensure present (group posts reuse them).
--   4. Backfill: copy any legacy rows from group_posts into posts, then keep the
--      group_posts table in place (no destructive drop) for safety.
--
-- Safe to run repeatedly: every statement uses IF NOT EXISTS / guarded DO blocks.
--
-- Run with:  psql "$DATABASE_URL" -f lib/db/drizzle/phase_google_group_email_fixes.sql

BEGIN;

-- 1. users.google_sub — nullable column + unique constraint.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_sub" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_google_sub_unique'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_google_sub_unique" UNIQUE ("google_sub");
  END IF;
END $$;

-- 2. posts.group_id — nullable FK to groups (regular posts keep it NULL).
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "group_id" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'posts_group_id_groups_id_fk'
  ) THEN
    ALTER TABLE "posts"
      ADD CONSTRAINT "posts_group_id_groups_id_fk"
      FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- 3. posts.feeling / posts.media_urls — group posts reuse the same columns.
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feeling" text;
ALTER TABLE "posts"
  ADD COLUMN IF NOT EXISTS "media_urls" jsonb DEFAULT '[]'::jsonb;

-- 4. Backfill legacy group_posts rows into posts (only when group_posts exists
--    and the equivalent post is not already present). Non-destructive: the old
--    group_posts table is left intact.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'group_posts'
  ) THEN
    INSERT INTO "posts" ("group_id", "user_id", "content", "image_url", "created_at", "updated_at")
    SELECT gp."group_id", gp."user_id", gp."content", gp."image_url", gp."created_at", gp."updated_at"
    FROM "group_posts" gp
    WHERE NOT EXISTS (
      SELECT 1 FROM "posts" p
      WHERE p."group_id" = gp."group_id"
        AND p."user_id" = gp."user_id"
        AND p."content" = gp."content"
        AND p."created_at" = gp."created_at"
    );
  END IF;
END $$;

COMMIT;
