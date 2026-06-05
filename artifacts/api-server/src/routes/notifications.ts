import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import {
  ListNotificationsQueryParams,
  MarkNotificationReadParams,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { success, error } from "../utils/response";

const router: IRouter = Router();

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
