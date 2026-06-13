import { eq, and } from "drizzle-orm";
import {
  db,
  conversationsTable,
  messagesTable,
  usersTable,
  type Conversation,
  type Message,
} from "@workspace/db";
import { emitToConversation, emitToUser } from "../socket/io";

export type ServiceError = { status: number; message: string };

export type ParticipantSummary = {
  id: number;
  name: string;
  role: string;
  avatarUrl: string | null;
  profilePhotoUrl: string | null;
};

export type ShapedMessage = {
  id: number;
  conversationId: number;
  senderId: number;
  receiverId: number;
  content: string;
  mediaUrls: string[];
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function shapeMessage(m: Message): ShapedMessage {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    receiverId: m.receiverId,
    content: m.content,
    mediaUrls: m.mediaUrls ?? [],
    isRead: m.isRead,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export function otherUserId(convo: Conversation, currentUserId: number): number {
  return convo.userOneId === currentUserId ? convo.userTwoId : convo.userOneId;
}

export function isParticipant(
  convo: Conversation,
  currentUserId: number,
): boolean {
  return (
    convo.userOneId === currentUserId || convo.userTwoId === currentUserId
  );
}

export async function loadParticipant(
  userId: number,
): Promise<ParticipantSummary | null> {
  const [user] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
      avatarUrl: usersTable.avatarUrl,
      profilePhotoUrl: usersTable.profilePhotoUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return user ?? null;
}

/**
 * Load a conversation and assert the caller belongs to it. Used by both REST
 * routes and socket handlers to enforce "users cannot access conversations they
 * do not belong to".
 */
export async function loadOwnedConversation(
  conversationId: number,
  currentUserId: number,
): Promise<{ convo: Conversation } | ServiceError> {
  const [convo] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId));

  if (!convo) {
    return { status: 404, message: "Conversation not found" };
  }
  if (!isParticipant(convo, currentUserId)) {
    return {
      status: 403,
      message: "Forbidden — you are not part of this conversation",
    };
  }
  return { convo };
}

export type CreatedConversation = {
  id: number;
  participant: ParticipantSummary;
  lastMessage: null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Create a conversation between two users, or return the existing one. */
export async function createOrGetConversation(
  currentUserId: number,
  recipientId: number,
): Promise<CreatedConversation | ServiceError> {
  if (recipientId === currentUserId) {
    return {
      status: 400,
      message: "You cannot start a conversation with yourself",
    };
  }

  const recipient = await loadParticipant(recipientId);
  if (!recipient) {
    return { status: 404, message: "Recipient not found" };
  }

  const userOneId = Math.min(currentUserId, recipientId);
  const userTwoId = Math.max(currentUserId, recipientId);

  let [convo] = await db
    .insert(conversationsTable)
    .values({ userOneId, userTwoId })
    .onConflictDoNothing()
    .returning();

  if (!convo) {
    [convo] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.userOneId, userOneId),
          eq(conversationsTable.userTwoId, userTwoId),
        ),
      );
  }

  if (!convo) {
    return { status: 500, message: "Failed to create conversation" };
  }

  return {
    id: convo.id,
    participant: recipient,
    lastMessage: null,
    unreadCount: 0,
    createdAt: convo.createdAt,
    updatedAt: convo.updatedAt,
  };
}

/**
 * Persist a message, bump the conversation, then fan out real-time events.
 * Socket emission happens only after a successful DB write:
 *  - `newMessage` to the conversation room (anyone actively viewing the chat)
 *  - `messageReceived` to the recipient's personal room (inbox/badge updates,
 *    delivered even when they have not joined the conversation room)
 */
export async function sendMessageToConversation(
  conversationId: number,
  senderId: number,
  content: string,
  mediaUrls: string[],
): Promise<{ message: ShapedMessage } | ServiceError> {
  const owned = await loadOwnedConversation(conversationId, senderId);
  if ("status" in owned) return owned;

  const receiverId = otherUserId(owned.convo, senderId);

  const [message] = await db
    .insert(messagesTable)
    .values({
      conversationId: owned.convo.id,
      senderId,
      receiverId,
      content,
      mediaUrls,
    })
    .returning();

  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, owned.convo.id));

  const shaped = shapeMessage(message);
  emitToConversation(owned.convo.id, "newMessage", shaped);
  emitToUser(receiverId, "messageReceived", shaped);

  return { message: shaped };
}

/**
 * Mark every unread message the caller has received in a conversation as read,
 * then notify the conversation room so the sender sees read receipts.
 */
export async function markConversationRead(
  conversationId: number,
  currentUserId: number,
): Promise<{ updatedCount: number } | ServiceError> {
  const owned = await loadOwnedConversation(conversationId, currentUserId);
  if ("status" in owned) return owned;

  const updated = await db
    .update(messagesTable)
    .set({ isRead: true })
    .where(
      and(
        eq(messagesTable.conversationId, owned.convo.id),
        eq(messagesTable.receiverId, currentUserId),
        eq(messagesTable.isRead, false),
      ),
    )
    .returning({ id: messagesTable.id });

  if (updated.length > 0) {
    emitToConversation(owned.convo.id, "messageRead", {
      conversationId: owned.convo.id,
      readerId: currentUserId,
      messageIds: updated.map((m) => m.id),
    });
  }

  return { updatedCount: updated.length };
}
