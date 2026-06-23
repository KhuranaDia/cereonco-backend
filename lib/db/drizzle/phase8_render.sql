-- Phase 8 — Render-compatible, idempotent migration.
--
-- Brings a production/Render database in sync with the Phase 8 schema when
-- `drizzle-kit push` cannot run (push is interactive and blocks on the
-- pre-existing phone_number drift). Safe to run repeatedly: every statement
-- uses IF NOT EXISTS / guarded DO blocks.
--
-- Run on Render with:  psql "$DATABASE_URL" -f lib/db/drizzle/phase8_render.sql

BEGIN;

-- 1. posts: new Phase 8 columns (root cause of GET /posts 500 when missing)
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "feeling" text;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "image_url" text;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "media_urls" jsonb DEFAULT '[]'::jsonb;
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "group_id" integer;

-- posts.group_id -> groups.id (cascade). Add FK only if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'posts_group_id_groups_id_fk'
  ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'groups') THEN
    ALTER TABLE "posts"
      ADD CONSTRAINT "posts_group_id_groups_id_fk"
      FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- 2. users: avatar columns selected by the feed join
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_photo_url" text;

-- 3. comments: soft-delete flag used by the commentCount FILTER
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "is_deleted" boolean NOT NULL DEFAULT false;

-- 4. groups: tagline
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "tagline" text;

-- 5. events
CREATE TABLE IF NOT EXISTS "events" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "event_date" timestamp with time zone NOT NULL,
  "location" text,
  "image_url" text,
  "created_by" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'events_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "events"
      ADD CONSTRAINT "events_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- 6. event_rsvps
CREATE TABLE IF NOT EXISTS "event_rsvps" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "status" text DEFAULT 'going' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'event_rsvps_event_id_user_id_unique'
  ) THEN
    ALTER TABLE "event_rsvps"
      ADD CONSTRAINT "event_rsvps_event_id_user_id_unique" UNIQUE ("event_id", "user_id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'event_rsvps_event_id_events_id_fk'
  ) THEN
    ALTER TABLE "event_rsvps"
      ADD CONSTRAINT "event_rsvps_event_id_events_id_fk"
      FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'event_rsvps_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "event_rsvps"
      ADD CONSTRAINT "event_rsvps_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Note: notifications.type and notifications.entity_type are plain `text`
-- columns (not Postgres enums), so the new 'mention'/'system'/'event' values
-- need no DDL change.

COMMIT;
