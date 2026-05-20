"use server";

// Phase 16 — User management server actions.
//
// Every action gates `requireRole(['ADMIN'])` as its first await. Three
// self-protection guardrails are enforced HERE, server-side (UI mirrors
// them for UX, but the security boundary is this file):
//
//   G1: An admin cannot deactivate their own account.
//   G2: An admin cannot change their own role away from ADMIN.
//   G3: The system must always retain at least one active ADMIN — the
//       last active admin cannot be deactivated or demoted.
//
// G3 is the strongest guard. It applies even if some other admin
// happens to run the operation (i.e., "Alice deactivates Bob" must
// fail if Bob is the only active admin left, even though Alice would
// still be active after the change — wait, that's fine. The check is:
// after this operation lands, would there be at least one active
// ADMIN? If no → reject.). The transaction-level check uses a fresh
// `count` of active admins computed inside the same logical operation.
//
// Password hygiene:
//   - Plaintext only exists in memory between input parse and hash call.
//   - We NEVER log the password (no console.log of inputs).
//   - The returned `user` object goes through `serializeUser` which
//     strips `passwordHash`.

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

import {
  createUserInputSchema,
  resetPasswordInputSchema,
  updateUserInputSchema,
  type CreateUserInput,
  type ResetPasswordInput,
  type UpdateUserInput,
} from "./schema";
import { serializeUser, type UserForClient } from "./types";

// --- Internal helpers -----------------------------------------------

/**
 * Counts active (deletedAt IS NULL) admins. Used by the
 * "always ≥1 active admin" guardrail (G3) — both the deactivation
 * path and the role-change path check this before committing.
 */
async function countActiveAdmins(): Promise<number> {
  return prisma.user.count({
    where: { role: "ADMIN", deletedAt: null },
  });
}

// --- Actions --------------------------------------------------------

export async function listUsers(): Promise<UserForClient[]> {
  await requireRole(["ADMIN"]);
  const rows = await prisma.user.findMany({
    orderBy: [{ deletedAt: "asc" }, { name: "asc" }],
  });
  return rows.map(serializeUser);
}

export async function getUserById(
  id: string,
): Promise<UserForClient | null> {
  await requireRole(["ADMIN"]);
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? serializeUser(row) : null;
}

export async function createUser(input: CreateUserInput) {
  await requireRole(["ADMIN"]);

  const parsed = createUserInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // Pre-check email uniqueness explicitly so we can return a
  // field-keyed error instead of a generic Prisma constraint message.
  // Uniqueness covers ACTIVE + DEACTIVATED users — a deactivated user
  // still holds their email (their audit-trail FKs reference them).
  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) {
    return {
      ok: false as const,
      errors: { email: ["A user with this email already exists"] },
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const created = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
    },
  });

  revalidatePath("/users");
  return { ok: true as const, user: serializeUser(created) };
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const session = await requireRole(["ADMIN"]);

  const parsed = updateUserInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return {
      ok: false as const,
      errors: { id: ["User not found"] },
    };
  }

  // G2: an admin cannot self-demote (change own role away from ADMIN).
  const isSelf = session.user.id === id;
  if (isSelf && parsed.data.role !== "ADMIN") {
    return {
      ok: false as const,
      errors: {
        role: ["You cannot change your own role away from administrator"],
      },
    };
  }

  // G3: must always retain at least one active ADMIN. Applies if we
  // are demoting an existing ACTIVE admin (deletedAt IS NULL && role
  // === 'ADMIN' && new role !== 'ADMIN'). Promoting someone TO admin
  // never trips this; demoting a deactivated admin is harmless
  // (they didn't count toward the active total anyway).
  if (
    target.role === "ADMIN" &&
    target.deletedAt === null &&
    parsed.data.role !== "ADMIN"
  ) {
    const activeAdmins = await countActiveAdmins();
    if (activeAdmins <= 1) {
      return {
        ok: false as const,
        errors: {
          role: [
            "Cannot demote the only active administrator. Promote another user to ADMIN first.",
          ],
        },
      };
    }
  }

  // Email uniqueness check — only matters if email actually changed.
  if (parsed.data.email !== target.email) {
    const conflict = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (conflict && conflict.id !== id) {
      return {
        ok: false as const,
        errors: { email: ["A user with this email already exists"] },
      };
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
    },
  });

  revalidatePath("/users");
  return { ok: true as const, user: serializeUser(updated) };
}

export async function resetUserPassword(
  id: string,
  input: ResetPasswordInput,
) {
  await requireRole(["ADMIN"]);

  const parsed = resetPasswordInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return {
      ok: false as const,
      errors: { id: ["User not found"] },
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);

  await prisma.user.update({
    where: { id },
    data: { passwordHash },
  });

  revalidatePath("/users");
  return { ok: true as const };
}

export async function deactivateUser(id: string) {
  const session = await requireRole(["ADMIN"]);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return {
      ok: false as const,
      errors: { id: ["User not found"] },
    };
  }

  if (target.deletedAt !== null) {
    return {
      ok: false as const,
      errors: { id: ["User is already deactivated"] },
    };
  }

  // G1: an admin cannot deactivate their own account.
  if (session.user.id === id) {
    return {
      ok: false as const,
      errors: {
        id: ["You cannot deactivate your own account"],
      },
    };
  }

  // G3: must always retain at least one active ADMIN. Tripping only
  // if the target is an ACTIVE admin AND removing them would leave
  // zero active admins.
  if (target.role === "ADMIN") {
    const activeAdmins = await countActiveAdmins();
    if (activeAdmins <= 1) {
      return {
        ok: false as const,
        errors: {
          id: [
            "Cannot deactivate the only active administrator. Promote another user to ADMIN first.",
          ],
        },
      };
    }
  }

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/users");
  return { ok: true as const };
}

export async function reactivateUser(id: string) {
  await requireRole(["ADMIN"]);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return {
      ok: false as const,
      errors: { id: ["User not found"] },
    };
  }
  if (target.deletedAt === null) {
    return {
      ok: false as const,
      errors: { id: ["User is already active"] },
    };
  }

  await prisma.user.update({
    where: { id },
    data: { deletedAt: null },
  });

  revalidatePath("/users");
  return { ok: true as const };
}
