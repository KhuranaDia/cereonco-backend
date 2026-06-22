import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { groupsTable } from "./groups";

export const postsTable = pgTable("posts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  // Nullable: regular posts have groupId = null; group posts carry the group id.
  // Unified storage — group-scoped posts live in the same posts table.
  groupId: integer("group_id").references(() => groupsTable.id, {
    onDelete: "cascade",
  }),

  content: text("content").notNull(),

  // New field requested by frontend
  feeling: text("feeling"),

  // Existing field: keep for backward compatibility
  imageUrl: text("image_url"),

  // New field requested by frontend
  mediaUrls: jsonb("media_urls").$type<string[]>().default([]),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const likesTable = pgTable(
  "likes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    postId: integer("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.userId, t.postId)],
);

export const bookmarksTable = pgTable(
  "bookmarks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    postId: integer("post_id")
      .notNull()
      .references(() => postsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.userId, t.postId)],
);

export const insertPostSchema = createInsertSchema(postsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
export type Like = typeof likesTable.$inferSelect;
export type Bookmark = typeof bookmarksTable.$inferSelect;
