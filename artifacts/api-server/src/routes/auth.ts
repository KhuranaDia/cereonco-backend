import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { RegisterBody, LoginBody, SetPasswordBody } from "@workspace/api-zod";
import {
  generateToken,
  generateSetupToken,
  generateTempPassword,
  hashSetupToken,
} from "../utils/token";
import { sendPasswordSetupEmail } from "../utils/email";
import { safeUser } from "../utils/safeUser";
import { success, error } from "../utils/response";

const router: IRouter = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const { name, email, role, specialty } = parsed.data;
  const countryCode = parsed.data.country_code ?? null;
  const phoneNumber = parsed.data.phone_number ?? null;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    error(res, "Email already in use", 409);
    return;
  }

  // No password is collected from the frontend. We internally generate a random
  // temporary password so passwordHash is never null, and issue a setup token so
  // the user can set their own password via the emailed link.
  const { token: setupToken, tokenHash, expiresAt } = generateSetupToken();
  const tempPasswordHash = await bcrypt.hash(generateTempPassword(), 10);

  const [user] = await db
    .insert(usersTable)
    .values({
      name,
      email,
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

  await sendPasswordSetupEmail({ req, to: email, name, token: setupToken });

  // Log the user in immediately by issuing a JWT.
  const token = generateToken({ userId: user.id });

  const data: {
    user: ReturnType<typeof safeUser>;
    token: string;
    setupToken?: string;
  } = {
    user: safeUser(user),
    token,
  };
  // Convenience for non-production testing only — lets Postman chain set-password
  // without reading server logs. Never exposed in production.
  if (process.env.NODE_ENV !== "production") {
    data.setupToken = setupToken;
  }

  success(
    res,
    "Registration successful. Check your email to set your password.",
    data,
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
  success(res, "Password set successfully", { token: jwt, user: safeUser(updated) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    error(res, parsed.error.issues.map((i) => i.message).join(", "), 400);
    return;
  }

  const { email, password } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

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
  success(res, "Logged in successfully", { token, user: safeUser(user) });
});

router.post("/auth/logout", (_req, res): void => {
  success(res, "Logged out successfully");
});

export default router;
