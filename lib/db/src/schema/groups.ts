import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const groupsTable = pgTable("groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  tagline: text("tagline"),
  category: text("category").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const groupMembersTable = pgTable(
  "group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groupsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.groupId, t.userId)],
);

export const groupPostsTable = pgTable("group_posts", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id")
    .notNull()
    .references(() => groupsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertGroupSchema = createInsertSchema(groupsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type Group = typeof groupsTable.$inferSelect;
export type GroupMember = typeof groupMembersTable.$inferSelect;
export type GroupPost = typeof groupPostsTable.$inferSelect;
