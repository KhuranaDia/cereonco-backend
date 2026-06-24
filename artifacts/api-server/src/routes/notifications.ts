import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import {
  ListNotificationsQueryParams,
  ListUnreadNotificationsQueryParams,
  ListMentionedNotificationsQueryParams,
  ListSystemNotificationsQueryParams,
  MarkNotificationReadParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { success, error } from "../utils/response";

const router: IRouter = Router();

type NotificationFilter = ReturnType<typeof eq>;

async function getUnreadCount(userId: number): Promise<number> {
  const [{ unreadCount }] = await db
    .select({ unreadCount: sql<number>`cast(count(*) as integer)` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.isRead, false),
      ),
    );
  return unreadCount;
}

async function listFilteredNotifications(
  userId: number,
  limit: number,
  offset: number,
  extra?: NotificationFilter,
) {
  const conditions = [eq(notificationsTable.userId, userId)];
  if (extra) conditions.push(extra);

  const rows = await db
    .select({
      id: notificationsTable.id,
      userId: notificationsTable.userId,
      actorId: notificationsTable.actorId,
      type: notificationsTable.type,
      entityType: notificationsTable.entityType,
      entityId: notificationsTable.entityId,
      message: notificationsTable.message,
      isRead: notificationsTable.isRead,
      createdAt: notificationsTable.createdAt,
      updatedAt: notificationsTable.updatedAt,
      actorName: usersTable.name,
      actorRole: usersTable.role,
      actorProfilePhotoUrl: usersTable.profilePhotoUrl,
    })
    .from(notificationsTable)
    .innerJoin(usersTable, eq(notificationsTable.actorId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    entityType: r.entityType,
    entityId: r.entityId,
    message: r.message,
    isRead: r.isRead,
    actor: {
      id: r.actorId,
      name: r.actorName,
      role: r.actorRole,
      profilePhotoUrl: r.actorProfilePhotoUrl,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function buildNotification(raw: typeof notificationsTable.$inferSelect & {
  actorId: number;
  actorName: string;
  actorRole: string;
  actorProfilePhotoUrl: string | null;
}) {
  return {
    id: raw.id,
    type: raw.type,
    entityType: raw.entityType,
    entityId: raw.entityId,
    message: raw.message,
    isRead: raw.isRead,
    actor: {
      id: raw.actorId,
      name: raw.actorName,
      role: raw.actorRole,
      profilePhotoUrl: raw.actorProfilePhotoUrl,
    },
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const query = ListNotificationsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const rows = await db
    .select({
      id: notificationsTable.id,
      userId: notificationsTable.userId,
      actorId: notificationsTable.actorId,
      type: notificationsTable.type,
      entityType: notificationsTable.entityType,
      entityId: notificationsTable.entityId,
      message: notificationsTable.message,
      isRead: notificationsTable.isRead,
      createdAt: notificationsTable.createdAt,
      updatedAt: notificationsTable.updatedAt,
      actorName: usersTable.name,
      actorRole: usersTable.role,
      actorProfilePhotoUrl: usersTable.profilePhotoUrl,
    })
    .from(notificationsTable)
    .innerJoin(usersTable, eq(notificationsTable.actorId, usersTable.id))
    .where(eq(notificationsTable.userId, req.userId!))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ unreadCount }] = await db
    .select({ unreadCount: sql<number>`cast(count(*) as integer)` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, req.userId!),
        eq(notificationsTable.isRead, false),
      ),
    );

  const notifications = rows.map((r) => ({
    id: r.id,
    type: r.type,
    entityType: r.entityType,
    entityId: r.entityId,
    message: r.message,
    isRead: r.isRead,
    actor: {
      id: r.actorId,
      name: r.actorName,
      role: r.actorRole,
      profilePhotoUrl: r.actorProfilePhotoUrl,
    },
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  success(res, "Notifications retrieved", {
    notifications,
    total: notifications.length,
    unreadCount,
  });
});

router.get("/notifications/unread", requireAuth, async (req, res): Promise<void> => {
  const query = ListUnreadNotificationsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const [notifications, unreadCount] = await Promise.all([
    listFilteredNotifications(
      req.userId!,
      limit,
      offset,
      eq(notificationsTable.isRead, false),
    ),
    getUnreadCount(req.userId!),
  ]);

  success(res, "Unread notifications retrieved", {
    notifications,
    total: notifications.length,
    unreadCount,
  });
});

router.get("/notifications/mentioned", requireAuth, async (req, res): Promise<void> => {
  const query = ListMentionedNotificationsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const [notifications, unreadCount] = await Promise.all([
    listFilteredNotifications(
      req.userId!,
      limit,
      offset,
      eq(notificationsTable.type, "mention"),
    ),
    getUnreadCount(req.userId!),
  ]);

  success(res, "Mentioned notifications retrieved", {
    notifications,
    total: notifications.length,
    unreadCount,
  });
});

router.get("/notifications/system", requireAuth, async (req, res): Promise<void> => {
  const query = ListSystemNotificationsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const [notifications, unreadCount] = await Promise.all([
    listFilteredNotifications(
      req.userId!,
      limit,
      offset,
      eq(notificationsTable.type, "system"),
    ),
    getUnreadCount(req.userId!),
  ]);

  success(res, "System notifications retrieved", {
    notifications,
    total: notifications.length,
    unreadCount,
  });
});

router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const [{ unreadCount }] = await db
    .select({ unreadCount: sql<number>`cast(count(*) as integer)` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, req.userId!),
        eq(notificationsTable.isRead, false),
      ),
    );

  success(res, "Unread count retrieved", { unreadCount });
});

router.patch("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) {
    error(res, "Invalid notification ID", 400);
    return;
  }

  const [existing] = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.id, params.data.id));

  if (!existing) {
    error(res, "Notification not found", 404);
    return;
  }

  if (existing.userId !== req.userId) {
    error(res, "Forbidden — this notification does not belong to you", 403);
    return;
  }

  const [updated] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.id, params.data.id))
    .returning();

  const [actor] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
      profilePhotoUrl: usersTable.profilePhotoUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.id, updated.actorId));

  success(res, "Notification marked as read", {
    id: updated.id,
    type: updated.type,
    entityType: updated.entityType,
    entityId: updated.entityId,
    message: updated.message,
    isRead: updated.isRead,
    actor: actor ?? null,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
});

// POST /notifications/seed-system — dev/demo helper that seeds a few "system"
// notifications for the current user so the frontend can render that tab.
// Idempotent: does nothing if the user already has system notifications.
// Uses a direct insert (not createNotification, which no-ops on self actor).
router.post("/notifications/seed-system", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [{ existing }] = await db
    .select({ existing: sql<number>`cast(count(*) as integer)` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, userId),
        eq(notificationsTable.type, "system"),
      ),
    );

  if (existing > 0) {
    success(res, "System notifications already present", { created: 0 });
    return;
  }

  const messages = [
    "Welcome to CereOnco Community! Complete your profile to get started.",
    "Your privacy matters — review your notification settings any time.",
    "New support groups are available. Explore communities that fit your journey.",
  ];

  const inserted = await db
    .insert(notificationsTable)
    .values(
      messages.map((message) => ({
        userId,
        actorId: userId,
        type: "system" as const,
        entityType: "user" as const,
        entityId: userId,
        message,
      })),
    )
    .returning({ id: notificationsTable.id });

  success(res, "System notifications seeded", { created: inserted.length });
});

router.patch("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const result = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.userId, req.userId!),
        eq(notificationsTable.isRead, false),
      ),
    )
    .returning({ id: notificationsTable.id });

  success(res, "All notifications marked as read", { updatedCount: result.length });
});

export default router;
