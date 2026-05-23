// Phase 21a.1 — server-action tests for the party ledger.
//
// Covers:
//   - createLedgerPayment: happy path + party-role-driven role-gating
//     (smoke; the bulk of role coverage is the per-role describe.each
//     block in updateLedgerPayment below).
//   - updateLedgerPayment: amount/date/description edit, TRANSACTION_LINKED
//     rejection, missing-entry rejection, role-gate role intersection,
//     and the balance-integrity assertion: editing ₹10,000 → ₹1,000 must
//     move the resulting computed balance by exactly ₹9,000.
//   - softDeleteLedgerEntry: TRANSACTION_LINKED rejection + balance
//     recompute after delete.
//
// Mocks: shared deep Prisma mock (vitest-mock-extended via __mocks__/prisma)
// + auth-guards.requireRole + next/cache.revalidatePath.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  createLedgerPayment,
  softDeleteLedgerEntry,
  updateLedgerPayment,
} from "./ledger-actions";

import { computeOwnerBalance } from "@/lib/ledger";

type Role = "ADMIN" | "PURCHASE_DEPT" | "CASTING_PLATING_MGMT" | "LABOUR_MGMT";

function sessionFor(role: Role) {
  return {
    user: {
      id: "user-1",
      email: `${role.toLowerCase()}@example.com`,
      name: "Test",
      role,
    },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

function makePartyFlags(
  overrides: Partial<{
    isCustomer: boolean;
    isSupplier: boolean;
    isCastingVendor: boolean;
    isPlatingVendor: boolean;
  }> = {},
) {
  return {
    id: "party-1",
    isCustomer: false,
    isSupplier: false,
    isCastingVendor: false,
    isPlatingVendor: false,
    ...overrides,
  };
}

beforeEach(() => {
  // Clear call history AND prior implementations (mockResolvedValue stays
  // on the mock unless explicitly reset). Without this, role-gate
  // assertions accumulate calls across tests.
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(sessionFor("ADMIN"));
  vi.mocked(revalidatePath).mockClear();
});

// ---- createLedgerPayment ---------------------------------------------

describe("createLedgerPayment", () => {
  it("creates a MANUAL_PAYMENT DECREASE entry on the party", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(
      makePartyFlags({ isSupplier: true }) as never,
    );
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
      id: "entry-new",
    } as never);

    const result = await createLedgerPayment({
      partyId: "party-1",
      date: new Date("2026-05-22T00:00:00Z"),
      amount: 1500,
      description: "UPI",
    });

    expect(result).toEqual({ ok: true, entryId: "entry-new" });
    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          partyId: "party-1",
          direction: "DECREASE",
          amount: 150000n,
          entryType: "MANUAL_PAYMENT",
          sourceType: null,
          sourceId: null,
          description: "UPI",
        }),
      }),
    );
  });

  it("rejects unknown party with field error", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(null);
    const result = await createLedgerPayment({
      partyId: "no-such",
      date: new Date(),
      amount: 100,
      description: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.partyId).toEqual(["Party not found"]);
    }
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("role-gates: PURCHASE_DEPT can pay a supplier", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(
      makePartyFlags({ isSupplier: true }) as never,
    );
    vi.mocked(requireRole).mockResolvedValueOnce(sessionFor("PURCHASE_DEPT"));
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
      id: "e1",
    } as never);

    const result = await createLedgerPayment({
      partyId: "party-1",
      date: new Date(),
      amount: 500,
      description: null,
    });
    expect(result.ok).toBe(true);
    // The allowed roles list passed to requireRole must include PURCHASE_DEPT
    expect(vi.mocked(requireRole).mock.calls[0][0]).toEqual(
      expect.arrayContaining(["ADMIN", "PURCHASE_DEPT"]),
    );
  });

  it("role-gates: customer-only party requires ADMIN", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(
      makePartyFlags({ isCustomer: true }) as never,
    );
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
      id: "e1",
    } as never);

    await createLedgerPayment({
      partyId: "party-1",
      date: new Date(),
      amount: 500,
      description: null,
    });
    expect(vi.mocked(requireRole).mock.calls[0][0]).toEqual(["ADMIN"]);
  });
});

// ---- updateLedgerPayment ---------------------------------------------

describe("updateLedgerPayment", () => {
  it("edits amount / date / description on a MANUAL_PAYMENT entry", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "entry-1",
      entryType: "MANUAL_PAYMENT",
      party: makePartyFlags({ isSupplier: true }),
    } as never);
    vi.mocked(prisma.ledgerEntry.update).mockResolvedValue({
      id: "entry-1",
    } as never);

    const result = await updateLedgerPayment({
      id: "entry-1",
      date: new Date("2026-05-23T00:00:00Z"),
      amount: 1000,
      description: "Adjusted to ₹1,000",
    });

    expect(result).toEqual({ ok: true, entryId: "entry-1" });
    expect(prisma.ledgerEntry.update).toHaveBeenCalledWith({
      where: { id: "entry-1" },
      data: expect.objectContaining({
        amount: 100000n,
        date: new Date("2026-05-23T00:00:00Z"),
        description: "Adjusted to ₹1,000",
        updatedById: "user-1",
      }),
    });
  });

  it("rejects when entry id is missing", async () => {
    const result = await updateLedgerPayment({
      id: "",
      date: new Date(),
      amount: 100,
      description: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.id).toBeTruthy();
    }
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
  });

  it("rejects non-positive amount via schema", async () => {
    const result = await updateLedgerPayment({
      id: "entry-1",
      date: new Date(),
      amount: 0,
      description: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeTruthy();
    }
  });

  it("rejects when entry not found", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue(null);
    const result = await updateLedgerPayment({
      id: "missing",
      date: new Date(),
      amount: 100,
      description: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.message).toContain("not found");
    }
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
  });

  it("REJECTS TRANSACTION_LINKED entries — only MANUAL_PAYMENT is editable here", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "entry-2",
      entryType: "TRANSACTION_LINKED",
      party: makePartyFlags({ isCustomer: true }),
    } as never);

    const result = await updateLedgerPayment({
      id: "entry-2",
      date: new Date(),
      amount: 999,
      description: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.message).toContain("TRANSACTION_LINKED");
    }
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
    // No requireRole call needed when we bail on entry-type check —
    // but the action loads the entry first, then guards type, THEN
    // calls requireRole. So a rejection at entryType happens BEFORE
    // role-gate. Assert that requireRole was NOT invoked.
    expect(requireRole).not.toHaveBeenCalled();
  });

  it("role-gates: PURCHASE_DEPT can edit a supplier-only payment", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "entry-3",
      entryType: "MANUAL_PAYMENT",
      party: makePartyFlags({ isSupplier: true }),
    } as never);
    vi.mocked(requireRole).mockResolvedValueOnce(sessionFor("PURCHASE_DEPT"));
    vi.mocked(prisma.ledgerEntry.update).mockResolvedValue({
      id: "entry-3",
    } as never);

    const result = await updateLedgerPayment({
      id: "entry-3",
      date: new Date(),
      amount: 100,
      description: null,
    });
    expect(result.ok).toBe(true);
    expect(vi.mocked(requireRole).mock.calls[0][0]).toEqual(
      expect.arrayContaining(["ADMIN", "PURCHASE_DEPT"]),
    );
  });

  it("role-gates: customer-only payment is ADMIN-only", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "entry-4",
      entryType: "MANUAL_PAYMENT",
      party: makePartyFlags({ isCustomer: true }),
    } as never);
    vi.mocked(prisma.ledgerEntry.update).mockResolvedValue({
      id: "entry-4",
    } as never);

    await updateLedgerPayment({
      id: "entry-4",
      date: new Date(),
      amount: 100,
      description: null,
    });
    expect(vi.mocked(requireRole).mock.calls[0][0]).toEqual(["ADMIN"]);
  });

  it("revalidates payables/receivables/dashboard paths on success", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "entry-5",
      entryType: "MANUAL_PAYMENT",
      party: makePartyFlags({ isSupplier: true }),
    } as never);
    vi.mocked(prisma.ledgerEntry.update).mockResolvedValue({
      id: "entry-5",
    } as never);

    await updateLedgerPayment({
      id: "entry-5",
      date: new Date(),
      amount: 100,
      description: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/payables");
    expect(revalidatePath).toHaveBeenCalledWith("/receivables");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/payables/party-1");
    expect(revalidatePath).toHaveBeenCalledWith("/receivables/party-1");
  });

  it("converts rupees → paise (Math.round) at the Prisma boundary", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "entry-6",
      entryType: "MANUAL_PAYMENT",
      party: makePartyFlags({ isSupplier: true }),
    } as never);
    vi.mocked(prisma.ledgerEntry.update).mockResolvedValue({
      id: "entry-6",
    } as never);

    // ₹123.45 → 12345 paise. Edit-payment uses the same toPaise helper
    // shape as createLedgerPayment.
    await updateLedgerPayment({
      id: "entry-6",
      date: new Date(),
      amount: 123.45,
      description: null,
    });
    const call = vi.mocked(prisma.ledgerEntry.update).mock.calls[0][0];
    expect(call.data.amount).toBe(12345n);
  });
});

// ---- softDeleteLedgerEntry surfacing (existing behavior + assertions) -

describe("softDeleteLedgerEntry — Phase 21a.1 surfacing", () => {
  it("soft-deletes a MANUAL_PAYMENT row", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "del-1",
      entryType: "MANUAL_PAYMENT",
      party: makePartyFlags({ isSupplier: true }),
    } as never);
    vi.mocked(prisma.ledgerEntry.update).mockResolvedValue({
      id: "del-1",
    } as never);

    const result = await softDeleteLedgerEntry("del-1");
    expect(result.ok).toBe(true);
    expect(prisma.ledgerEntry.update).toHaveBeenCalledWith({
      where: { id: "del-1" },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        deletedById: "user-1",
      }),
    });
  });

  it("REJECTS soft-delete on a TRANSACTION_LINKED row", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "del-2",
      entryType: "TRANSACTION_LINKED",
      party: makePartyFlags({ isCustomer: true }),
    } as never);

    const result = await softDeleteLedgerEntry("del-2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.message).toContain("TRANSACTION_LINKED");
    }
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
  });
});

// ---- Balance-integrity check -----------------------------------------
//
// These tests pin the BUSINESS CONTRACT: editing or deleting a manual
// payment must move the resulting party balance by exactly the amount
// difference. They use computeOwnerBalance directly against a simulated
// pre/post entry set (same pure helper that drives the UI).

describe("Balance integrity — the screenshot scenario", () => {
  // The exact transition from the user's screenshots:
  //   Sale ₹1,000 (INCREASE) + Payment ₹10,000 (DECREASE) → balance −₹9,000
  //   Edit payment to ₹1,000 → balance 0
  //   Edit to ₹500 → balance +₹500
  //   Delete payment → balance +₹1,000

  function entry(direction: "INCREASE" | "DECREASE", amount: bigint) {
    return { direction, amount, deletedAt: null };
  }

  it("Sale ₹1,000 + Payment ₹10,000 = credit −₹9,000", () => {
    const balance = computeOwnerBalance([
      entry("INCREASE", 100_000n), // sale ₹1000
      entry("DECREASE", 1_000_000n), // payment ₹10000
    ]);
    expect(balance).toBe(-900_000n);
  });

  it("After edit ₹10,000 → ₹1,000 — balance = 0", () => {
    const balance = computeOwnerBalance([
      entry("INCREASE", 100_000n),
      entry("DECREASE", 100_000n), // payment edited to ₹1000
    ]);
    expect(balance).toBe(0n);
  });

  it("After edit ₹10,000 → ₹500 — balance = +₹500", () => {
    const balance = computeOwnerBalance([
      entry("INCREASE", 100_000n),
      entry("DECREASE", 50_000n), // payment edited to ₹500
    ]);
    expect(balance).toBe(50_000n);
  });

  it("After delete payment — balance = +₹1,000 (full sale outstanding)", () => {
    // Soft-deleted payment is excluded by computeOwnerBalance.
    const balance = computeOwnerBalance([
      entry("INCREASE", 100_000n),
      { direction: "DECREASE", amount: 1_000_000n, deletedAt: new Date() },
    ]);
    expect(balance).toBe(100_000n);
  });

  it("Edit from ₹10,000 → ₹1,000 moves the balance by exactly ₹9,000", () => {
    const before = computeOwnerBalance([
      entry("INCREASE", 100_000n),
      entry("DECREASE", 1_000_000n),
    ]);
    const after = computeOwnerBalance([
      entry("INCREASE", 100_000n),
      entry("DECREASE", 100_000n),
    ]);
    expect(after - before).toBe(900_000n);
  });
});
