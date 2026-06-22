import { Router, type IRouter } from "express";
import { eq, and, sql, asc } from "drizzle-orm";
import {
  db,
  eventsTable,
  eventRsvpsTable,
  usersTable,
  type RsvpStatus,
} from "@workspace/db";
import {
  ListEventsQueryParams,
  CreateEventBody,
  GetEventParams,
  UpdateEventParams,
  UpdateEventBody,
  DeleteEventParams,
  SetEventRsvpParams,
  SetEventRsvpBody,
  RemoveEventRsvpParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { success, error } from "../utils/response";

const router: IRouter = Router();

interface EventRow {
  id: number;
  title: string;
  description: string | null;
  eventDate: Date;
  location: string | null;
  imageUrl: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  creatorName: string;
  creatorRole: string;
  creatorAvatarUrl: string | null;
  rsvpCount: number;
  myRsvpStatus: RsvpStatus | null;
}

function buildEvent(row: EventRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    eventDate: row.eventDate,
    location: row.location,
    imageUrl: row.imageUrl,
    createdBy: row.createdBy,
    creator: {
      id: row.createdBy,
      name: row.creatorName,
      role: row.creatorRole,
      avatarUrl: row.creatorAvatarUrl,
    },
    rsvpCount: row.rsvpCount,
    myRsvpStatus: row.myRsvpStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function eventSelect(userId: number | undefined) {
  return {
    id: eventsTable.id,
    title: eventsTable.title,
    description: eventsTable.description,
    eventDate: eventsTable.eventDate,
    location: eventsTable.location,
    imageUrl: eventsTable.imageUrl,
    createdBy: eventsTable.createdBy,
    createdAt: eventsTable.createdAt,
    updatedAt: eventsTable.updatedAt,
    creatorName: usersTable.name,
    creatorRole: usersTable.role,
    creatorAvatarUrl: usersTable.avatarUrl,
    rsvpCount: sql<number>`cast(count(distinct ${eventRsvpsTable.id}) as integer)`,
    myRsvpStatus: sql<RsvpStatus | null>`max(case when ${eventRsvpsTable.userId} = ${userId ?? 0} then ${eventRsvpsTable.status} end)`,
  };
}

async function fetchEvent(eventId: number, userId: number | undefined) {
  const [row] = await db
    .select(eventSelect(userId))
    .from(eventsTable)
    .innerJoin(usersTable, eq(eventsTable.createdBy, usersTable.id))
    .leftJoin(eventRsvpsTable, eq(eventRsvpsTable.eventId, eventsTable.id))
    .where(eq(eventsTable.id, eventId))
    .groupBy(eventsTable.id, usersTable.id);
  return row;
}

// GET /events — upcoming-first list
router.get("/events", requireAuth, async (req, res): Promise<void> => {
  const query = ListEventsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const rows = await db
    .select(eventSelect(req.userId))
    .from(eventsTable)
    .innerJoin(usersTable, eq(eventsTable.createdBy, usersTable.id))
    .leftJoin(eventRsvpsTable, eq(eventRsvpsTable.eventId, eventsTable.id))
    .groupBy(eventsTable.id, usersTable.id)
    .orderBy(asc(eventsTable.eventDate))
    .limit(limit)
    .offset(offset);

  const events = rows.map(buildEvent);
  success(res, "Events retrieved", { events, total: events.length });
});

// POST /events
router.post("/events", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const [created] = await db
    .insert(eventsTable)
    .values({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      eventDate: parsed.data.eventDate,
      location: parsed.data.location ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      createdBy: req.userId!,
    })
    .returning();

  const row = await fetchEvent(created.id, req.userId);
  success(res, "Event created", buildEvent(row), 201);
});

// GET /events/:id
router.get("/events/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetEventParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid event ID", 400);
    return;
  }

  const row = await fetchEvent(params.data.id, req.userId);
  if (!row) {
    error(res, "Event not found", 404);
    return;
  }
  success(res, "Event retrieved", buildEvent(row));
});

// PATCH /events/:id — creator only
router.patch("/events/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateEventParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid event ID", 400);
    return;
  }

  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const [existing] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.id));

  if (!existing) {
    error(res, "Event not found", 404);
    return;
  }
  if (existing.createdBy !== req.userId) {
    error(res, "Forbidden — you do not own this event", 403);
    return;
  }

  const updates: Partial<typeof eventsTable.$inferInsert> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    updates.description = parsed.data.description ?? null;
  if (parsed.data.eventDate !== undefined)
    updates.eventDate = parsed.data.eventDate;
  if (parsed.data.location !== undefined)
    updates.location = parsed.data.location ?? null;
  if (parsed.data.imageUrl !== undefined)
    updates.imageUrl = parsed.data.imageUrl ?? null;

  if (Object.keys(updates).length === 0) {
    error(res, "No fields provided to update", 400);
    return;
  }

  await db
    .update(eventsTable)
    .set(updates)
    .where(eq(eventsTable.id, params.data.id));

  const row = await fetchEvent(params.data.id, req.userId);
  success(res, "Event updated", buildEvent(row));
});

// DELETE /events/:id — creator only
router.delete("/events/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteEventParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid event ID", 400);
    return;
  }

  const [existing] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.id));

  if (!existing) {
    error(res, "Event not found", 404);
    return;
  }
  if (existing.createdBy !== req.userId) {
    error(res, "Forbidden — you do not own this event", 403);
    return;
  }

  await db.delete(eventsTable).where(eq(eventsTable.id, params.data.id));
  success(res, "Deleted successfully", {});
});

async function rsvpCountFor(eventId: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(eventRsvpsTable)
    .where(eq(eventRsvpsTable.eventId, eventId));
  return count;
}

// PUT /events/:id/rsvp — set or update RSVP
router.put("/events/:id/rsvp", requireAuth, async (req, res): Promise<void> => {
  const params = SetEventRsvpParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid event ID", 400);
    return;
  }

  const parsed = SetEventRsvpBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.id));
  if (!event) {
    error(res, "Event not found", 404);
    return;
  }

  const status: RsvpStatus = parsed.data.status ?? "going";

  await db
    .insert(eventRsvpsTable)
    .values({ eventId: params.data.id, userId: req.userId!, status })
    .onConflictDoUpdate({
      target: [eventRsvpsTable.eventId, eventRsvpsTable.userId],
      set: { status },
    });

  const rsvpCount = await rsvpCountFor(params.data.id);
  success(res, "RSVP saved", { rsvpCount, myRsvpStatus: status });
});

// DELETE /events/:id/rsvp — remove RSVP
router.delete("/events/:id/rsvp", requireAuth, async (req, res): Promise<void> => {
  const params = RemoveEventRsvpParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid event ID", 400);
    return;
  }

  const [event] = await db
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(eq(eventsTable.id, params.data.id));
  if (!event) {
    error(res, "Event not found", 404);
    return;
  }

  await db
    .delete(eventRsvpsTable)
    .where(
      and(
        eq(eventRsvpsTable.eventId, params.data.id),
        eq(eventRsvpsTable.userId, req.userId!),
      ),
    );

  const rsvpCount = await rsvpCountFor(params.data.id);
  success(res, "RSVP removed", { rsvpCount, myRsvpStatus: null });
});

export default router;
