import { auth } from "@/lib/auth";
import type { Role } from "@/generated/prisma";

/**
 * Server-action auth guard — authenticated, role agnostic.
 *
 * Throws "Unauthorized" if no session exists. Returns the session
 * for callers that need it (audit logging, etc.).
 *
 * Phase 5 made every action role-gated, so production action code
 * should prefer `requireRole(...)`. This helper is retained for tests
 * and any one-off "logged-in user" endpoints we add later.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

/**
 * Server-action role guard — every mutating action calls this.
 *
 * Throws "Unauthorized" if no session exists; "Forbidden" if the
 * session role is not in `allowedRoles`. Both halt the action before
 * any DB work.
 *
 * The proxy middleware enforces the same matrix at the route level
 * (defense in depth — UX layer redirects, action layer blocks even
 * direct fetch invocations).
 */
export async function requireRole(allowedRoles: Role[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (!allowedRoles.includes(session.user.role)) {
    throw new Error("Forbidden");
  }
  return session;
}
