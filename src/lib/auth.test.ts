// Phase 16 — authorizeCredentials unit tests.
//
// Pins the contract that drives login: parse → lookup → deletedAt
// guard → bcrypt → return session user OR null. The deactivated-user
// rejection (Phase 16 addition) is the critical assertion — without
// it the /users deactivate feature would be meaningless.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");
// Mock bcryptjs so tests don't pay the ~250ms compare cost. The
// password.test.ts file separately covers real bcrypt round-trip.
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn() },
  compare: vi.fn(),
}));

import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { authorizeCredentials } from "./authorize-credentials";

function makeUser(
  overrides: Partial<{
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT";
    passwordHash: string;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    role: "ADMIN" as const,
    passwordHash: "$2a$12$fakehash",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prisma.user.findUnique).mockReset();
  vi.mocked(bcrypt.compare).mockReset();
});

describe("authorizeCredentials", () => {
  it("happy path — returns user object on correct credentials", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "ok", role: "PURCHASE_DEPT" }),
    );
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as unknown as never);

    const result = await authorizeCredentials({
      email: "alice@example.com",
      password: "correctPass",
    });

    expect(result).toEqual({
      id: "ok",
      email: "alice@example.com",
      name: "Alice",
      role: "PURCHASE_DEPT",
    });
    // The returned object should NOT contain the passwordHash.
    expect((result as Record<string, unknown> | null)?.passwordHash).toBeUndefined();
  });

  it("returns null when credentials fail to parse", async () => {
    const result = await authorizeCredentials({
      email: "not-an-email",
      password: "x",
    });
    expect(result).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when user is not found in DB", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const result = await authorizeCredentials({
      email: "ghost@example.com",
      password: "any",
    });
    expect(result).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  // ----- Phase 16 — deactivated user rejection -----
  it("Phase 16 — REJECTS deactivated user even with correct password", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ deletedAt: new Date("2026-01-01T00:00:00Z") }),
    );
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as unknown as never);

    const result = await authorizeCredentials({
      email: "alice@example.com",
      password: "correctPass",
    });

    expect(result).toBeNull();
    // bcrypt.compare must NOT have been called — the deletedAt check
    // short-circuits before the hash compare runs.
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it("returns null when password doesn't match", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(makeUser());
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as unknown as never);

    const result = await authorizeCredentials({
      email: "alice@example.com",
      password: "wrongPass",
    });
    expect(result).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalledWith("wrongPass", "$2a$12$fakehash");
  });

  it("lowercases email before lookup (case-insensitive auth)", async () => {
    // Note: the schema chain is `.email().toLowerCase().trim()` — zod
    // validates the email FIRST against the raw input, so leading/
    // trailing spaces would be rejected (browser email inputs strip
    // them anyway). The transform we DO rely on is case-folding.
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(makeUser());
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as unknown as never);

    await authorizeCredentials({
      email: "ALICE@Example.com",
      password: "any",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "alice@example.com" },
    });
  });
});
