// Phase 21a — outstanding-balances tests (ledger-driven).
//
// Coverage:
//   1. `computeOutstanding` (walk-in math, clamped) — unchanged from
//      Phase 17b.
//   2. `listPayables` / `listReceivables` (ledger-backed) — basic smoke
//      tests pinning ADMIN-scope behaviour with mocked Prisma.
//   3. `listWalkInPayables` / `listWalkInReceivables` (still on the
//      *Payment rails) — unchanged from Phase 17b.
//
// Old per-transaction-shape `listPayables` / `getPayablesForParty`
// tests are deleted — the implementation no longer reads
// `purchases`/`castingEntries`/`platingEntries` inclusion arrays on
// Party.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");

import { prisma } from "@/lib/prisma";

import {
  computeOutstanding,
  listPayables,
  listReceivables,
  listWalkInPayables,
  listWalkInReceivables,
} from "./outstanding-balances";

beforeEach(() => {
  vi.clearAllMocks();
});

// --- computeOutstanding (pure, walk-in math) -----------------------

describe("computeOutstanding", () => {
  it("returns total when no payments and no returns", () => {
    expect(
      computeOutstanding({ total: 50000n, payments: [], returns: [] }),
    ).toBe(50000n);
  });

  it("subtracts net paid (PAYMENT − REFUND)", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [
          { amount: 20000n, type: "PAYMENT", deletedAt: null },
          { amount: 5000n, type: "REFUND", deletedAt: null },
        ],
      }),
    ).toBe(35000n);
  });

  it("subtracts returnTotal from total", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [],
        returns: [{ refundAmount: 10000n, deletedAt: null }],
      }),
    ).toBe(40000n);
  });

  it("clamps to 0n when overpaid (walk-in display semantics)", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [{ amount: 70000n, type: "PAYMENT", deletedAt: null }],
      }),
    ).toBe(0n);
  });

  it("excludes soft-deleted payments + returns", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [
          { amount: 20000n, type: "PAYMENT", deletedAt: new Date() },
          { amount: 10000n, type: "PAYMENT", deletedAt: null },
        ],
        returns: [
          { refundAmount: 5000n, deletedAt: new Date() },
          { refundAmount: 2000n, deletedAt: null },
        ],
      }),
    ).toBe(38000n);
  });
});

// --- listPayables (ledger-backed) ----------------------------------

function makeParty(overrides: Partial<{ id: string; name: string }> = {}) {
  return {
    id: "party-1",
    name: "Test Party",
    phone: "9999999999",
    email: null,
    address: null,
    notes: null,
    isCustomer: false,
    isSupplier: true,
    isCastingVendor: false,
    isPlatingVendor: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdById: null,
    updatedById: null,
    deletedById: null,
    ...overrides,
  };
}

function makeLedgerEntry(overrides: Partial<{
  id: string;
  partyId: string;
  direction: "INCREASE" | "DECREASE";
  amount: bigint;
  entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT";
  sourceType: "PURCHASE" | "PURCHASE_RETURN" | "CASTING" | "PLATING" | "SALE" | "SALE_RETURN" | null;
  sourceId: string | null;
  deletedAt: Date | null;
}> = {}) {
  return {
    id: "le-1",
    partyId: "party-1",
    direction: "INCREASE" as const,
    amount: 50000n,
    entryType: "TRANSACTION_LINKED" as const,
    sourceType: "PURCHASE" as const,
    sourceId: "pu-1",
    deletedAt: null,
    date: new Date("2026-05-22"),
    description: "Purchase",
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: null,
    updatedById: null,
    deletedById: null,
    ...overrides,
  };
}

describe("listPayables (ledger-backed)", () => {
  it("returns empty when no party has payables-side INCREASE entries", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([]);
    const r = await listPayables("all");
    expect(r).toEqual([]);
  });

  it("ADMIN scope returns raw signed balance per party (negative = credit)", async () => {
    // Party-of-interest query → one party.
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      { partyId: "party-1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    // Ledger entries: ₹500 purchase + ₹800 manual payment = −₹300 credit.
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      {
        ...makeParty(),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
          makeLedgerEntry({
            id: "le-2",
            direction: "DECREASE",
            amount: 80000n,
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
            sourceId: null,
          }),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const r = await listPayables("all");
    expect(r).toHaveLength(1);
    expect(r[0].totalOutstanding).toBe(-30000); // raw signed: credit balance
    expect(r[0].showScopeFootnote).toBe(false); // ADMIN never sees footnote
    expect(r[0].purchaseOutstanding).toBe(50000); // activity slice
  });

  it("PURCHASE scope excludes MANUAL_PAYMENT (activity-only view)", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      { partyId: "party-1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      {
        ...makeParty(),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
          // MANUAL_PAYMENT exists but scoped view excludes it.
          makeLedgerEntry({
            id: "le-2",
            direction: "DECREASE",
            amount: 30000n,
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
            sourceId: null,
          }),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const r = await listPayables("purchase");
    expect(r).toHaveLength(1);
    // Scoped view: only the INCREASE counts (no MANUAL_PAYMENT subtraction).
    expect(r[0].totalOutstanding).toBe(50000);
    expect(r[0].showScopeFootnote).toBe(true); // footnote because MANUAL_PAYMENT exists
  });

  it("filters out parties with settled (== 0) balance", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      { partyId: "party-1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      {
        ...makeParty(),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
          makeLedgerEntry({
            id: "le-2",
            direction: "DECREASE",
            amount: 50000n,
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
            sourceId: null,
          }),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const r = await listPayables("all");
    expect(r).toEqual([]);
  });
});

describe("listReceivables (ledger-backed)", () => {
  it("returns empty when no party has SALE INCREASE entries", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([]);
    const r = await listReceivables();
    expect(r).toEqual([]);
  });

  it("aggregates SALE + SALE_RETURN + MANUAL_PAYMENT for ADMIN net balance", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      { partyId: "cust-1" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      {
        ...makeParty({ id: "cust-1", name: "Customer A" }),
        isCustomer: true,
        isSupplier: false,
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 100000n, sourceType: "SALE", sourceId: "s-1" }),
          makeLedgerEntry({
            id: "le-2",
            direction: "DECREASE",
            amount: 30000n,
            entryType: "TRANSACTION_LINKED",
            sourceType: "SALE_RETURN",
            sourceId: "sr-1",
          }),
          makeLedgerEntry({
            id: "le-3",
            direction: "DECREASE",
            amount: 20000n,
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
            sourceId: null,
          }),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const r = await listReceivables();
    expect(r).toHaveLength(1);
    // 100000 (sale) − 30000 (return) − 20000 (manual payment) = 50000 owed
    expect(r[0].totalOutstanding).toBe(50000);
  });
});

// --- listWalkInPayables (unchanged from Phase 17b) ---------------------

describe("listWalkInPayables", () => {
  beforeEach(() => {
    vi.mocked(prisma.purchase.findMany).mockResolvedValue([]);
    vi.mocked(prisma.castingEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.platingEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);
  });

  it("returns purchase walk-ins for 'purchase' scope; skips fully-paid", async () => {
    vi.mocked(prisma.purchase.findMany).mockResolvedValueOnce([
      {
        id: "pu-walk-1",
        partyId: null,
        partyName: "as",
        partyPhone: null,
        date: new Date("2026-05-22"),
        total: 1000000n,
        payments: [],
        returns: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      {
        id: "pu-paid",
        partyId: null,
        partyName: "settled",
        partyPhone: null,
        date: new Date("2026-05-22"),
        total: 1000n,
        payments: [{ amount: 1000n, type: "PAYMENT", deletedAt: null }],
        returns: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const rows = await listWalkInPayables("purchase");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "PURCHASE",
      id: "pu-walk-1",
      outstanding: 1000000,
    });
    expect(vi.mocked(prisma.castingEntry.findMany)).not.toHaveBeenCalled();
    expect(vi.mocked(prisma.platingEntry.findMany)).not.toHaveBeenCalled();
  });

  it("returns casting + plating walk-ins for 'casting_plating' scope", async () => {
    vi.mocked(prisma.castingEntry.findMany).mockResolvedValueOnce([
      {
        id: "ce-walk-1",
        partyId: null,
        partyName: "sss",
        partyPhone: null,
        date: new Date(),
        total: 50000n,
        payments: [],
        attachment: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);
    vi.mocked(prisma.platingEntry.findMany).mockResolvedValueOnce([
      {
        id: "pe-walk-1",
        partyId: null,
        partyName: "ttt",
        partyPhone: null,
        date: new Date(),
        total: 30000n,
        payments: [],
        attachment: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const rows = await listWalkInPayables("casting_plating");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind).sort()).toEqual(["CASTING", "PLATING"]);
    expect(vi.mocked(prisma.purchase.findMany)).not.toHaveBeenCalled();
  });
});

// --- listWalkInReceivables (unchanged from Phase 17b) ------------------

describe("listWalkInReceivables", () => {
  beforeEach(() => {
    vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);
  });

  it("returns walk-in sales with outstanding > 0", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([
      {
        id: "s-walk-1",
        partyId: null,
        partyName: "customer x",
        partyPhone: null,
        date: new Date(),
        total: 50000n,
        payments: [],
        returns: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const rows = await listWalkInReceivables();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "SALE",
      id: "s-walk-1",
      outstanding: 50000,
    });
  });

  it("skips fully-paid walk-in sales", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([
      {
        id: "s-paid",
        partyId: null,
        partyName: "paid",
        partyPhone: null,
        date: new Date(),
        total: 10000n,
        payments: [{ amount: 10000n, type: "PAYMENT", deletedAt: null }],
        returns: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ]);

    const rows = await listWalkInReceivables();
    expect(rows).toEqual([]);
  });
});
