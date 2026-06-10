import type { usersTable } from "@workspace/db";

type DbUser = typeof usersTable.$inferSelect;

/**
 * Strip all sensitive fields from a user row before sending it to clients.
 * Never expose the password hash or the password-setup token material.
 */
export function safeUser(user: DbUser) {
  const {
    passwordHash: _pw,
    passwordSetupToken: _token,
    passwordSetupTokenExpiresAt: _exp,
    ...pub
  } = user;
  return pub;
}
