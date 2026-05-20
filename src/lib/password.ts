// Phase 16 — password hashing helper for user management.
//
// CRITICAL: this module MUST stay in lockstep with `src/lib/auth.ts`'s
// bcrypt.compare call. Both sides use `bcryptjs` (NOT `bcrypt` — pure-JS
// vs native binding; different binary formats are NOT interchangeable in
// edge cases). The salt-rounds cost (12) matches the cost embedded by
// `scripts/generate-test-users.mjs` for the seeded production users,
// so a uniform PHC string ($2a$12$...) appears across all hashes.
//
// Round-trip invariant (the Phase 16 walkthrough verifies this):
//   bcrypt.compare(plain, await hashPassword(plain)) === true
//
// Do NOT log or persist plaintext passwords ANYWHERE — not in stdout,
// not in error messages, not in DB columns, not in cookies. The plain
// value lives in memory only between the form submit and the hash call.

import bcrypt from "bcryptjs";

// 12 = ~250ms hash on the server. Matches `scripts/generate-test-users.mjs`
// and the bcrypt verifier in `src/lib/auth.ts`. Raising costs more CPU
// per login; dropping weakens existing hashes against offline attack.
// Keep at 12 unless you intend to migrate all existing hashes.
const BCRYPT_COST = 12;

/**
 * Hash a plaintext password using the canonical bcrypt setup. The
 * returned string is a self-contained PHC-style string that
 * `bcrypt.compare` in auth.ts will verify against on next login.
 *
 * Returns the hash; never the plaintext.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Minimum password length enforced at the schema layer. Surfaced as
 * a constant so the create/reset modals can show the same limit in
 * their helper text.
 */
export const MIN_PASSWORD_LENGTH = 8;
