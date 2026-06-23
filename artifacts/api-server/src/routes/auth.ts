import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
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
} from "../utils/token";
import {
  sendPasswordSetupEmail,
  sendPasswordResetEmail,
  sendTestEmail,
  smtpConfigured,
} from "../utils/email";
import { safeUser } from "../utils/safeUser";
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

  const { token, password } = parsed.data;
  const tokenHash = hashSetupToken(token);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.passwordSetupToken, tokenHash));

  if (
    !user ||
    !user.passwordSetupTokenExpiresAt ||
    user.passwordSetupTokenExpiresAt.getTime() < Date.now()
  ) {
    error(res, "Invalid or expired token", 400);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [updated] = await db
    .update(usersTable)
    .set({
      passwordHash,
      emailVerified: true,
      passwordSetupToken: null,
      passwordSetupTokenExpiresAt: null,
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  const jwt = generateToken({ userId: updated.id });

  success(res, "Password set successfully", {
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

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!));

    if (!user) {
      error(res, "User not found", 401);
      return;
    }
    if (user.role !== "admin") {
      error(res, "Forbidden — admin role required", 403);
      return;
    }

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
