// Phase 21.fix — extracted Auth.js v5 jwt + session callbacks.
//
// Solves the stale-JWT security bug (CVE-class staleness): pre-fix the
// `if (user)` branch in the jwt callback only ran on initial sign-in,
// so role + deletedAt were baked into the token at login and never
// re-read. A demoted admin kept ADMIN access for up to 30 days
// (session maxAge); a deactivated user kept full access for 30 days.
//
// The fix re-reads the user from the DB on every request inside the
// jwt callback, and refreshes / invalidates the token accordingly.
// Combined with the parallel DB re-check in requireSession / requireRole
// (auth-guards.ts) this gives defense-in-depth: the jwt-callback fix
// covers proxy + page redirects + sidebar filtering (which all read
// session.user.role derived from the token); the guard-layer fix
// independently protects writes even if a future jwt-callback regression
// silently reopened the door.
//
// CRITICAL DESIGN POINT — transient DB error handling (FAIL-SAFE):
//   When the per-request DB read here THROWS or times out, we KEEP
//   the existing token unchanged. Do NOT return null. Returning null
//   would invalidate the session, which on a database hiccup means
//   EVERY user gets logged out simultaneously — a self-inflicted
//   outage. We only invalidate when the DB DEFINITIVELY confirms the
//   user is deactivated (deletedAt !== null) or gone (findUnique
//   returns null). Any other failure mode: trust the existing token
//   for this request, try again next request.
//
//   This asymmetry vs requireRole (which fails CLOSED on DB error)
//   is intentional. jwt runs on EVERY request including reads;
//   failing safe avoids the mass-logout DoS. requireRole runs only
//   on writes; failing closed prevents a stale-token write attack
//   during a DB blip. See auth-guards.ts for the matching rationale.
//
// Extracted to its own module (like Phase 16's authorize-credentials.ts)
// so tests can mock prisma and exercise the branches without pulling
// in the full NextAuth runtime.

import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";

// Minimal local types matching the Auth.js v5 shapes we use. Avoids
// importing from `next-auth` here (which would transitively pull in
// `next/server` and crash the vitest environment — same reason
// authorize-credentials.ts was extracted in Phase 16).

export type AppToken = {
  /** User id from the DB. Always present after initial sign-in. */
  id?: string;
  /** Current role. Refreshed on every request from the DB. */
  role?: Role;
  /** Auth.js standard fields we don't touch but must preserve. */
  [key: string]: unknown;
};

export type AppSignInUser = {
  id: string;
  role: Role;
  email?: string;
  name?: string;
};

export type JwtCallbackInput = {
  token: AppToken;
  /** Defined ONLY on initial sign-in (and Auth.js v5 `update` triggers).
   * Undefined on every subsequent request. */
  user?: AppSignInUser;
};

export type SessionCallbackInput = {
  session: { user?: { id?: string; role?: Role; [k: string]: unknown } };
  token: AppToken;
};

/**
 * jwt callback — per-request token resolution.
 *
 * Three paths:
 *   1. Initial sign-in (`user` present): seed token from the
 *      authorize() return value. Phase 16's authorizeCredentials
 *      already enforced the deactivation guard at this point, so
 *      we trust the user object.
 *   2. Subsequent request, DB confirms gone or deactivated:
 *      return `null` → Auth.js invalidates the session. The user's
 *      next request will be unauthenticated; a fresh login attempt
 *      will be rejected by authorizeCredentials (Phase 16 guard).
 *   3. Subsequent request, DB read fails or times out:
 *      keep the existing token unchanged. FAIL-SAFE. Prevents
 *      DB-blip mass logout.
 *   4. Subsequent request, DB shows user active: refresh
 *      `token.role` silently from the DB (handles role-change
 *      without forcing re-login) and return the token.
 */
export async function jwtCallback(
  input: JwtCallbackInput,
): Promise<AppToken | null> {
  const { token, user } = input;

  // Path 1 — initial sign-in. Seed the token from the user object.
  if (user) {
    token.id = user.id;
    token.role = user.role;
    return token;
  }

  // No user → subsequent request. Need a token.id to look up. If the
  // token somehow has no id (corrupt / pre-this-fix), KEEP it (don't
  // invalidate on bad shape; better UX than mysterious logout).
  if (!token.id) return token;

  // Per-request DB re-read. Wrapped in try/catch so transient errors
  // (network blip, pooler timeout) do NOT log the user out.
  let dbUser: { id: string; role: Role; deletedAt: Date | null } | null;
  try {
    dbUser = await prisma.user.findUnique({
      where: { id: token.id as string },
      select: { id: true, role: true, deletedAt: true },
    });
  } catch (err) {
    // FAIL-SAFE: a DB error must NOT invalidate the session.
    // Returning the existing token keeps the user logged in for this
    // request; the next request will retry the DB read.
    console.warn("[auth/jwt] DB read failed, keeping existing token:", err);
    return token;
  }

  // Path 2 — DB definitively says user is gone OR deactivated.
  // Return null → Auth.js invalidates the session cookie.
  if (!dbUser || dbUser.deletedAt !== null) {
    return null;
  }

  // Path 4 — refresh role silently (handles role-change without forcing
  // re-login; user's next request sees the new role).
  if (dbUser.role !== token.role) {
    token.role = dbUser.role;
  }
  return token;
}

/**
 * session callback — copy id + role from the (already-refreshed) token
 * onto the session.user object that server components / actions see.
 *
 * Pure pass-through. The freshness work happens in jwt; this just
 * exposes it.
 */
export function sessionCallback(input: SessionCallbackInput): SessionCallbackInput["session"] {
  const { session, token } = input;
  if (session.user) {
    if (typeof token.id === "string") session.user.id = token.id;
    if (token.role) session.user.role = token.role;
  }
  return session;
}
