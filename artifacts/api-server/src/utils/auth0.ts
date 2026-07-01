/**
 * Auth0 access-token verification for POST /auth/google.
 *
 * The frontend authenticates the user with Auth0 (which can broker Google),
 * obtains an Auth0 access token, and sends it as `token`. We verify the token by
 * calling the tenant's OIDC `/userinfo` endpoint — an invalid/expired token
 * yields a non-2xx response — and trust ONLY the profile Auth0 returns.
 *
 * The tenant is configured via `AUTH0_DOMAIN` (e.g. `your-tenant.auth0.com`);
 * when unset it defaults to the project's Auth0 tenant. The scheme and trailing
 * slash are normalized away. The access token is the client's bearer credential;
 * the domain is non-secret config.
 */

import axios from "axios";

/** Default Auth0 tenant used when `AUTH0_DOMAIN` is not set. */
const DEFAULT_AUTH0_DOMAIN = "dev-4o1xkbtqem2bxiuy.us.auth0.com";

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

/**
 * Thrown when the access token is rejected by Auth0 (non-2xx response) or the
 * response body is unusable — maps to HTTP 401.
 */
export class Auth0VerificationError extends Error {
  constructor(message = "Auth0 access token verification failed") {
    super(message);
    this.name = "Auth0VerificationError";
  }
}

/**
 * Thrown when the Auth0 userinfo endpoint could not be reached (network error,
 * timeout, no HTTP response) — maps to HTTP 502.
 */
export class Auth0UnavailableError extends Error {
  constructor(message = "Auth0 userinfo endpoint is unavailable") {
    super(message);
    this.name = "Auth0UnavailableError";
  }
}

function userinfoUrl(): string {
  const domain = (process.env.AUTH0_DOMAIN?.trim() || DEFAULT_AUTH0_DOMAIN)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  return `https://${domain}/userinfo`;
}

/**
 * Verify an Auth0 access token and return the user's profile from `/userinfo`.
 *
 * @throws {Auth0VerificationError} when the token is invalid/expired (Auth0
 *   returned a non-2xx response) or the response is missing a usable `sub`.
 * @throws {Auth0UnavailableError} when Auth0 could not be reached at all.
 */
export async function verifyAuth0AccessToken(
  accessToken: string,
): Promise<Auth0Profile> {
  let data: unknown;
  try {
    const response = await axios.get<Auth0Profile>(userinfoUrl(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    data = response.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      // A response with a non-2xx status means Auth0 rejected the token.
      if (err.response) {
        throw new Auth0VerificationError(
          `Auth0 userinfo returned ${err.response.status}`,
        );
      }
      // No response received → the endpoint is unreachable.
      throw new Auth0UnavailableError(
        `Could not reach Auth0 userinfo endpoint: ${err.message}`,
      );
    }
    throw new Auth0UnavailableError(
      `Could not reach Auth0 userinfo endpoint: ${(err as Error).message}`,
    );
  }

  const profile = data as Auth0Profile | null;
  if (!profile || typeof profile.sub !== "string" || profile.sub.length === 0) {
    throw new Auth0VerificationError(
      "Auth0 userinfo response did not include a subject (sub)",
    );
  }

  return profile;
}
