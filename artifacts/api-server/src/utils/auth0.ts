/**
 * Auth0 access-token verification for POST /auth/google.
 *
 * The frontend authenticates the user with Auth0 (which can broker Google),
 * obtains an Auth0 access token, and sends it to the backend. We verify the
 * token by calling the tenant's OIDC `/userinfo` endpoint — an invalid/expired
 * token yields a non-2xx response — and trust ONLY the profile Auth0 returns.
 *
 * Configuration: `AUTH0_DOMAIN` (e.g. `your-tenant.auth0.com`). The scheme and
 * trailing slash are normalized away. The access token is the client's bearer
 * credential; the domain is non-secret config.
 */

export interface Auth0Profile {
  sub: string;
  email?: string | null;
  email_verified?: boolean;
  name?: string | null;
  given_name?: string | null;
  family_name?: string | null;
  nickname?: string | null;
  picture?: string | null;
}

/** Thrown when AUTH0_DOMAIN is not configured on the server. */
export class Auth0NotConfiguredError extends Error {
  constructor(message = "AUTH0_DOMAIN is not configured") {
    super(message);
    this.name = "Auth0NotConfiguredError";
  }
}

/** Thrown when the access token is rejected by Auth0 or the response is unusable. */
export class Auth0VerificationError extends Error {
  constructor(message = "Auth0 access token verification failed") {
    super(message);
    this.name = "Auth0VerificationError";
  }
}

/** True when the server is configured to verify Auth0 access tokens. */
export function auth0Configured(): boolean {
  return Boolean(process.env.AUTH0_DOMAIN && process.env.AUTH0_DOMAIN.trim());
}

function userinfoUrl(): string {
  const domain = process.env
    .AUTH0_DOMAIN!.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${domain}/userinfo`;
}

/**
 * Verify an Auth0 access token and return the user's profile from `/userinfo`.
 *
 * @throws {Auth0NotConfiguredError} when AUTH0_DOMAIN is unset.
 * @throws {Auth0VerificationError} when the token is invalid/expired or the
 *   response is missing a usable `sub`.
 */
export async function verifyAuth0AccessToken(
  accessToken: string,
): Promise<Auth0Profile> {
  if (!auth0Configured()) {
    throw new Auth0NotConfiguredError();
  }

  let response: Response;
  try {
    response = await fetch(userinfoUrl(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (cause) {
    throw new Auth0VerificationError(
      `Could not reach Auth0 userinfo endpoint: ${(cause as Error).message}`,
    );
  }

  if (!response.ok) {
    throw new Auth0VerificationError(
      `Auth0 userinfo returned ${response.status}`,
    );
  }

  let profile: Auth0Profile;
  try {
    profile = (await response.json()) as Auth0Profile;
  } catch {
    throw new Auth0VerificationError("Auth0 userinfo returned invalid JSON");
  }

  if (!profile || typeof profile.sub !== "string" || profile.sub.length === 0) {
    throw new Auth0VerificationError(
      "Auth0 userinfo response did not include a subject (sub)",
    );
  }

  return profile;
}
