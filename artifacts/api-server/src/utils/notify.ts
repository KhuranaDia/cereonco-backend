import { db, notificationsTable, type NotificationType, type EntityType } from "@workspace/db";

interface NotificationInput {
  userId: number;
  actorId: number;
  type: NotificationType;
  entityType: EntityType;
  entityId: number;
  message: string;
}

export async function createNotification(input: NotificationInput): Promise<void> {
  if (input.userId === input.actorId) return;
  await db.insert(notificationsTable).values(input);
}

export async function createNotifications(inputs: NotificationInput[]): Promise<void> {
  const filtered = inputs.filter((n) => n.userId !== n.actorId);
  if (filtered.length === 0) return;
  await db.insert(notificationsTable).values(filtered);
}
