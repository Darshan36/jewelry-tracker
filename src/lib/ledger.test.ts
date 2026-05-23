// Phase 21a Gate 2 — ledger.ts unit tests.
//
// Coverage required by the build checkpoint:
//   - computeOwnerBalance: raw signed (no clamp); credit-balance case
//   - computeScopedBalance: multi-role / scoped-filter math
//   - describeTransactionLedgerEntry: pure description string builder
//   - writeTransactionLedgerEntry: tx.ledgerEntry.create payload
//   - updateTransactionLedgerEntry: all four party-change transitions
//   - softDeleteTransactionLedgerEntry: basic + return mirror
//   - writeReturnLedgerEntry / softDeleteReturnLedgerEntry: returns
//
// Atomicity rollback at the ACTION layer is covered separately in
// sales/actions.test.ts ("rolls back parent on ledger-write failure"
// — see end of this file for the atomicity test pattern).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");

import { prisma } from "@/lib/prisma";

import {
  computeOwnerBalance,
  computeScopedBalance,
  describePieceEntry,
  describeTransactionLedgerEntry,
  describeWagePayment,
  softDeleteReturnLedgerEntry,
  softDeleteTransactionLedgerEntry,
  updateTransactionLedgerEntry,
  writePieceEntryLedger,
  writeReturnLedgerEntry,
  writeTransactionLedgerEntry,
  writeWagePaymentLedger,
} from "./ledger";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Pure helpers -----------------------------------------------------

describe("describeTransactionLedgerEntry", () => {
  it("singular for 1 item", () => {
    expect(
      describeTransactionLedgerEntry({ sourceType: "SALE", lineItemCount: 1 }),
    ).toBe("Sale - 1 item");
  });

  it("plural for >1 items", () => {
    expect(
      describeTransactionLedgerEntry({ sourceType: "SALE", lineItemCount: 3 }),
    ).toBe("Sale - 3 items");
    expect(
      describeTransactionLedgerEntry({ sourceType: "PURCHASE", lineItemCount: 2 }),
    ).toBe("Purchase - 2 items");
    expect(
      describeTransactionLedgerEntry({ sourceType: "CASTING", lineItemCount: 5 }),
    ).toBe("Casting - 5 items");
    expect(
      describeTransactionLedgerEntry({ sourceType: "PLATING", lineItemCount: 4 }),
    ).toBe("Plating - 4 items");
  });

  it("returns generic label for SALE_RETURN / PURCHASE_RETURN (lineItemCount unused)", () => {
    expect(
      describeTransactionLedgerEntry({ sourceType: "SALE_RETURN", lineItemCount: 0 }),
    ).toBe("Sale return");
    expect(
      describeTransactionLedgerEntry({ sourceType: "PURCHASE_RETURN", lineItemCount: 99 }),
    ).toBe("Purchase return");
  });

  it("returns defensive fallback for karigar sourceTypes (call sites should use describePieceEntry / describeWagePayment)", () => {
    expect(
      describeTransactionLedgerEntry({ sourceType: "PIECE_ENTRY", lineItemCount: 1 }),
    ).toBe("Piece work");
    expect(
      describeTransactionLedgerEntry({ sourceType: "WAGE_PAYMENT", lineItemCount: 0 }),
    ).toBe("Wage payment");
  });
});

// Phase 21b — karigar-side description builders.
//
// These strings are what the 21c per-karigar khata view will render
// directly — pinning them now means the 21c view reads correctly the
// moment it's wired up.

describe("describePieceEntry (Phase 21b)", () => {
  it("plural: '50 pcs @ ₹15/pc — polishing' (with note)", () => {
    expect(
      describePieceEntry({
        count: 50,
        ratePerPiece: 1500n, // ₹15
        note: "polishing",
      }),
    ).toBe("50 pcs @ ₹15/pc — polishing");
  });

  it("plural without note: '20 pcs @ ₹40/pc'", () => {
    expect(
      describePieceEntry({
        count: 20,
        ratePerPiece: 4000n, // ₹40
        note: null,
      }),
    ).toBe("20 pcs @ ₹40/pc");
  });

  it("singular: '1 pc @ ₹2,500/pc — setting' (uses 'pc' not 'pcs')", () => {
    expect(
      describePieceEntry({
        count: 1,
        ratePerPiece: 250000n, // ₹2,500
        note: "setting",
      }),
    ).toBe("1 pc @ ₹2,500/pc — setting");
  });

  it("singular without note: '1 pc @ ₹100/pc'", () => {
    expect(
      describePieceEntry({
        count: 1,
        ratePerPiece: 10000n, // ₹100
        note: null,
      }),
    ).toBe("1 pc @ ₹100/pc");
  });

  it("rate with paise: '5 pcs @ ₹12.50/pc' (non-whole rupee shows decimals)", () => {
    expect(
      describePieceEntry({
        count: 5,
        ratePerPiece: 1250n, // ₹12.50
        note: null,
      }),
    ).toBe("5 pcs @ ₹12.50/pc");
  });

  it("Indian comma grouping for large rates: '1 pc @ ₹1,00,000/pc'", () => {
    expect(
      describePieceEntry({
        count: 1,
        ratePerPiece: 10_000_000n, // ₹1,00,000
        note: null,
      }),
    ).toBe("1 pc @ ₹1,00,000/pc");
  });

  it("trims whitespace from note", () => {
    expect(
      describePieceEntry({
        count: 2,
        ratePerPiece: 5000n,
        note: "  polishing  ",
      }),
    ).toBe("2 pcs @ ₹50/pc — polishing");
  });

  it("empty-string note is treated as absent", () => {
    expect(
      describePieceEntry({
        count: 3,
        ratePerPiece: 2000n,
        note: "",
      }),
    ).toBe("3 pcs @ ₹20/pc");
  });

  it("does NOT embed the line total in the description (the amount column shows it)", () => {
    const desc = describePieceEntry({
      count: 50,
      ratePerPiece: 1500n,
      note: "polishing",
    });
    expect(desc).not.toMatch(/₹750/);
    expect(desc).not.toMatch(/=/);
  });
});

describe("describeWagePayment (Phase 21b)", () => {
  it("with note: 'Wage payment — advance for next week'", () => {
    expect(describeWagePayment({ note: "advance for next week" })).toBe(
      "Wage payment — advance for next week",
    );
  });

  it("without note: 'Wage payment'", () => {
    expect(describeWagePayment({ note: null })).toBe("Wage payment");
  });

  it("undefined note also produces 'Wage payment'", () => {
    expect(describeWagePayment({})).toBe("Wage payment");
  });

  it("trims whitespace", () => {
    expect(describeWagePayment({ note: "  advance  " })).toBe(
      "Wage payment — advance",
    );
  });

  it("empty-string note is treated as absent", () => {
    expect(describeWagePayment({ note: "" })).toBe("Wage payment");
  });

  it("advance is just a wage payment with a note (no separate enum)", () => {
    // Pinning the data-model decision: there's no "Advance" entry type.
    // An advance is a wage payment whose note happens to say "advance".
    expect(describeWagePayment({ note: "advance" })).toBe(
      "Wage payment — advance",
    );
  });
});

describe("computeOwnerBalance (Phase 21b rename — owner-agnostic)", () => {
  // Phase 21c.2: the `computeOwnerBalance` @deprecated alias was
  // dropped in 21c.2. All callers (5 in outstanding-balances.ts) were
  // renamed to computeOwnerBalance. Tests below cover the unified
  // helper directly.

  it("owner-agnostic: identical math on karigar-shape entries (employee owner) as on party entries", () => {
    // The helper takes LedgerEntryLike[] — direction + amount +
    // deletedAt — and doesn't care about partyId vs employeeId.
    const entries = [
      { direction: "INCREASE" as const, amount: 100_000n, deletedAt: null }, // ₹1,000 piece
      { direction: "DECREASE" as const, amount: 50_000n, deletedAt: null }, // ₹500 wage
    ];
    expect(computeOwnerBalance(entries)).toBe(50_000n);
  });

  it("ADVANCE scenario: DECREASE before any INCREASE produces a credit balance", () => {
    // Owner records ₹500 advance to karigar BEFORE any piece work →
    // running balance is −₹500 (karigar holds advance against future
    // work). Direct support for the "advance = credit balance" model.
    expect(
      computeOwnerBalance([
        { direction: "DECREASE", amount: 50_000n, deletedAt: null },
      ]),
    ).toBe(-50_000n);
  });
});

describe("computeOwnerBalance (raw signed, no clamp)", () => {
  // Phase 21c.2: was "computeOwnerBalance" pre-rename; same body,
  // renamed in 21c.2 along with the alias drop.
  it("returns 0n for empty entries", () => {
    expect(computeOwnerBalance([])).toBe(0n);
  });

  it("sums INCREASE − DECREASE", () => {
    expect(
      computeOwnerBalance([
        { direction: "INCREASE", amount: 50000n, deletedAt: null },
        { direction: "DECREASE", amount: 20000n, deletedAt: null },
      ]),
    ).toBe(30000n);
  });

  it("excludes soft-deleted entries", () => {
    expect(
      computeOwnerBalance([
        { direction: "INCREASE", amount: 50000n, deletedAt: null },
        { direction: "INCREASE", amount: 99999n, deletedAt: new Date() }, // ignored
        { direction: "DECREASE", amount: 10000n, deletedAt: null },
      ]),
    ).toBe(40000n);
  });

  it("CREDIT-BALANCE CASE: returns NEGATIVE bigint when DECREASE > INCREASE (no clamp)", () => {
    // Customer paid ₹10,000 against a ₹8,000 sale → credit balance −₹2,000.
    // The whole point of the ledger model: negative balance is a legal,
    // representable state ("party has prepaid; we owe them back").
    // Raw signed math — NEVER clamp to 0.
    const balance = computeOwnerBalance([
      { direction: "INCREASE", amount: 800000n, deletedAt: null },
      { direction: "DECREASE", amount: 1000000n, deletedAt: null },
    ]);
    expect(balance).toBe(-200000n);
    expect(balance).toBeLessThan(0n);
  });

  it("handles all-DECREASE (over-refunded transaction or pre-payment)", () => {
    expect(
      computeOwnerBalance([
        { direction: "DECREASE", amount: 50000n, deletedAt: null },
        { direction: "DECREASE", amount: 30000n, deletedAt: null },
      ]),
    ).toBe(-80000n);
  });
});

describe("computeScopedBalance (sourceType-filtered, excludes MANUAL_PAYMENT)", () => {
  it("filters to allowed sourceTypes; ignores MANUAL_PAYMENT (sourceType IS NULL)", () => {
    const entries = [
      { direction: "INCREASE" as const, amount: 500000n, deletedAt: null, sourceType: "PURCHASE" as const },
      { direction: "INCREASE" as const, amount: 400000n, deletedAt: null, sourceType: "CASTING" as const },
      // MANUAL_PAYMENT — sourceType NULL — must be excluded from scoped view
      { direction: "DECREASE" as const, amount: 300000n, deletedAt: null, sourceType: null },
    ];
    expect(computeScopedBalance(entries, ["PURCHASE"])).toBe(500000n);
    expect(computeScopedBalance(entries, ["CASTING"])).toBe(400000n);
    expect(computeScopedBalance(entries, ["PURCHASE", "PURCHASE_RETURN"])).toBe(500000n);
  });

  it("MULTI-ROLE EXAMPLE: party is both supplier + casting vendor — scoped views diverge from ADMIN", () => {
    // Real seed scenario: party B has ₹3,000 purchase + ₹4,000 casting +
    // ₹3,000 cross-activity MANUAL_PAYMENT. ADMIN sees ₹4,000 net;
    // scoped roles see their activity-only slice (₹3,000 purchase or
    // ₹4,000 casting). The footnote rule says "scoped views excludes
    // MANUAL_PAYMENT" so multi-role parties show activity-by-scope.
    const entries = [
      { direction: "INCREASE" as const, amount: 300000n, deletedAt: null, sourceType: "PURCHASE" as const },
      { direction: "INCREASE" as const, amount: 400000n, deletedAt: null, sourceType: "CASTING" as const },
      { direction: "DECREASE" as const, amount: 100000n, deletedAt: null, sourceType: null }, // manual payment 1
      { direction: "DECREASE" as const, amount: 200000n, deletedAt: null, sourceType: null }, // manual payment 2
    ];
    // PURCHASE_DEPT scope: ₹3,000 — sees purchase only, no payments
    expect(computeScopedBalance(entries, ["PURCHASE", "PURCHASE_RETURN"])).toBe(300000n);
    // CASTING_PLATING_MGMT scope: ₹4,000 — sees casting only
    expect(computeScopedBalance(entries, ["CASTING", "PLATING"])).toBe(400000n);
    // ADMIN scope uses computeOwnerBalance instead (sees MANUAL_PAYMENT):
    expect(computeOwnerBalance(entries)).toBe(400000n); // 300+400-100-200 = 400
  });

  it("includes returns (SALE_RETURN / PURCHASE_RETURN) as DECREASE in scope", () => {
    const entries = [
      { direction: "INCREASE" as const, amount: 500000n, deletedAt: null, sourceType: "PURCHASE" as const },
      { direction: "DECREASE" as const, amount: 50000n, deletedAt: null, sourceType: "PURCHASE_RETURN" as const },
    ];
    expect(computeScopedBalance(entries, ["PURCHASE", "PURCHASE_RETURN"])).toBe(450000n);
  });

  it("excludes soft-deleted entries", () => {
    expect(
      computeScopedBalance(
        [
          { direction: "INCREASE", amount: 50000n, deletedAt: null, sourceType: "PURCHASE" },
          { direction: "INCREASE", amount: 99999n, deletedAt: new Date(), sourceType: "PURCHASE" },
        ],
        ["PURCHASE"],
      ),
    ).toBe(50000n);
  });
});

// ---- writeTransactionLedgerEntry --------------------------------------

describe("writeTransactionLedgerEntry", () => {
  it("creates an INCREASE ledger row with auto-derived description + audit fields", async () => {
    await writeTransactionLedgerEntry(prisma, {
      partyId: "party-1",
      date: new Date("2026-05-22T00:00:00Z"),
      sourceType: "SALE",
      sourceId: "sale-123",
      amount: 50000n,
      lineItemCount: 3,
      userId: "user-1",
    });

    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data).toMatchObject({
      partyId: "party-1",
      direction: "INCREASE",
      amount: 50000n,
      description: "Sale - 3 items",
      entryType: "TRANSACTION_LINKED",
      sourceType: "SALE",
      sourceId: "sale-123",
      createdById: "user-1",
      updatedById: "user-1",
    });
  });

  it("threads through PURCHASE source type + plural-singular description", async () => {
    await writeTransactionLedgerEntry(prisma, {
      partyId: "p2",
      date: new Date(),
      sourceType: "PURCHASE",
      sourceId: "pu-1",
      amount: 100000n,
      lineItemCount: 1,
      userId: null,
    });
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data.description).toBe("Purchase - 1 item");
    expect(call.data.sourceType).toBe("PURCHASE");
    expect(call.data.createdById).toBeNull();
  });
});

// ---- updateTransactionLedgerEntry — FOUR transitions ------------------

describe("updateTransactionLedgerEntry (four party-change transitions)", () => {
  it("TRANSITION 1: walk-in → party — migrates *Payment rows + creates linked entry", async () => {
    // No prior ledger entry. *Payment rows from the walk-in era exist.
    vi.mocked(prisma.salePayment.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "sp-1", date: new Date(), amount: 30000n, type: "PAYMENT", note: "cash", deletedAt: null } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "sp-2", date: new Date(), amount: 5000n, type: "REFUND", note: null, deletedAt: null } as any,
    ]);

    await updateTransactionLedgerEntry(prisma, {
      sourceType: "SALE",
      sourceId: "sale-X",
      oldPartyId: null, // walk-in
      newPartyId: "newParty", // becomes party-linked
      newDate: new Date("2026-05-22"),
      newAmount: 100000n,
      newLineItemCount: 2,
      userId: "user-1",
    });

    // Walk-in payments migrated to MANUAL_PAYMENT entries
    expect(prisma.ledgerEntry.create).toHaveBeenCalledTimes(3); // 2 migrated + 1 transaction-linked
    const created = vi.mocked(prisma.ledgerEntry.create).mock.calls.map((c) => c[0].data);
    // PAYMENT-typed *Payment → DECREASE
    expect(created[0]).toMatchObject({
      partyId: "newParty",
      direction: "DECREASE",
      amount: 30000n,
      entryType: "MANUAL_PAYMENT",
      sourceType: null,
      sourceId: null,
    });
    // REFUND-typed *Payment → INCREASE (sign reversal)
    expect(created[1]).toMatchObject({
      direction: "INCREASE",
      amount: 5000n,
      entryType: "MANUAL_PAYMENT",
    });
    // TRANSACTION_LINKED INCREASE for the now-party-linked sale
    expect(created[2]).toMatchObject({
      partyId: "newParty",
      direction: "INCREASE",
      amount: 100000n,
      entryType: "TRANSACTION_LINKED",
      sourceType: "SALE",
      sourceId: "sale-X",
    });

    // Walk-in *Payment rows soft-deleted in place
    expect(prisma.salePayment.updateMany).toHaveBeenCalledOnce();
  });

  it("TRANSITION 2: party → same-party — in-place update, partyId NOT mutated", async () => {
    vi.mocked(prisma.ledgerEntry.findFirst).mockResolvedValueOnce({
      id: "le-existing",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await updateTransactionLedgerEntry(prisma, {
      sourceType: "SALE",
      sourceId: "sale-Y",
      oldPartyId: "partyA",
      newPartyId: "partyA", // same!
      newDate: new Date("2026-05-22"),
      newAmount: 75000n,
      newLineItemCount: 1,
      userId: "user-2",
    });

    // No soft-delete, no create — pure update
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.updateMany).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.update).toHaveBeenCalledOnce();
    const updateCall = vi.mocked(prisma.ledgerEntry.update).mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: "le-existing" });
    expect(updateCall.data).toMatchObject({
      amount: 75000n,
      description: "Sale - 1 item",
      updatedById: "user-2",
    });
    // CRITICAL: partyId must NOT appear in the update payload
    expect(updateCall.data).not.toHaveProperty("partyId");
  });

  it("TRANSITION 2 — backfill case: party→same but no existing ledger entry → create one defensively", async () => {
    vi.mocked(prisma.ledgerEntry.findFirst).mockResolvedValueOnce(null);

    await updateTransactionLedgerEntry(prisma, {
      sourceType: "PURCHASE",
      sourceId: "pu-Z",
      oldPartyId: "partyA",
      newPartyId: "partyA",
      newDate: new Date(),
      newAmount: 10000n,
      newLineItemCount: 1,
      userId: null,
    });

    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
  });

  it("TRANSITION 3: party → OTHER party — soft-delete old + create new (clean audit)", async () => {
    await updateTransactionLedgerEntry(prisma, {
      sourceType: "CASTING",
      sourceId: "ce-1",
      oldPartyId: "partyOld",
      newPartyId: "partyNew",
      newDate: new Date(),
      newAmount: 200000n,
      newLineItemCount: 1,
      userId: "user-3",
    });

    // 1. soft-delete old entry on partyOld
    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledOnce();
    const softDelCall = vi.mocked(prisma.ledgerEntry.updateMany).mock.calls[0][0];
    expect(softDelCall.where).toMatchObject({
      sourceType: "CASTING",
      sourceId: "ce-1",
      deletedAt: null,
    });
    expect(softDelCall.data).toMatchObject({
      deletedById: "user-3",
    });
    // 2. create fresh entry on partyNew — NOT on partyOld
    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const createCall = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(createCall.data.partyId).toBe("partyNew");
    expect(createCall.data.amount).toBe(200000n);
  });

  it("TRANSITION 4: party → walk-in — soft-delete entry, NO create", async () => {
    await updateTransactionLedgerEntry(prisma, {
      sourceType: "SALE",
      sourceId: "sale-W",
      oldPartyId: "partyA",
      newPartyId: null, // becomes walk-in
      newDate: new Date(),
      newAmount: 99999n,
      newLineItemCount: 1,
      userId: "user-4",
    });

    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledOnce();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("EDGE: walk-in → walk-in — no ledger touch at all", async () => {
    await updateTransactionLedgerEntry(prisma, {
      sourceType: "SALE",
      sourceId: "sale-V",
      oldPartyId: null,
      newPartyId: null,
      newDate: new Date(),
      newAmount: 50000n,
      newLineItemCount: 1,
      userId: null,
    });

    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.updateMany).not.toHaveBeenCalled();
    expect(prisma.salePayment.findMany).not.toHaveBeenCalled();
  });
});

// ---- softDeleteTransactionLedgerEntry (cascade from parent soft-delete)

describe("softDeleteTransactionLedgerEntry", () => {
  it("soft-deletes the active linked entry via updateMany WHERE sourceType+sourceId+deletedAt:null", async () => {
    await softDeleteTransactionLedgerEntry(prisma, {
      sourceType: "PURCHASE",
      sourceId: "pu-cascade",
      userId: "user-99",
    });

    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.ledgerEntry.updateMany).mock.calls[0][0];
    expect(call.where).toMatchObject({
      sourceType: "PURCHASE",
      sourceId: "pu-cascade",
      deletedAt: null,
    });
    expect(call.data).toMatchObject({
      deletedById: "user-99",
    });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("no-op (zero rows updated) when no active entry exists (walk-in soft-delete)", async () => {
    vi.mocked(prisma.ledgerEntry.updateMany).mockResolvedValueOnce({ count: 0 });

    // Function returns void; just confirm it doesn't throw.
    await expect(
      softDeleteTransactionLedgerEntry(prisma, {
        sourceType: "SALE",
        sourceId: "sale-walk-in",
        userId: null,
      }),
    ).resolves.toBeUndefined();
  });
});

// ---- writeReturnLedgerEntry / softDeleteReturnLedgerEntry --------------

describe("writeReturnLedgerEntry (returns DECREASE)", () => {
  it("creates a DECREASE entry with SALE_RETURN sourceType + return.id as sourceId", async () => {
    await writeReturnLedgerEntry(prisma, {
      partyId: "partyA",
      date: new Date("2026-05-22"),
      sourceType: "SALE_RETURN",
      sourceId: "sr-1", // the SaleReturn row's id, NOT the parent sale's id
      amount: 30000n,
      userId: "user-5",
    });

    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data).toMatchObject({
      partyId: "partyA",
      direction: "DECREASE", // confirmed in plan point 3b
      amount: 30000n,
      description: "Sale return",
      entryType: "TRANSACTION_LINKED",
      sourceType: "SALE_RETURN",
      sourceId: "sr-1",
    });
  });

  it("PURCHASE_RETURN direction is DECREASE (shop returning to supplier reduces what shop owes)", async () => {
    await writeReturnLedgerEntry(prisma, {
      partyId: "partyB",
      date: new Date(),
      sourceType: "PURCHASE_RETURN",
      sourceId: "pr-1",
      amount: 50000n,
      userId: null,
    });
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data.direction).toBe("DECREASE");
    expect(call.data.description).toBe("Purchase return");
    expect(call.data.sourceType).toBe("PURCHASE_RETURN");
  });
});

describe("softDeleteReturnLedgerEntry", () => {
  it("delegates to softDeleteTransactionLedgerEntry with the return sourceType", async () => {
    await softDeleteReturnLedgerEntry(prisma, {
      sourceType: "SALE_RETURN",
      sourceId: "sr-1",
      userId: "user-6",
    });

    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.ledgerEntry.updateMany).mock.calls[0][0];
    expect(call.where).toMatchObject({
      sourceType: "SALE_RETURN",
      sourceId: "sr-1",
      deletedAt: null,
    });
  });
});

// ---- writePieceEntryLedger (Phase 21b — karigar INCREASE) -------------

describe("writePieceEntryLedger", () => {
  it("creates an employee-owned INCREASE with PIECE_ENTRY sourceType and richly-described row", async () => {
    await writePieceEntryLedger(prisma, {
      employeeId: "emp-1",
      date: new Date("2026-05-23T00:00:00Z"),
      sourceId: "pe-1",
      count: 50,
      ratePerPiece: 1500n,
      totalAmount: 75000n,
      note: "polishing",
      userId: "user-1",
    });

    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data).toMatchObject({
      employeeId: "emp-1",
      partyId: null,
      direction: "INCREASE",
      amount: 75000n,
      description: "50 pcs @ ₹15/pc — polishing",
      entryType: "TRANSACTION_LINKED",
      sourceType: "PIECE_ENTRY",
      sourceId: "pe-1",
      createdById: "user-1",
      updatedById: "user-1",
    });
  });

  it("singular: count=1 uses 'pc' not 'pcs'", async () => {
    await writePieceEntryLedger(prisma, {
      employeeId: "emp-1",
      date: new Date(),
      sourceId: "pe-2",
      count: 1,
      ratePerPiece: 250000n,
      totalAmount: 250000n,
      note: null,
      userId: null,
    });
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data.description).toBe("1 pc @ ₹2,500/pc");
  });
});

// ---- writeWagePaymentLedger (Phase 21b — karigar DECREASE) ------------

describe("writeWagePaymentLedger", () => {
  it("creates an employee-owned DECREASE with WAGE_PAYMENT sourceType", async () => {
    await writeWagePaymentLedger(prisma, {
      employeeId: "emp-1",
      date: new Date("2026-05-23T00:00:00Z"),
      sourceId: "ep-1",
      amount: 500_000n,
      note: "weekly settlement",
      userId: "user-1",
    });

    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data).toMatchObject({
      employeeId: "emp-1",
      partyId: null,
      direction: "DECREASE",
      amount: 500_000n,
      description: "Wage payment — weekly settlement",
      entryType: "TRANSACTION_LINKED",
      sourceType: "WAGE_PAYMENT",
      sourceId: "ep-1",
      createdById: "user-1",
      updatedById: "user-1",
    });
  });

  it("advance: a wage payment with note 'advance' produces 'Wage payment — advance'", async () => {
    await writeWagePaymentLedger(prisma, {
      employeeId: "emp-1",
      date: new Date(),
      sourceId: "ep-2",
      amount: 100_000n,
      note: "advance",
      userId: null,
    });
    const call = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0];
    expect(call.data.description).toBe("Wage payment — advance");
    expect(call.data.direction).toBe("DECREASE");
  });
});
