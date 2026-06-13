/**
 * In-memory presence registry. Maps a userId to the set of live socket ids for
 * that user (a user may be connected from multiple tabs/devices). No Redis —
 * this is process-local, which is sufficient for a single Render web service.
 */
const online = new Map<number, Set<string>>();

/**
 * Register a socket for a user.
 * @returns true if the user just transitioned from offline → online.
 */
export function addUserSocket(userId: number, socketId: string): boolean {
  let sockets = online.get(userId);
  const wasOffline = !sockets || sockets.size === 0;
  if (!sockets) {
    sockets = new Set<string>();
    online.set(userId, sockets);
  }
  sockets.add(socketId);
  return wasOffline;
}

/**
 * Remove a socket for a user.
 * @returns true if the user just transitioned from online → offline.
 */
export function removeUserSocket(userId: number, socketId: string): boolean {
  const sockets = online.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    online.delete(userId);
    return true;
  }
  return false;
}

export function isUserOnline(userId: number): boolean {
  return (online.get(userId)?.size ?? 0) > 0;
}

export function getOnlineUserIds(): number[] {
  return [...online.keys()];
}
