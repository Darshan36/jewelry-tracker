// Phase 21.fix — auth guards with parallel DB re-check.
//
// Layer-2 defense against stale JWT tokens. The primary fix lives in
// the jwt callback (src/lib/auth-callbacks.ts), which re-reads the user
// from the DB on every request and invalidates / refreshes the token
// accordingly. This file adds an INDEPENDENT DB re-check at the action
// layer so the security boundary holds even if a future jwt-callback
// regression silently re-froze the token.
//
// Pre-fix: requireSession / requireRole trusted session.user.role from
// the JWT (stale up to 30 days for role changes; never invalidated for
// deactivation). A user demoted ADMIN → PURCHASE_DEPT kept ADMIN access
// for the lifetime of their token. A deactivated user kept full access.
//
// Post-fix: every guard call does a single PK findUnique on `users` to
// confirm the user (a) still exists, (b) is not deactivated, and (c) has
// the current role. The fresh role from the DB drives the requireRole
// check — session.user.role is no longer trusted for authorization
// decisions (it stays available for display purposes but is not the
// source of truth).
//
// CRITICAL DESIGN POINT — transient DB error handling (FAIL-CLOSED):
//   When the per-call DB read here THROWS, the guard throws too. The
//   action is rejected with "Auth check failed". This is INTENTIONALLY
//   asymmetric vs the jwt callback's fail-SAFE behavior:
//
//     - jwt callback runs on EVERY request (reads + writes). Failing
//       open on DB error there would log every user out on any DB
//       hiccup — a self-inflicted outage. Fail safe (keep token).
//
//     - requireRole runs ONLY on writes (server actions). Failing
//       open on DB error here would let a deactivated user complete
//       a write that they shouldn't be able to. Fail closed.
//
//   Workshop scale (1-3 concurrent users) makes the cost of fail-closed
//   acceptable: a DB blip causes the user to retry the action; the next
//   attempt succeeds when the DB recovers. UX cost: one error toast.
//   Security cost of fail-open: silent stale-token writes during the
//   blip. We pay the smaller cost.
//
// Performance: each guard call adds one indexed PK findUnique
// (~5ms via the pooler). At ~1-3 concurrent users this is negligible.
// If this ever becomes hot (orders of magnitude more traffic), revisit
// — could cache via React's request-scoped cache().

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";

/** Throw shape consistent with the pre-fix module. Action callers expect
 * `Error("Unauthorized")` / `Error("Forbidden")` and surface them via
 * the existing result discriminator. */
class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}
class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

/** Internal — re-read the user from the DB by id and return their
 * current active status + role. Throws on DB error (caller handles).
 * Returns null if user not found OR deactivated. */
async function fetchActiveUserById(
  id: string,
): Promise<{ id: string; role: Role } | null> {
  const dbUser = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!dbUser || dbUser.deletedAt !== null) return null;
  return { id: dbUser.id, role: dbUser.role };
}

/**
 * Server-action auth guard — authenticated, role-agnostic.
 *
 * Validates that:
 *   1. A session cookie exists (Auth.js verified the JWT signature).
 *   2. The session's user id still maps to an ACTIVE user in the DB
 *      (handles stale token where the user was deactivated post-login).
 *
 * Throws "Unauthorized" on any failure. Throws "Auth check failed" on
 * a DB error (fail-closed per the file header rationale).
 *
 * Returns the session enriched with `user.role` set to the FRESH DB
 * role — callers downstream don't have to know about the staleness
 * concern; they get a trustworthy session object.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  const sessionUserId = session.user.id;
  if (!sessionUserId) throw new UnauthorizedError();

  let dbUser: { id: string; role: Role } | null;
  try {
    dbUser = await fetchActiveUserById(sessionUserId);
  } catch (err) {
    // FAIL-CLOSED at the action layer (intentional — see file header).
    console.error("[requireSession] DB check failed:", err);
    throw new Error("Auth check failed");
  }
  if (!dbUser) throw new UnauthorizedError();

  // Overwrite the role on the returned session with the FRESH DB value.
  // Mutating the session object is safe — Auth.js doesn't re-read it
  // after this point in the request.
  session.user.role = dbUser.role;
  return session;
}

/**
 * Server-action role guard — every mutating action calls this.
 *
 * Validates session + active-user (via requireSession) AND that the
 * fresh DB role is in the allowed list. The role check uses the
 * DB-fetched value, NOT session.user.role, so a stale JWT cannot
 * grant access.
 *
 * Throws:
 *   - "Unauthorized" — no session, or user deactivated/gone in DB
 *   - "Forbidden"    — user exists + active, but role not allowed
 *   - "Auth check failed" — DB error during the re-check (fail-closed)
 *
 * The proxy middleware enforces a parallel matrix at the URL level
 * (defense in depth — UX-layer redirects + action-layer blocks).
 */
export async function requireRole(allowedRoles: Role[]) {
  const session = await auth();
  if (!session?.user) throw new UnauthorizedError();
  const sessionUserId = session.user.id;
  if (!sessionUserId) throw new UnauthorizedError();

  let dbUser: { id: string; role: Role } | null;
  try {
    dbUser = await fetchActiveUserById(sessionUserId);
  } catch (err) {
    console.error("[requireRole] DB check failed:", err);
    throw new Error("Auth check failed");
  }
  if (!dbUser) throw new UnauthorizedError();

  // Authorization decision: FRESH role from DB, not session.user.role.
  // This is the layer that catches a stale JWT even if the jwt callback
  // regressed.
  if (!allowedRoles.includes(dbUser.role)) {
    throw new ForbiddenError();
  }

  // Refresh the role on the returned session (same reasoning as
  // requireSession). Callers see a current-state session.
  session.user.role = dbUser.role;
  return session;
}
