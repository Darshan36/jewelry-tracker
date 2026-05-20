// Phase 16 — extracted authorize logic.
//
// Lives in its own module so tests can import it without pulling in
// the full NextAuth runtime (which transitively requires `next/server`
// and crashes the test environment). `src/lib/auth.ts` imports this
// function and wires it into the Credentials provider's `authorize`.

import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";

const credentialsSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export type AuthorizedUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

/**
 * Validate the raw credentials payload, look up the user, run the
 * deactivation guard (Phase 16), and verify the password hash. Returns
 * the session-user object on success or `null` on any failure path.
 */
export async function authorizeCredentials(
  raw: unknown,
): Promise<AuthorizedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;

  // Phase 16: deactivated users (deletedAt set) are rejected even on
  // a correct password match. Check BEFORE bcrypt.compare — defensive
  // layering, and skips the ~250ms cost when we already know we'll
  // reject.
  if (user.deletedAt !== null) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
