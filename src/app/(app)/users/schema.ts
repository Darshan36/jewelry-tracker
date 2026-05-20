// Phase 16 — zod schemas for the User management UI.
//
// Three schemas because the three mutation surfaces have non-overlapping
// fields:
//   1. createUserInputSchema  — name, email, password, role
//   2. updateUserInputSchema  — name, email, role (NO password — separate flow)
//   3. resetPasswordInputSchema — password only
//
// Password is stored as a plaintext string in the INPUT shape but is
// hashed to bcrypt at the Prisma boundary inside the action. Schemas
// never see the hash; actions never see plaintext after the hash call.
//
// IMPORTANT — do not import Prisma Role here as a runtime value (same
// reason as employees/schema.ts: `import type { Role }` is safe; the
// value form pulls the Prisma runtime into the client bundle when the
// schema is reached via a client component).

import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "@/lib/password";

const roleEnum = z.enum([
  "ADMIN",
  "PURCHASE_DEPT",
  "LABOUR_MGMT",
  "CASTING_PLATING_MGMT",
]);

const passwordField = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  )
  .max(200, "Password too long");

export const createUserInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  // Lowercase + trim on parse so the case-insensitive lookup in auth
  // and the unique-check in the action both line up.
  email: z.string().trim().toLowerCase().email("Invalid email").max(200),
  password: passwordField,
  role: roleEnum,
});

export const updateUserInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().toLowerCase().email("Invalid email").max(200),
  role: roleEnum,
});

export const resetPasswordInputSchema = z.object({
  password: passwordField,
});

export type CreateUserInput = z.input<typeof createUserInputSchema>;
export type UpdateUserInput = z.input<typeof updateUserInputSchema>;
export type ResetPasswordInput = z.input<typeof resetPasswordInputSchema>;
