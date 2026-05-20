// Phase 16 — password hashing round-trip tests.
//
// The bcrypt round-trip is the single security-critical contract
// between hashPassword (this module) and the bcrypt.compare call in
// auth.ts. These tests use the REAL bcryptjs library (no mock) to
// pin that any string we feed to hashPassword produces a hash that
// the same library's `compare` will verify.

import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

import { hashPassword, MIN_PASSWORD_LENGTH } from "./password";

describe("hashPassword", () => {
  it("produces a bcrypt-shaped string ($2a$12$...)", async () => {
    const hash = await hashPassword("testPassword1");
    // bcrypt PHC string format: $<algo>$<cost>$<22-char-salt><31-char-hash>
    expect(hash).toMatch(/^\$2[aby]\$12\$.{53}$/);
  });

  it("round-trip — bcrypt.compare verifies the hash against the plaintext", async () => {
    const plain = "secretRoundTrip$2026";
    const hash = await hashPassword(plain);
    const ok = await bcrypt.compare(plain, hash);
    expect(ok).toBe(true);
  });

  it("bcrypt.compare REJECTS a different plaintext against the same hash", async () => {
    const hash = await hashPassword("originalSecret1");
    const wrong = await bcrypt.compare("differentSecret1", hash);
    expect(wrong).toBe(false);
  });

  it("two hashes of the same plaintext are different (random salt) but both verify", async () => {
    const plain = "samePlain12";
    const h1 = await hashPassword(plain);
    const h2 = await hashPassword(plain);
    expect(h1).not.toBe(h2); // random salt
    expect(await bcrypt.compare(plain, h1)).toBe(true);
    expect(await bcrypt.compare(plain, h2)).toBe(true);
  });
});

describe("MIN_PASSWORD_LENGTH", () => {
  it("is exposed and >= 8", () => {
    // The form modals + schema both read this constant; pin the
    // lower bound so a future change can't silently weaken below 8.
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
  });
});
