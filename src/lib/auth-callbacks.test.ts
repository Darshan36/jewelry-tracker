// Phase 21.fix — jwt + session callback tests.
//
// CRITICAL: this is auth code. The failure modes pin the most
// dangerous behaviors:
//   - FAIL-SAFE on DB error (do NOT invalidate the session — a
//     DB blip would log every user out simultaneously).
//   - INVALIDATE on definitive deactivation (return null).
//   - REFRESH role silently when DB shows a different role.
//   - SEED token on initial sign-in (preserve pre-fix happy path).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");

import { prisma } from "@/lib/prisma";
import {
  jwtCallback,
  sessionCallback,
  type AppSignInUser,
  type AppToken,
} from "./auth-callbacks";

beforeEach(() => {
  vi.mocked(prisma.user.findUnique).mockReset();
});

// --- jwt callback -------------------------------------------------------

describe("jwtCallback — initial sign-in (Path 1)", () => {
  it("seeds token.id + token.role from the user object", async () => {
    const user: AppSignInUser = { id: "u-1", role: "ADMIN" };
    const result = await jwtCallback({ token: {}, user });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("u-1");
    expect(result!.role).toBe("ADMIN");
    // No DB read on sign-in — authorizeCredentials already validated.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("PURCHASE_DEPT user sign-in seeds correct role", async () => {
    const user: AppSignInUser = { id: "u-2", role: "PURCHASE_DEPT" };
    const result = await jwtCallback({ token: {}, user });
    expect(result!.role).toBe("PURCHASE_DEPT");
  });
});

describe("jwtCallback — subsequent request, DB confirms active user", () => {
  it("returns token unchanged when DB role matches token role", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const token: AppToken = { id: "u-1", role: "ADMIN", iat: 12345 };
    const result = await jwtCallback({ token });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("u-1");
    expect(result!.role).toBe("ADMIN");
    // Preserves Auth.js standard fields (iat) on the token.
    expect(result!.iat).toBe(12345);
  });

  it("REFRESHES token.role when DB shows a different role (role-change live)", async () => {
    // Token was issued when user was ADMIN; admin demoted them.
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "PURCHASE_DEPT",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const token: AppToken = { id: "u-1", role: "ADMIN" };
    const result = await jwtCallback({ token });
    expect(result).not.toBeNull();
    expect(result!.role).toBe("PURCHASE_DEPT");
  });

  it("REFRESHES token.role on promotion (PURCHASE_DEPT → ADMIN)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const token: AppToken = { id: "u-1", role: "PURCHASE_DEPT" };
    const result = await jwtCallback({ token });
    expect(result!.role).toBe("ADMIN");
  });
});

describe("jwtCallback — subsequent request, DB shows DEACTIVATED user (Path 2)", () => {
  it("returns NULL when user.deletedAt is set (invalidates session)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
      deletedAt: new Date("2026-05-23"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const result = await jwtCallback({ token: { id: "u-1", role: "ADMIN" } });
    expect(result).toBeNull();
  });

  it("returns NULL when user doesn't exist in DB anymore", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const result = await jwtCallback({ token: { id: "ghost", role: "ADMIN" } });
    expect(result).toBeNull();
  });
});

describe("jwtCallback — FAIL-SAFE on DB error (the critical case)", () => {
  it("KEEPS existing token when prisma.findUnique THROWS", async () => {
    // Simulates a DB blip / pooler timeout / network glitch.
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(
      new Error("connection terminated"),
    );
    const token: AppToken = { id: "u-1", role: "ADMIN", iat: 999 };
    const result = await jwtCallback({ token });
    // MUST be the original token, NOT null. Returning null on a DB
    // blip would log every user out simultaneously — a self-inflicted
    // outage.
    expect(result).not.toBeNull();
    expect(result!.id).toBe("u-1");
    expect(result!.role).toBe("ADMIN");
    expect(result!.iat).toBe(999);
  });

  it("KEEPS token on prisma error even for a previously-known ADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(
      new Error("Connection timeout"),
    );
    const token: AppToken = { id: "admin-id", role: "ADMIN" };
    const result = await jwtCallback({ token });
    expect(result).not.toBeNull();
    expect(result!.role).toBe("ADMIN");
  });

  it("KEEPS token on prisma error for a scoped role user", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(
      new Error("ECONNRESET"),
    );
    const token: AppToken = { id: "u", role: "LABOUR_MGMT" };
    const result = await jwtCallback({ token });
    expect(result!.role).toBe("LABOUR_MGMT");
  });
});

describe("jwtCallback — defensive paths", () => {
  it("returns token unchanged when token has no id (corrupt / pre-fix shape)", async () => {
    // A token with no id can't be looked up. Don't invalidate (would
    // be hostile to legitimate users mid-session migration); keep it.
    const token: AppToken = { role: "ADMIN" };
    const result = await jwtCallback({ token });
    expect(result).not.toBeNull();
    expect(result!.role).toBe("ADMIN");
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

// --- session callback ----------------------------------------------------

describe("sessionCallback", () => {
  it("copies id + role from token to session.user", () => {
    const session = { user: { id: "old", role: "PURCHASE_DEPT" as const } };
    const token: AppToken = { id: "new", role: "ADMIN" };
    const result = sessionCallback({ session, token });
    expect(result.user!.id).toBe("new");
    expect(result.user!.role).toBe("ADMIN");
  });

  it("no-op when session.user is missing", () => {
    const session = { user: undefined } as Parameters<typeof sessionCallback>[0]["session"];
    const token: AppToken = { id: "x", role: "ADMIN" };
    const result = sessionCallback({ session, token });
    expect(result.user).toBeUndefined();
  });

  it("does not clobber token.id when token.id is undefined (defensive)", () => {
    const session = { user: { id: "keep", role: "ADMIN" as const } };
    const token: AppToken = { role: "ADMIN" };
    const result = sessionCallback({ session, token });
    expect(result.user!.id).toBe("keep");
  });
});
