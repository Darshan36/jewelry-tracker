import { auth } from "@/lib/auth";

/**
 * Server-action auth guard.
 *
 * Every server action that mutates data should call this at the top.
 * Throws if no session exists.
 *
 * The Auth.js proxy/middleware handles route-level protection, but server
 * actions can be invoked directly via fetch and need their own guard.
 *
 * Returns the session for callers that need the user (e.g., audit logging).
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}
