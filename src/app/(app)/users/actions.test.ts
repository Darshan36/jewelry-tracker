import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
// Mock the password helper to skip the real ~250ms bcrypt round-trip in
// every test. The password.test.ts file covers the real hash output.
vi.mock("@/lib/password", async () => {
  const actual = await vi.importActual<typeof import("@/lib/password")>(
    "@/lib/password",
  );
  return {
    ...actual,
    hashPassword: vi.fn(async (plain: string) => `bcrypt-fake-${plain}`),
  };
});

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guards";
import { revalidatePath } from "next/cache";
import { hashPassword } from "@/lib/password";

import {
  createUser,
  deactivateUser,
  listUsers,
  reactivateUser,
  resetUserPassword,
  updateUser,
} from "./actions";

const ADMIN_ID = "admin-id-A";

const adminSession = {
  user: {
    id: ADMIN_ID,
    email: "admin@example.com",
    name: "Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

function makeUser(
  overrides: Partial<{
    id: string;
    email: string;
    name: string;
    role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT";
    passwordHash: string;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    role: "PURCHASE_DEPT" as const,
    passwordHash: "$2a$12$existingHashSentinel",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(adminSession);
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(hashPassword).mockClear();
});

// The action result's `errors` is a discriminated union (zod field
// errors for one branch, `{ id: [...] }` for the "not found"
// branch). Tests don't care which branch — they care about specific
// field messages. Cast through this helper to keep call sites tidy.
function errs(r: { errors: unknown }): Record<string, string[] | undefined> {
  return r.errors as Record<string, string[] | undefined>;
}

// =====================================================================
// listUsers / getUserById
// =====================================================================

describe("listUsers", () => {
  it("returns serialized users without passwordHash", async () => {
    const row = makeUser({ passwordHash: "$2a$12$shouldNotLeak" });
    vi.mocked(prisma.user.findMany).mockResolvedValue([row]);

    const result = await listUsers();

    expect(result).toHaveLength(1);
    // Critical security assertion: the hash MUST NOT appear in any
    // returned property.
    expect((result[0] as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(JSON.stringify(result[0])).not.toContain("shouldNotLeak");
    expect(result[0].id).toBe("user-1");
    expect(result[0].email).toBe("alice@example.com");
  });

  it("orders deletedAt asc, then name asc", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await listUsers();
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ deletedAt: "asc" }, { name: "asc" }],
      }),
    );
  });

  it("gates with requireRole(['ADMIN'])", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await listUsers();
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(listUsers()).rejects.toThrow("Forbidden");
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

// =====================================================================
// createUser
// =====================================================================

describe("createUser", () => {
  it("happy path — hashes password, lowercases email, creates user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null); // email free
    vi.mocked(prisma.user.create).mockResolvedValueOnce(
      makeUser({ id: "new", email: "new@example.com", role: "PURCHASE_DEPT" }),
    );

    const result = await createUser({
      name: "New User",
      email: "NEW@Example.com",
      password: "secretX12",
      role: "PURCHASE_DEPT",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.email).toBe("new@example.com");
      expect((result.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
    }
    // Hash helper called with the PLAINTEXT password.
    expect(hashPassword).toHaveBeenCalledWith("secretX12");
    // Prisma.create received the HASHED value (the mock returns
    // `bcrypt-fake-<plain>`), never the plaintext.
    const callArg = vi.mocked(prisma.user.create).mock.calls[0][0];
    expect(callArg.data.passwordHash).toBe("bcrypt-fake-secretX12");
    expect(callArg.data.email).toBe("new@example.com");
    expect(revalidatePath).toHaveBeenCalledWith("/users");
  });

  it("rejects when email already exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(makeUser());

    const result = await createUser({
      name: "Dup",
      email: "alice@example.com",
      password: "secretX12",
      role: "PURCHASE_DEPT",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).email).toContain("A user with this email already exists");
    }
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("rejects short password (<8 chars) — DB never touched", async () => {
    const result = await createUser({
      name: "Bob",
      email: "bob@example.com",
      password: "short",
      role: "PURCHASE_DEPT",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).password?.[0]).toMatch(/at least 8/);
    }
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("rejects empty name", async () => {
    const result = await createUser({
      name: "",
      email: "x@example.com",
      password: "secretX12",
      role: "ADMIN",
    });
    expect(result.ok).toBe(false);
  });

  it("gates with requireRole(['ADMIN'])", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockResolvedValueOnce(makeUser());
    await createUser({
      name: "X",
      email: "x@example.com",
      password: "secretX12",
      role: "ADMIN",
    });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      createUser({
        name: "X",
        email: "x@example.com",
        password: "secretX12",
        role: "ADMIN",
      }),
    ).rejects.toThrow("Forbidden");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

// =====================================================================
// updateUser — G2 (self-demote) and G3 (last-admin demote) guardrails
// =====================================================================

describe("updateUser", () => {
  it("happy path — updates name, email, role", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(makeUser({ id: "u-x", role: "PURCHASE_DEPT" }))
      .mockResolvedValueOnce(null); // email-conflict pre-check returns null
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      makeUser({ id: "u-x", name: "Renamed", role: "LABOUR_MGMT" }),
    );

    const result = await updateUser("u-x", {
      name: "Renamed",
      email: "renamed@example.com",
      role: "LABOUR_MGMT",
    });

    expect(result.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-x" },
        data: expect.objectContaining({
          name: "Renamed",
          email: "renamed@example.com",
          role: "LABOUR_MGMT",
        }),
      }),
    );
  });

  it("rejects when target user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const result = await updateUser("ghost", {
      name: "X",
      email: "x@example.com",
      role: "ADMIN",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const flat = result.errors as Record<string, string[] | undefined>;
      expect(flat.id).toContain("User not found");
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // ----- G2: self-demote guard -----
  it("G2 — admin cannot change own role away from ADMIN", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: ADMIN_ID, role: "ADMIN" }),
    );

    const result = await updateUser(ADMIN_ID, {
      name: "Me",
      email: "admin@example.com",
      role: "PURCHASE_DEPT",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).role?.[0]).toMatch(/cannot change your own role/i);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("G2 — admin updating own name/email but keeping ADMIN role succeeds", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(makeUser({ id: ADMIN_ID, role: "ADMIN" }))
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      makeUser({ id: ADMIN_ID, name: "New Name", role: "ADMIN" }),
    );

    const result = await updateUser(ADMIN_ID, {
      name: "New Name",
      email: "admin@example.com",
      role: "ADMIN",
    });
    expect(result.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  // ----- G3: last-admin-demote guard -----
  it("G3 — demoting the only ACTIVE admin is rejected", async () => {
    // Target is some OTHER admin (not the session user), so G2 doesn't
    // trip — but they're the only active admin in the system.
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "only-admin", role: "ADMIN", deletedAt: null }),
    );
    vi.mocked(prisma.user.count).mockResolvedValueOnce(1); // only 1 active admin

    const result = await updateUser("only-admin", {
      name: "X",
      email: "only@example.com",
      role: "PURCHASE_DEPT",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).role?.[0]).toMatch(/only active administrator/i);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { role: "ADMIN", deletedAt: null },
    });
  });

  it("G3 — demoting an admin succeeds when another active admin exists", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(makeUser({ id: "other-admin", role: "ADMIN" }))
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.user.count).mockResolvedValueOnce(3); // multiple active admins
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      makeUser({ id: "other-admin", role: "PURCHASE_DEPT" }),
    );

    const result = await updateUser("other-admin", {
      name: "X",
      email: "other@example.com",
      role: "PURCHASE_DEPT",
    });
    expect(result.ok).toBe(true);
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("G3 — demoting a DEACTIVATED admin doesn't trigger the count check", async () => {
    // A deactivated admin's role demote is fine — they're not counted
    // toward active admins so removing them can't drop the active total.
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(
        makeUser({
          id: "dormant",
          role: "ADMIN",
          deletedAt: new Date("2026-01-01T00:00:00Z"),
        }),
      )
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      makeUser({ id: "dormant", role: "PURCHASE_DEPT" }),
    );

    const result = await updateUser("dormant", {
      name: "X",
      email: "dormant@example.com",
      role: "PURCHASE_DEPT",
    });
    expect(result.ok).toBe(true);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it("rejects when email change conflicts with another user", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(makeUser({ id: "u-x", email: "old@example.com" }))
      .mockResolvedValueOnce(makeUser({ id: "u-other", email: "taken@example.com" }));

    const result = await updateUser("u-x", {
      name: "X",
      email: "taken@example.com",
      role: "PURCHASE_DEPT",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).email?.[0]).toMatch(/already exists/);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("gates with requireRole(['ADMIN'])", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(makeUser({ id: "u-x" }))
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.user.update).mockResolvedValueOnce(makeUser());
    await updateUser("u-x", {
      name: "X",
      email: "x@example.com",
      role: "PURCHASE_DEPT",
    });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });
});

// =====================================================================
// resetUserPassword
// =====================================================================

describe("resetUserPassword", () => {
  it("happy path — re-hashes password, updates user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(makeUser({ id: "u-x" }));
    vi.mocked(prisma.user.update).mockResolvedValueOnce(makeUser({ id: "u-x" }));

    const result = await resetUserPassword("u-x", { password: "newSecret$1" });
    expect(result.ok).toBe(true);
    expect(hashPassword).toHaveBeenCalledWith("newSecret$1");
    const callArg = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(callArg.data.passwordHash).toBe("bcrypt-fake-newSecret$1");
    expect(callArg.where).toEqual({ id: "u-x" });
  });

  it("rejects short password — DB never touched", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(makeUser({ id: "u-x" }));
    const result = await resetUserPassword("u-x", { password: "tiny" });
    expect(result.ok).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("rejects when target user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const result = await resetUserPassword("ghost", { password: "longEnough1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const flat = result.errors as Record<string, string[] | undefined>;
      expect(flat.id).toContain("User not found");
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("gates with requireRole(['ADMIN'])", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(makeUser({ id: "u-x" }));
    vi.mocked(prisma.user.update).mockResolvedValueOnce(makeUser({ id: "u-x" }));
    await resetUserPassword("u-x", { password: "longEnough1" });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });
});

// =====================================================================
// deactivateUser — G1 (self-deactivate) and G3 (last-admin) guardrails
// =====================================================================

describe("deactivateUser", () => {
  it("happy path — sets deletedAt on a non-admin user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "u-x", role: "PURCHASE_DEPT", deletedAt: null }),
    );
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      makeUser({ id: "u-x", deletedAt: new Date() }),
    );

    const result = await deactivateUser("u-x");
    expect(result.ok).toBe(true);
    const callArg = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(callArg.data.deletedAt).toBeInstanceOf(Date);
  });

  // ----- G1: self-deactivate guard -----
  it("G1 — admin cannot deactivate own account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: ADMIN_ID, role: "ADMIN" }),
    );

    const result = await deactivateUser(ADMIN_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).id?.[0]).toMatch(/cannot deactivate your own account/i);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // ----- G3: last-admin guard on deactivate -----
  it("G3 — deactivating the only ACTIVE admin is rejected", async () => {
    // Target is some OTHER admin (not the session user), so G1 doesn't
    // trip. But removing them would leave the active-admin count at zero.
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "only-admin", role: "ADMIN", deletedAt: null }),
    );
    vi.mocked(prisma.user.count).mockResolvedValueOnce(1); // only 1 active

    const result = await deactivateUser("only-admin");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).id?.[0]).toMatch(/only active administrator/i);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("G3 — deactivating an admin succeeds when another active admin exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "extra-admin", role: "ADMIN", deletedAt: null }),
    );
    vi.mocked(prisma.user.count).mockResolvedValueOnce(2);
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      makeUser({ id: "extra-admin", deletedAt: new Date() }),
    );

    const result = await deactivateUser("extra-admin");
    expect(result.ok).toBe(true);
  });

  it("G3 — does not count check for non-admin deactivations", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "u-x", role: "PURCHASE_DEPT" }),
    );
    vi.mocked(prisma.user.update).mockResolvedValueOnce(
      makeUser({ id: "u-x", deletedAt: new Date() }),
    );

    await deactivateUser("u-x");
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it("rejects when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const result = await deactivateUser("ghost");
    expect(result.ok).toBe(false);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects when user already deactivated", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "u-x", deletedAt: new Date() }),
    );
    const result = await deactivateUser("u-x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).id?.[0]).toMatch(/already deactivated/i);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("gates with requireRole(['ADMIN'])", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "u-x", role: "PURCHASE_DEPT" }),
    );
    vi.mocked(prisma.user.update).mockResolvedValueOnce(makeUser());
    await deactivateUser("u-x");
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });
});

// =====================================================================
// reactivateUser
// =====================================================================

describe("reactivateUser", () => {
  it("happy path — clears deletedAt", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "u-x", deletedAt: new Date("2026-01-01") }),
    );
    vi.mocked(prisma.user.update).mockResolvedValueOnce(makeUser({ id: "u-x" }));

    const result = await reactivateUser("u-x");
    expect(result.ok).toBe(true);
    const callArg = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(callArg.data.deletedAt).toBeNull();
  });

  it("rejects when user already active", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "u-x", deletedAt: null }),
    );
    const result = await reactivateUser("u-x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(errs(result).id?.[0]).toMatch(/already active/i);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    const result = await reactivateUser("ghost");
    expect(result.ok).toBe(false);
  });

  it("gates with requireRole(['ADMIN'])", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      makeUser({ id: "u-x", deletedAt: new Date() }),
    );
    vi.mocked(prisma.user.update).mockResolvedValueOnce(makeUser());
    await reactivateUser("u-x");
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });
});

// =====================================================================
// Role gating across all actions — non-admin rejected.
// =====================================================================

describe("role gating — non-admin rejected", () => {
  const NON_ADMIN_ROLES = [
    "PURCHASE_DEPT",
    "LABOUR_MGMT",
    "CASTING_PLATING_MGMT",
  ] as const;

  for (const role of NON_ADMIN_ROLES) {
    it(`createUser denies ${role} (Forbidden via requireRole)`, async () => {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(
        createUser({
          name: "X",
          email: "x@example.com",
          password: "longEnough1",
          role: "PURCHASE_DEPT",
        }),
      ).rejects.toThrow("Forbidden");
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  }
});
