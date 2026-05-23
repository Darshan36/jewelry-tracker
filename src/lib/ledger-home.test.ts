// Phase 21c.1 — listLedgerHome tests.
//
// Coverage:
//   - Role × box matrix (which boxes each role sees).
//   - Box math: ADMIN sees raw signed (incl. MANUAL_PAYMENT), scoped
//     roles see activity-only.
//   - Owner list role-scoping (parties for non-LABOUR roles, karigar
//     for ADMIN + LABOUR_MGMT).
//   - Karigar zero-balance rows are INCLUDED in the owner list (the
//     21b.1 always-available-surface pattern carries over).
//   - listLedgerHomeWalkIns role scoping.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");
vi.mock("@/lib/outstanding-balances", async () => {
  return {
    // We only need the walk-in fns from this module — re-export stubs.
    listWalkInPayables: vi.fn().mockResolvedValue([]),
    listWalkInReceivables: vi.fn().mockResolvedValue([]),
  };
});

import { prisma } from "@/lib/prisma";
import {
  listWalkInPayables,
  listWalkInReceivables,
} from "@/lib/outstanding-balances";

import {
  ledgerHrefForBox,
  listLedgerHome,
  listLedgerHomeWalkIns,
  parseLedgerTabSlug,
  type LedgerBoxKey,
} from "./ledger-home";

beforeEach(() => {
  vi.clearAllMocks();
});

// --- helpers --------------------------------------------------------

function makeParty(overrides: Partial<{ id: string; name: string; phone: string | null }> = {}) {
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
  direction: "INCREASE" | "DECREASE";
  amount: bigint;
  entryType: "TRANSACTION_LINKED" | "MANUAL_PAYMENT";
  sourceType:
    | "PURCHASE"
    | "PURCHASE_RETURN"
    | "CASTING"
    | "PLATING"
    | "SALE"
    | "SALE_RETURN"
    | "PIECE_ENTRY"
    | "WAGE_PAYMENT"
    | null;
  deletedAt: Date | null;
}> = {}) {
  return {
    direction: "INCREASE" as const,
    amount: 50000n,
    entryType: "TRANSACTION_LINKED" as const,
    sourceType: "PURCHASE" as const,
    deletedAt: null,
    ...overrides,
  };
}

function makeKarigar(overrides: Partial<{ id: string; name: string; phone: string | null }> = {}) {
  return {
    id: "emp-1",
    name: "Karigar A",
    phone: null,
    type: "LABOUR" as const,
    monthlySalary: null,
    address: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

// --- canViewLedger box matrix (encoded in returned `boxes`) -----------

describe("listLedgerHome — role × box matrix", () => {
  beforeEach(() => {
    // No parties, no karigars → boxes still reflect what each role can
    // see (with zero totals).
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([]);
  });

  it("ADMIN sees all 4 boxes", async () => {
    const r = await listLedgerHome("ADMIN");
    const keys = r.boxes.map((b) => b.key);
    expect(keys).toEqual<LedgerBoxKey[]>([
      "receivables",
      "purchase_payables",
      "casting_plating_payables",
      "karigar",
    ]);
  });

  it("PURCHASE_DEPT sees only purchase_payables", async () => {
    const r = await listLedgerHome("PURCHASE_DEPT");
    expect(r.boxes.map((b) => b.key)).toEqual(["purchase_payables"]);
  });

  it("CASTING_PLATING_MGMT sees only casting_plating_payables", async () => {
    const r = await listLedgerHome("CASTING_PLATING_MGMT");
    expect(r.boxes.map((b) => b.key)).toEqual(["casting_plating_payables"]);
  });

  it("LABOUR_MGMT sees only karigar", async () => {
    const r = await listLedgerHome("LABOUR_MGMT");
    expect(r.boxes.map((b) => b.key)).toEqual(["karigar"]);
  });
});

// --- Box math --------------------------------------------------------

describe("listLedgerHome — ADMIN box math", () => {
  it("computes receivables, purchase, casting_plating, karigar totals", async () => {
    // ledger-entries probe returns one party-of-interest.
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "party-1" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "party-1", name: "P1" }),
        isCustomer: true,
        isSupplier: true,
        isCastingVendor: true,
        isPlatingVendor: true,
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 10000n, sourceType: "SALE" }),
          makeLedgerEntry({ direction: "INCREASE", amount: 20000n, sourceType: "PURCHASE" }),
          makeLedgerEntry({ direction: "INCREASE", amount: 30000n, sourceType: "CASTING" }),
          makeLedgerEntry({ direction: "INCREASE", amount: 40000n, sourceType: "PLATING" }),
          makeLedgerEntry({
            direction: "DECREASE",
            amount: 5000n,
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
          }),
        ],
      } as any,
    ]);
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeKarigar(),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 7000n, sourceType: "PIECE_ENTRY" }),
          makeLedgerEntry({ direction: "DECREASE", amount: 2000n, sourceType: "WAGE_PAYMENT" }),
        ],
      } as any,
    ]);

    const r = await listLedgerHome("ADMIN");
    const byKey = Object.fromEntries(r.boxes.map((b) => [b.key, b]));

    // Receivables = SALE INCREASE + MANUAL_PAYMENT DECREASE = 10000 − 5000 = 5000
    expect(byKey.receivables.total).toBe(5000);
    // Purchase payables (scoped, excludes MANUAL_PAYMENT) = PURCHASE INCREASE = 20000
    expect(byKey.purchase_payables.total).toBe(20000);
    // Casting/Plating payables (scoped) = CASTING + PLATING INCREASE = 70000
    expect(byKey.casting_plating_payables.total).toBe(70000);
    // Karigar = piece work − wages out = 7000 − 2000 = 5000
    expect(byKey.karigar.total).toBe(5000);
  });

  it("MANUAL_PAYMENT included in ADMIN scoped MANUAL_PAYMENT count for receivables", async () => {
    // Receivables uses raw-signed computeOwnerBalance over SALE/SALE_RETURN
    // entries + MANUAL_PAYMENT — same shape as listReceivables. Pin that
    // a customer who overpaid (₹100 sale + ₹500 payment) shows −400 credit.
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "cust-1" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "cust-1", name: "Customer" }),
        isCustomer: true,
        isSupplier: false,
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 10000n, sourceType: "SALE" }),
          makeLedgerEntry({
            direction: "DECREASE",
            amount: 50000n,
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
          }),
        ],
      } as any,
    ]);
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([]);

    const r = await listLedgerHome("ADMIN");
    const recv = r.boxes.find((b) => b.key === "receivables");
    expect(recv?.total).toBe(-40000); // credit balance, raw signed
  });
});

// --- Owners list ----------------------------------------------------

describe("listLedgerHome — owner list", () => {
  it("ADMIN: parties + karigar both visible; karigar with zero balance INCLUDED", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "party-1" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "party-1", name: "Sup A" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
        ],
      } as any,
    ]);
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      // Zero-balance karigar — should appear so the user can record an entry.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeKarigar({ id: "emp-zero", name: "ZeroBalance" }),
        ledgerEntries: [],
      } as any,
      // Karigar with positive balance.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeKarigar({ id: "emp-owed", name: "Owed" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 30000n, sourceType: "PIECE_ENTRY" }),
        ],
      } as any,
    ]);

    const r = await listLedgerHome("ADMIN");
    expect(r.owners).toHaveLength(3);
    // Non-zero rows first.
    const nonZero = r.owners.filter((o) => o.balance !== 0);
    const zero = r.owners.filter((o) => o.balance === 0);
    expect(nonZero.map((o) => o.name)).toEqual(["Sup A", "Owed"]);
    expect(zero.map((o) => o.name)).toEqual(["ZeroBalance"]);
    // hrefs point at /ledger/{party|karigar}/[id]
    expect(r.owners.find((o) => o.id === "party-1")?.href).toBe("/ledger/party/party-1");
    expect(r.owners.find((o) => o.id === "emp-owed")?.href).toBe("/ledger/karigar/emp-owed");
  });

  it("PURCHASE_DEPT: only parties from purchase scope; NO karigar; NO zero parties", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "party-1" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "party-1", name: "Supplier" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
        ],
      } as any,
    ]);
    // employee findMany should NOT be called for PURCHASE_DEPT.

    const r = await listLedgerHome("PURCHASE_DEPT");
    expect(r.owners).toHaveLength(1);
    expect(r.owners[0].name).toBe("Supplier");
    expect(r.owners[0].kind).toBe("party");
    expect(vi.mocked(prisma.employee.findMany)).not.toHaveBeenCalled();
  });

  it("LABOUR_MGMT: NO parties; karigars visible (all)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeKarigar({ id: "k1", name: "K1" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 10000n, sourceType: "PIECE_ENTRY" }),
        ],
      } as any,
    ]);

    const r = await listLedgerHome("LABOUR_MGMT");
    expect(r.owners).toHaveLength(1);
    expect(r.owners[0].kind).toBe("karigar");
    // party findMany NOT called for LABOUR_MGMT.
    expect(vi.mocked(prisma.party.findMany)).not.toHaveBeenCalled();
  });

  it("scoped party balance excludes MANUAL_PAYMENT (matches box math)", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "p-1" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "p-1", name: "Sup" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
          // Manual payment exists but PURCHASE_DEPT shouldn't reduce by it.
          makeLedgerEntry({
            direction: "DECREASE",
            amount: 30000n,
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
          }),
        ],
      } as any,
    ]);

    const r = await listLedgerHome("PURCHASE_DEPT");
    expect(r.owners[0].balance).toBe(50000); // scoped, no manual-payment subtract
  });
});

// --- URL slug ↔ box key (Phase 21c.1.1) ----------------------------------

describe("parseLedgerTabSlug — URL deep-link from dashboard", () => {
  it("missing param → 'all'", () => {
    expect(parseLedgerTabSlug(undefined)).toBe("all");
    expect(parseLedgerTabSlug("")).toBe("all");
  });
  it("invalid slug → 'all' (defensive)", () => {
    expect(parseLedgerTabSlug("nonsense")).toBe("all");
    expect(parseLedgerTabSlug("RECEIVABLES")).toBe("all"); // case-sensitive
  });
  it("each valid slug maps to its box key", () => {
    expect(parseLedgerTabSlug("sales")).toBe("receivables");
    expect(parseLedgerTabSlug("purchase")).toBe("purchase_payables");
    expect(parseLedgerTabSlug("casting-plating")).toBe("casting_plating_payables");
    expect(parseLedgerTabSlug("karigar")).toBe("karigar");
  });
  it("array form (Next.js searchParams can be string|string[]) uses first value", () => {
    expect(parseLedgerTabSlug(["sales", "ignored"])).toBe("receivables");
    expect(parseLedgerTabSlug([])).toBe("all");
  });
});

describe("ledgerHrefForBox — dashboard → /ledger encoder", () => {
  it("encodes each box key as /ledger?tab=<slug>", () => {
    expect(ledgerHrefForBox("receivables")).toBe("/ledger?tab=sales");
    expect(ledgerHrefForBox("purchase_payables")).toBe("/ledger?tab=purchase");
    expect(ledgerHrefForBox("casting_plating_payables")).toBe("/ledger?tab=casting-plating");
    expect(ledgerHrefForBox("karigar")).toBe("/ledger?tab=karigar");
  });
  it("round-trip: parseLedgerTabSlug(slug(k)) === k for every box key", () => {
    const keys: LedgerBoxKey[] = [
      "receivables",
      "purchase_payables",
      "casting_plating_payables",
      "karigar",
    ];
    for (const k of keys) {
      const slug = ledgerHrefForBox(k).replace("/ledger?tab=", "");
      expect(parseLedgerTabSlug(slug)).toBe(k);
    }
  });
});

// --- Per-owner slices (Phase 21c.1.1) ----------------------------------

describe("listLedgerHome — per-owner slices (tab filter source data)", () => {
  it("pure customer party gets ONLY receivables slice (party slice non-zero rule)", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "cust-1" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "cust-1", name: "Customer" }),
        isCustomer: true,
        isSupplier: false,
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 30000n, sourceType: "SALE" }),
          makeLedgerEntry({ direction: "DECREASE", amount: 10000n, entryType: "MANUAL_PAYMENT", sourceType: null }),
        ],
      } as any,
    ]);
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([]);

    const r = await listLedgerHome("ADMIN");
    const owner = r.owners.find((o) => o.id === "cust-1")!;
    expect(owner.slices.receivables).toBe(20000); // 30k sale - 10k payment
    expect(owner.slices.purchase_payables).toBeUndefined();
    expect(owner.slices.casting_plating_payables).toBeUndefined();
  });

  it("dual-role party (customer + supplier) gets BOTH slices with per-category values", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "dual-1" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "dual-1", name: "Dual" }),
        isCustomer: true,
        isSupplier: true,
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 10000n, sourceType: "SALE" }),
          makeLedgerEntry({ direction: "INCREASE", amount: 8000n, sourceType: "PURCHASE" }),
        ],
      } as any,
    ]);
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([]);

    const r = await listLedgerHome("ADMIN");
    const owner = r.owners.find((o) => o.id === "dual-1")!;
    expect(owner.slices.receivables).toBe(10000);
    expect(owner.slices.purchase_payables).toBe(8000);
    expect(owner.slices.casting_plating_payables).toBeUndefined();
    // Full balance is the unified-tab "All" value, not the sum of slices.
    expect(owner.balance).toBe(18000);
  });

  it("karigar slice ALWAYS set, even at zero balance (always-available-surface)", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([]);
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeKarigar({ id: "k-owed" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 5000n, sourceType: "PIECE_ENTRY" }),
        ],
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...makeKarigar({ id: "k-zero", name: "Zero" }), ledgerEntries: [] } as any,
    ]);

    const r = await listLedgerHome("ADMIN");
    const owed = r.owners.find((o) => o.id === "k-owed")!;
    const zero = r.owners.find((o) => o.id === "k-zero")!;
    expect(owed.slices.karigar).toBe(5000);
    expect(zero.slices.karigar).toBe(0); // present + defined, value 0
    // Karigar owners do NOT get party-category slices.
    expect(owed.slices.receivables).toBeUndefined();
    expect(zero.slices.purchase_payables).toBeUndefined();
  });

  it("HIGHEST PRIORITY — tab/box reconciliation invariant: Σ slices[k] === boxes[k].total", async () => {
    // Fixture: pure customer (+20,000 receivables), pure supplier (+50,000
    // purchase), dual-role (+10,000 receivable + +8,000 purchase),
    // casting vendor (+70,000), karigar (+4,000), zero karigar (0).
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "cust-b" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "sup-a" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "dual-e" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "cp-d" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "cust-b" }),
        isCustomer: true,
        isSupplier: false,
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 30000n, sourceType: "SALE" }),
          makeLedgerEntry({ direction: "DECREASE", amount: 10000n, entryType: "MANUAL_PAYMENT", sourceType: null }),
        ],
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "sup-a" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
        ],
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "dual-e" }),
        isCustomer: true,
        isSupplier: true,
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 10000n, sourceType: "SALE" }),
          makeLedgerEntry({ direction: "INCREASE", amount: 8000n, sourceType: "PURCHASE" }),
        ],
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "cp-d" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 70000n, sourceType: "CASTING" }),
        ],
      } as any,
    ]);
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeKarigar({ id: "k1" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 4000n, sourceType: "PIECE_ENTRY" }),
        ],
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...makeKarigar({ id: "k-zero" }), ledgerEntries: [] } as any,
    ]);

    const r = await listLedgerHome("ADMIN");
    const byKey = Object.fromEntries(r.boxes.map((b) => [b.key, b]));

    // For each box, sum the slice value across owners that have it.
    for (const key of ["receivables", "purchase_payables", "casting_plating_payables", "karigar"] as const) {
      const sliceSum = r.owners.reduce((s, o) => s + (o.slices[key] ?? 0), 0);
      expect(sliceSum).toBe(byKey[key].total);
    }
  });

  it("scoped role (PURCHASE_DEPT) gets ONLY purchase_payables slice on visible owners", async () => {
    vi.mocked(prisma.ledgerEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { partyId: "sup" } as any,
    ]);
    vi.mocked(prisma.party.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeParty({ id: "sup" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 50000n, sourceType: "PURCHASE" }),
        ],
      } as any,
    ]);

    const r = await listLedgerHome("PURCHASE_DEPT");
    expect(r.owners).toHaveLength(1);
    expect(r.owners[0].slices.purchase_payables).toBe(50000);
    expect(r.owners[0].slices.receivables).toBeUndefined();
    expect(r.owners[0].slices.casting_plating_payables).toBeUndefined();
    expect(r.owners[0].slices.karigar).toBeUndefined();
  });

  it("LABOUR_MGMT karigar gets ONLY karigar slice", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        ...makeKarigar({ id: "k1" }),
        ledgerEntries: [
          makeLedgerEntry({ direction: "INCREASE", amount: 5000n, sourceType: "PIECE_ENTRY" }),
        ],
      } as any,
    ]);

    const r = await listLedgerHome("LABOUR_MGMT");
    expect(r.owners[0].slices.karigar).toBe(5000);
    expect(r.owners[0].slices.receivables).toBeUndefined();
    expect(r.owners[0].slices.purchase_payables).toBeUndefined();
  });
});

// --- Walk-ins -------------------------------------------------------

describe("listLedgerHomeWalkIns — role scoping", () => {
  it("ADMIN gets ALL payables + receivables", async () => {
    await listLedgerHomeWalkIns("ADMIN");
    expect(vi.mocked(listWalkInPayables)).toHaveBeenCalledWith("all");
    expect(vi.mocked(listWalkInReceivables)).toHaveBeenCalled();
  });

  it("PURCHASE_DEPT gets purchase payables only; NO receivables", async () => {
    await listLedgerHomeWalkIns("PURCHASE_DEPT");
    expect(vi.mocked(listWalkInPayables)).toHaveBeenCalledWith("purchase");
    expect(vi.mocked(listWalkInReceivables)).not.toHaveBeenCalled();
  });

  it("CASTING_PLATING_MGMT gets casting_plating payables only", async () => {
    await listLedgerHomeWalkIns("CASTING_PLATING_MGMT");
    expect(vi.mocked(listWalkInPayables)).toHaveBeenCalledWith("casting_plating");
    expect(vi.mocked(listWalkInReceivables)).not.toHaveBeenCalled();
  });

  it("LABOUR_MGMT gets nothing", async () => {
    const r = await listLedgerHomeWalkIns("LABOUR_MGMT");
    expect(r).toEqual({ payables: [], receivables: [] });
    expect(vi.mocked(listWalkInPayables)).not.toHaveBeenCalled();
    expect(vi.mocked(listWalkInReceivables)).not.toHaveBeenCalled();
  });
});
