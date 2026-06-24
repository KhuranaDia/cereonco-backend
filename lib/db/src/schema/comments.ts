import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { postsTable } from "./posts";

export const commentsTable = pgTable("comments", {
  id: serial("id").primaryKey(),
  postId: integer("post_id")
    .notNull()
    .references(() => postsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  parentCommentId: integer("parent_comment_id").references(
    (): AnyPgColumn => commentsTable.id,
    { onDelete: "set null" },
  ),
  // Optional user mentioned in this comment (frontend sends mentionedUserId).
  mentionedUserId: integer("mentioned_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Comment = typeof commentsTable.$inferSelect;
