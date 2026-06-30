-- Phase Group-posts unification — Render-compatible, idempotent.
--
-- Frontend requirement: there is NO separate group_posts table. Group posts are
-- rows in the shared `posts` table with a non-null `group_id`.
--
-- This migration:
--   1. Ensures posts.group_id exists (nullable) — created earlier, guarded here.
--   2. Changes the posts.group_id FK to ON DELETE SET NULL (was CASCADE) so
--      deleting a group detaches its posts instead of deleting them.
--   3. Drops the now-unused group_posts table (data was backfilled into posts in
--      the prior migration).
--
-- Safe to run repeatedly.
--
-- Run with:  psql "$DATABASE_URL" -f lib/db/drizzle/phase_group_posts_unify.sql

BEGIN;

-- 1. posts.group_id — nullable column (guarded; normally already present).
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "group_id" integer;

-- 2. Re-point the FK to ON DELETE SET NULL. Drop the existing constraint (any
--    on-delete action) then recreate it with SET NULL.
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_group_id_groups_id_fk";

ALTER TABLE "posts"
  ADD CONSTRAINT "posts_group_id_groups_id_fk"
  FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL;

-- 3. Safety backfill: copy any remaining legacy group_posts rows into posts that
--    are not already present, THEN drop the table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'group_posts'
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

    DROP TABLE "group_posts";
  END IF;
END $$;

COMMIT;
