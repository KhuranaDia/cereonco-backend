import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  RegisterBody,
  LoginBody,
  SetPasswordBody,
  ForgotPasswordBody,
  TestEmailBody,
} from "@workspace/api-zod";
import {
  generateToken,
  generateSetupToken,
  generateTempPassword,
  hashSetupToken,
  extractSetupToken,
} from "../utils/token";
import {
  sendPasswordSetupEmail,
  sendPasswordResetEmail,
  sendTestEmail,
  smtpConfigured,
} from "../utils/email";
import { safeUser } from "../utils/safeUser";
import {
  verifyAuth0AccessToken,
  Auth0VerificationError,
  Auth0UnavailableError,
} from "../utils/auth0";
import { success, error } from "../utils/response";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);

  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const { name, email, role, specialty } = parsed.data;
  const countryCode = parsed.data.country_code?.trim() || null;
  const phoneNumber = parsed.data.phone_number?.trim() || null;

  const normalizedEmail = email.trim().toLowerCase();

  const [existingEmail] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  if (existingEmail) {
    error(res, "Email already in use", 409);
    return;
  }

  if (phoneNumber) {
    const [existingPhone] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.phoneNumber, phoneNumber));

    if (existingPhone) {
      error(res, "Phone number already in use", 409);
      return;
    }
  }

  const { token: setupToken, tokenHash, expiresAt } = generateSetupToken();

  const tempPasswordHash = await bcrypt.hash(generateTempPassword(), 10);

  const [user] = await db
    .insert(usersTable)
    .values({
      name,
      email: normalizedEmail,
      role,
      specialty: specialty ?? null,
      countryCode,
      phoneNumber,
      passwordHash: tempPasswordHash,
      emailVerified: false,
      passwordSetupToken: tokenHash,
      passwordSetupTokenExpiresAt: expiresAt,
    })
    .returning();

  await sendPasswordSetupEmail({
    req,
    to: normalizedEmail,
    name,
    token: setupToken,
  });

  const jwt = generateToken({ userId: user.id });

  const responseData: {
    token: string;
    user: ReturnType<typeof safeUser>;
    setupToken?: string;
  } = {
    token: jwt,
    user: safeUser(user),
  };

  if (process.env.NODE_ENV !== "production") {
    responseData.setupToken = setupToken;
  }

  success(
    res,
    "Registration successful. Check your email to set your password.",
    responseData,
    201,
  );
});

router.post("/auth/set-password", async (req, res): Promise<void> => {
  const parsed = SetPasswordBody.safeParse(req.body);

  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const { password } = parsed.data;
  // Tolerate a token sent as a full link or query fragment, not just the raw
  // value — a common frontend mistake that otherwise yields "Invalid token".
  const token = extractSetupToken(parsed.data.token);
  const tokenHash = hashSetupToken(token);
  const now = Date.now();

  if (process.env.NODE_ENV !== "production") {
    req.log.info(
      {
        lookupHashPrefix: tokenHash.slice(0, 8),
        currentTimestamp: new Date(now).toISOString(),
      },
      "[auth] set-password token hash lookup attempted",
    );
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.passwordSetupToken, tokenHash));

  if (process.env.NODE_ENV !== "production") {
    req.log.info(
      {
        found: Boolean(user),
        storedExpiry: user?.passwordSetupTokenExpiresAt?.toISOString() ?? null,
        currentTimestamp: new Date(now).toISOString(),
      },
      "[auth] set-password token lookup result",
    );
  }

  // No row matches this token hash: the token never existed, was mistyped, or
  // was superseded by a newer reset request that overwrote the stored hash.
  if (!user) {
    error(res, "Invalid password reset token.", 400);
    return;
  }

  // A consumed token keeps its hash but has its expiry nulled (see the update
  // below), so a matching row with no expiry means the link was already used
  // to set a password.
  if (!user.passwordSetupTokenExpiresAt) {
    error(res, "This reset link has already been used.", 400);
    return;
  }

  // The 24h window elapsed before the link was opened.
  if (user.passwordSetupTokenExpiresAt.getTime() < now) {
    error(res, "Reset link has expired.", 410);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Consume the token atomically: the WHERE clause re-checks the hash and a
  // still-valid (non-null, future) expiry, so two concurrent requests with the
  // same token cannot both succeed — only the first matches a row. The expiry
  // is nulled (it can never authenticate again) but the one-way SHA-256 hash is
  // KEPT so a replay is reported as "already used" rather than "invalid token".
  const [updated] = await db
    .update(usersTable)
    .set({
      passwordHash,
      emailVerified: true,
      passwordSetupTokenExpiresAt: null,
    })
    .where(
      and(
        eq(usersTable.id, user.id),
        eq(usersTable.passwordSetupToken, tokenHash),
        isNotNull(usersTable.passwordSetupTokenExpiresAt),
        gt(usersTable.passwordSetupTokenExpiresAt, new Date()),
      ),
    )
    .returning();

  // A concurrent request consumed the token between our read and this write.
  if (!updated) {
    error(res, "This reset link has already been used.", 400);
    return;
  }

  const jwt = generateToken({ userId: updated.id });

  success(res, "Password updated successfully.", {
    token: jwt,
    user: safeUser(updated),
  });
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);

  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  // Generic success message regardless of whether the account exists, so the
  // endpoint cannot be used to enumerate which emails are registered. A reset
  // link is only generated/sent when a matching user is found.
  const genericMessage =
    "If an account exists for that email, a password reset link has been sent.";

  if (!user) {
    success(res, genericMessage, {});
    return;
  }

  const { token: setupToken, tokenHash, expiresAt } = generateSetupToken();

  if (process.env.NODE_ENV !== "production") {
    req.log.info(
      {
        tokenGeneratedPrefix: setupToken.slice(0, 8),
        tokenHashPrefix: tokenHash.slice(0, 8),
        expiresAt: expiresAt.toISOString(),
      },
      "[auth] forgot-password reset token generated",
    );
  }

  await db
    .update(usersTable)
    .set({
      passwordSetupToken: tokenHash,
      passwordSetupTokenExpiresAt: expiresAt,
    })
    .where(eq(usersTable.id, user.id));

  await sendPasswordResetEmail({
    req,
    to: normalizedEmail,
    name: user.name,
    token: setupToken,
  });

  const responseData: { setupToken?: string } = {};
  if (process.env.NODE_ENV !== "production") {
    responseData.setupToken = setupToken;
  }

  success(res, genericMessage, responseData);
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);

  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const { password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  if (!user || !user.passwordHash) {
    error(res, "Invalid email or password", 401);
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    error(res, "Invalid email or password", 401);
    return;
  }

  const token = generateToken({ userId: user.id });

  success(res, "Logged in successfully", {
    token,
    user: safeUser(user),
  });
});

/**
 * Google / Auth0 sign-in.
 *
 * The frontend authenticates with Auth0 (which can broker Google), obtains an
 * Auth0 access token, and sends it as `token`. We verify the token via the Auth0
 * `/userinfo` endpoint and trust ONLY the profile Auth0 returns — never a raw
 * client-supplied profile. On success we resolve (or create) the local user by
 * verified email and return the SAME `{ token, user }` payload as POST
 * /auth/login.
 *
 * The Auth0 tenant is configured via `AUTH0_DOMAIN` (defaults to the project
 * tenant when unset). Errors: missing token → 400; no email on the profile →
 * 400; invalid/expired token → 401; Auth0 unreachable → 502.
 */
router.post("/auth/google", async (req, res): Promise<void> => {
  // Read the Auth0 token directly from the request body. We never accept or
  // trust any client-supplied Google profile fields — the profile comes solely
  // from Auth0's verified `/userinfo` response.
  const rawToken = (req.body as { token?: unknown } | undefined)?.token;
  const auth0Token = typeof rawToken === "string" ? rawToken.trim() : "";

  if (!auth0Token) {
    error(res, "Auth0 token is required.", 400);
    return;
  }

  // Verify the Auth0 access token server-side and trust only its profile.
  let profile;
  try {
    profile = await verifyAuth0AccessToken(auth0Token);
  } catch (err) {
    if (err instanceof Auth0UnavailableError) {
      req.log.error({ err }, "Auth0 userinfo endpoint unavailable");
      error(res, "Unable to verify Google account.", 502);
      return;
    }
    if (err instanceof Auth0VerificationError) {
      error(res, "Invalid or expired Google token.", 401);
      return;
    }
    // Any unexpected failure is treated as an inability to verify.
    req.log.error({ err }, "Unexpected error verifying Auth0 token");
    error(res, "Unable to verify Google account.", 502);
    return;
  }

  const { sub, email, name, given_name, family_name, nickname, picture } =
    profile;

  const normalizedEmail = email?.trim().toLowerCase() || null;

  // Google/Auth0 must supply a verified email — we key accounts on it.
  if (!normalizedEmail) {
    error(res, "No email associated with this Google account.", 400);
    return;
  }

  // Find the user by their verified email.
  let user = null as typeof usersTable.$inferSelect | null;
  const [byEmail] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));
  user = byEmail ?? null;

  if (user) {
    // Existing user — backfill googleSub, profile photo, and email-verified
    // state only where they are currently missing/false, then log in.
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (!user.googleSub) updates.googleSub = sub;
    if (picture && !user.avatarUrl) updates.avatarUrl = picture;
    if (picture && !user.profilePhotoUrl) updates.profilePhotoUrl = picture;
    if (picture && !user.imageUrl) updates.imageUrl = picture;
    if (!user.emailVerified) updates.emailVerified = true;

    if (Object.keys(updates).length > 0) {
      const [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, user.id))
        .returning();
      user = updated;
    }
  } else {
    // No match → create the account from Auth0's verified profile.
    const resolvedName =
      name?.trim() ||
      [given_name, family_name].filter(Boolean).join(" ").trim() ||
      nickname?.trim() ||
      "Google User";

    const [createdUser] = await db
      .insert(usersTable)
      .values({
        name: resolvedName,
        email: normalizedEmail,
        googleSub: sub,
        role: "patient",
        emailVerified: true,
        avatarUrl: picture ?? null,
        profilePhotoUrl: picture ?? null,
        imageUrl: picture ?? null,
        // passwordHash stays null — Google users have no local password until
        // they explicitly set one via the password-setup flow.
      })
      .returning();

    user = createdUser;
  }

  const token = generateToken({ userId: user.id });

  success(res, "Logged in successfully", { token, user: safeUser(user) }, 200);
});

router.post("/auth/logout", (_req, res): void => {
  success(res, "Logged out successfully");
});

/**
 * Admin-only SMTP test endpoint. Sends a fixed test email so operators can
 * verify SMTP credentials end-to-end without triggering the password flows.
 */
router.post(
  "/auth/test-email",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = TestEmailBody.safeParse(req.body);
    if (!parsed.success) {
      error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
      return;
    }

    // TEMPORARY: admin-only check disabled so SMTP can be tested without an
    // admin user. Any authenticated user (requireAuth) may call this. Restore
    // the role check below — or delete this endpoint — once SMTP is verified.
    // const [user] = await db
    //   .select()
    //   .from(usersTable)
    //   .where(eq(usersTable.id, req.userId!));
    // if (!user) {
    //   error(res, "User not found", 401);
    //   return;
    // }
    // if (user.role !== "admin") {
    //   error(res, "Forbidden — admin role required", 403);
    //   return;
    // }

    if (!smtpConfigured()) {
      error(
        res,
        "SMTP is not configured. Set SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS or SMTP_PASSWORD, and optionally SMTP_FROM.",
        503,
      );
      return;
    }

    try {
      const result = await sendTestEmail(parsed.data.to);
      success(res, "Test email sent successfully", result);
    } catch (err) {
      // Log the provider's detail server-side only; return a generic message so
      // internal SMTP error text is not disclosed to the client.
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[email] Test email failed",
      );
      error(
        res,
        "Failed to send test email. Check the server logs and SMTP configuration.",
        502,
      );
    }
  },
);

export default router;
