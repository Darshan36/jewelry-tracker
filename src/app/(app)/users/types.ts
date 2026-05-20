// Phase 16 — shared types for the User management UI.
//
// Lives in its own non-'use server' module so server components, client
// components, and tests can all import these symbols. The serializer
// strips `passwordHash` (NEVER surfaced to the client) and the input
// schemas already exclude it.

import type { User } from "@/generated/prisma";

// What the client sees. The hash is stripped at serialize time so it
// can never accidentally land in a response payload, a Flight chunk,
// or a test snapshot.
export type UserForClient = Omit<User, "passwordHash">;

export function serializeUser(u: User): UserForClient {
  // Explicit destructure rather than `{ passwordHash: _, ...rest }`
  // so future User-shape additions don't accidentally leak through.
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    deletedAt: u.deletedAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}
