import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const USER_ROLES = ["patient", "caregiver", "medical_professional", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const VERIFICATION_STATUSES = ["none", "pending", "approved", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("patient"),

  // Common profile fields
  bio: text("bio"),
  location: text("location"),
  avatarUrl: text("avatar_url"),
  profilePhotoUrl: text("profile_photo_url"),

  // Onboarding
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),

  // Patient / caregiver fields
  cancerType: text("cancer_type"),
  treatmentStage: text("treatment_stage"),
  interests: text("interests").array(),

  // Medical professional fields
  specialty: text("specialty"),
  hospitalAffiliation: text("hospital_affiliation"),
  medicalLicenseNumber: text("medical_license_number"),
  verificationStatus: text("verification_status")
    .$type<VerificationStatus>()
    .notNull()
    .default("none"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
