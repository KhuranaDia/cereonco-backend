-- Phase Groups — user ownership & membership, Render-compatible, idempotent.
--
-- Adds group ownership (creator_user_id) plus a role column on group_members,
-- and backfills existing data. Safe to run repeatedly: every statement uses
-- IF NOT EXISTS / guarded DO blocks.
--
-- Run on Render with:  psql "$DATABASE_URL" -f lib/db/drizzle/phase_groups_user_membership.sql

BEGIN;

-- 1. groups.creator_user_id — the user who created/owns the group (its admin).
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "creator_user_id" integer;

-- groups.creator_user_id -> users.id (set null on delete) — add only if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'groups_creator_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "groups"
      ADD CONSTRAINT "groups_creator_user_id_users_id_fk"
      FOREIGN KEY ("creator_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- 2. group_members.role — "admin" for the creator, "member" otherwise.
ALTER TABLE "group_members"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'member';

-- 3. Ensure the (group_id, user_id) unique constraint exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'group_members_group_id_user_id_unique'
  ) THEN
    ALTER TABLE "group_members"
      ADD CONSTRAINT "group_members_group_id_user_id_unique"
      UNIQUE ("group_id", "user_id");
  END IF;
END $$;

-- 4. Backfill creator_user_id for legacy groups: use the earliest member as the
--    presumed creator when no creator is recorded yet.
UPDATE "groups" g
SET "creator_user_id" = sub.user_id
FROM (
  SELECT DISTINCT ON (gm.group_id) gm.group_id, gm.user_id
  FROM "group_members" gm
  ORDER BY gm.group_id, gm.joined_at ASC, gm.id ASC
) sub
WHERE g."creator_user_id" IS NULL
  AND g."id" = sub.group_id;

-- 5. Ensure each group's creator is a member (idempotent) and mark them admin.
INSERT INTO "group_members" ("group_id", "user_id", "role")
SELECT g."id", g."creator_user_id", 'admin'
FROM "groups" g
WHERE g."creator_user_id" IS NOT NULL
ON CONFLICT ("group_id", "user_id") DO UPDATE SET "role" = 'admin';

COMMIT;
