import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const RSVP_STATUSES = ["going", "interested", "not_going"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
  location: text("location"),
  imageUrl: text("image_url"),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const eventRsvpsTable = pgTable(
  "event_rsvps",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    status: text("status").$type<RsvpStatus>().notNull().default("going"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.eventId, t.userId)],
);

export const insertEventSchema = createInsertSchema(eventsTable).omit({
  id: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof eventsTable.$inferSelect;
export type EventRsvp = typeof eventRsvpsTable.$inferSelect;
