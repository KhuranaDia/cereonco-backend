import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const NOTIFICATION_TYPES = [
  "post_liked",
  "post_commented",
  "comment_replied",
  "group_joined",
  "group_post_created",
  "verification_updated",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ENTITY_TYPES = ["post", "comment", "group", "group_post", "user"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").$type<NotificationType>().notNull(),
  entityType: text("entity_type").$type<EntityType>().notNull(),
  entityId: integer("entity_id").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Notification = typeof notificationsTable.$inferSelect;
