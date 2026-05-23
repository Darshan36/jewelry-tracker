import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be declared before any imports of the modules they replace.
// `vi.mock('@/lib/prisma')` resolves to `src/lib/__mocks__/prisma.ts`.
vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guards";
import { revalidatePath } from "next/cache";

import {
  createCustomer,
  softDeleteCustomer,
  updateCustomer,
} from "./actions";

const fakeSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    name: "Test Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

function makeParty(
  overrides: Partial<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "cuid-test",
    name: "Test Customer",
    phone: null,
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    isCustomer: false,
    isSupplier: false,
    isCastingVendor: false,
    isPlatingVendor: false,
    createdById: null,
    updatedById: null,
    deletedById: null,
    ...overrides,
  };
}

beforeEach(() => {
  // Default: auth succeeds with an ADMIN session. Tests can override via
  // vi.mocked(requireRole).mockRejectedValueOnce(...).
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
});

describe("createCustomer", () => {
  it("happy path — returns ok=true and writes through Prisma", async () => {
    vi.mocked(prisma.party.create).mockResolvedValue(
      makeParty({ id: "new-cuid", name: "New Customer" }),
    );

    const result = await createCustomer({
      name: "New Customer",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.customer.id).toBe("new-cuid");
    expect(prisma.party.create).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("rejects empty name — returns ok=false, DB not touched", async () => {
    const result = await createCustomer({
      name: "",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeDefined();
    expect(prisma.party.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid email — returns ok=false, DB not touched", async () => {
    const result = await createCustomer({
      name: "Test",
      phone: null,
      email: "notanemail",
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBeDefined();
    expect(prisma.party.create).not.toHaveBeenCalled();
  });

  it("propagates auth failure — throw bubbles up, DB not touched", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      createCustomer({
        name: "Test",
        phone: null,
        email: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(prisma.party.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateCustomer", () => {
  it("happy path — Prisma update called with where.deletedAt=null guard", async () => {
    vi.mocked(prisma.party.update).mockResolvedValue(
      makeParty({ id: "abc", name: "Updated" }),
    );

    const result = await updateCustomer("abc", {
      name: "Updated",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    expect(prisma.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("rejects empty name — DB update not called", async () => {
    const result = await updateCustomer("abc", {
      name: "",
      phone: null,
      email: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    expect(prisma.party.update).not.toHaveBeenCalled();
  });

  it("clearing phone passes null (not undefined) to Prisma — Phase 2.1 regression check", async () => {
    vi.mocked(prisma.party.update).mockResolvedValue(makeParty());

    await updateCustomer("abc", {
      name: "Test",
      phone: "", // user cleared the form field
      email: null,
      address: null,
      notes: null,
    });

    expect(prisma.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
        data: expect.objectContaining({ phone: null }), // critical: null, not undefined
      }),
    );
    // Belt-and-suspenders: directly inspect the call args.
    const call = vi.mocked(prisma.party.update).mock.calls[0][0];
    expect(call.data.phone).toBeNull();
    expect(call.data.phone).not.toBeUndefined();
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      updateCustomer("abc", {
        name: "Test",
        phone: null,
        email: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(prisma.party.update).not.toHaveBeenCalled();
  });
});

describe("softDeleteCustomer", () => {
  it("happy path — Prisma update called with where.deletedAt=null + data.deletedAt=<Date>", async () => {
    vi.mocked(prisma.party.update).mockResolvedValue(
      makeParty({ deletedAt: new Date() }),
    );

    const result = await softDeleteCustomer("abc");

    expect(result.ok).toBe(true);
    expect(prisma.party.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/customers");
  });

  it("deletedAt is a Date instance, not a string or number", async () => {
    vi.mocked(prisma.party.update).mockResolvedValue(makeParty());

    await softDeleteCustomer("abc");

    const call = vi.mocked(prisma.party.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteCustomer("abc")).rejects.toThrow("Unauthorized");

    expect(prisma.party.update).not.toHaveBeenCalled();
  });

  // Phase 21c.2 cascade fix: soft-deleting a party must also soft-
  // delete its active ledger_entries. Without this, orphan entries
  // leak into balance computations AND 404 the legacy
  // /receivables/[id] route. The same cascade shape is asserted in
  // suppliers + vendors tests because all three share the Party table.
  it("CASCADE — soft-delete propagates to active ledger entries (partyId match)", async () => {
    vi.mocked(prisma.party.update).mockResolvedValue(
      makeParty({ deletedAt: new Date() }),
    );

    await softDeleteCustomer("party-1");

    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { partyId: "party-1", deletedAt: null },
      }),
    );
    const call = vi.mocked(prisma.ledgerEntry.updateMany).mock.calls[0][0];
    expect(call.data).toMatchObject({
      deletedAt: expect.any(Date),
      deletedById: expect.any(String),
    });
  });
});

// =====================================================================
// Phase 5 RBAC — parameterised role matrix.
// Customers are ADMIN-only: only ADMIN succeeds; the three other roles
// must be rejected at the guard (Forbidden) before the DB is touched.
// 3 actions × 4 roles = 12 tests.
// =====================================================================

const ROLE_MATRIX = [
  ["ADMIN", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", false],
  ["CASTING_PLATING_MGMT", false],
] as const;

const validInput = {
  name: "Role Test",
  phone: null,
  email: null,
  address: null,
  notes: null,
};

function sessionFor(role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT") {
  return {
    user: { id: "u", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

describe.each(ROLE_MATRIX)("createCustomer role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.party.create).mockResolvedValue(makeParty());
      const r = await createCustomer(validInput);
      expect(r.ok).toBe(true);
      expect(prisma.party.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createCustomer(validInput)).rejects.toThrow("Forbidden");
      expect(prisma.party.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("updateCustomer role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.party.update).mockResolvedValue(makeParty());
      const r = await updateCustomer("abc", validInput);
      expect(r.ok).toBe(true);
      expect(prisma.party.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(updateCustomer("abc", validInput)).rejects.toThrow("Forbidden");
      expect(prisma.party.update).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("softDeleteCustomer role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.party.update).mockResolvedValue(makeParty({ deletedAt: new Date() }));
      const r = await softDeleteCustomer("abc");
      expect(r.ok).toBe(true);
      expect(prisma.party.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeleteCustomer("abc")).rejects.toThrow("Forbidden");
      expect(prisma.party.update).not.toHaveBeenCalled();
    }
  });
});
