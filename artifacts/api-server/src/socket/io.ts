import type { Server } from "socket.io";

/**
 * Holds the Socket.IO server singleton so non-socket code (e.g. REST routes and
 * the messaging service) can emit real-time events without importing the full
 * socket bootstrap. Set once by initSocket().
 */
let io: Server | null = null;

export function setIo(instance: Server): void {
  io = instance;
}

export function getIo(): Server | null {
  return io;
}

export const userRoom = (userId: number): string => `user:${userId}`;
export const conversationRoom = (conversationId: number): string =>
  `conversation:${conversationId}`;

/** Emit to every socket belonging to a single user (all their devices). */
export function emitToUser(
  userId: number,
  event: string,
  payload: unknown,
): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

/** Emit to everyone who has joined a conversation room. */
export function emitToConversation(
  conversationId: number,
  event: string,
  payload: unknown,
): void {
  io?.to(conversationRoom(conversationId)).emit(event, payload);
}
