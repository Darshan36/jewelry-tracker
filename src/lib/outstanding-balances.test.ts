// Outstanding balance helper tests. The pure-function `computeOutstanding`
// covers the math; the aggregator tests (listPayables / listReceivables)
// use the shared Prisma mock.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");

import { prisma } from "@/lib/prisma";

import {
  computeOutstanding,
  listPayables,
  listReceivables,
  getPayablesForParty,
  getReceivablesForParty,
} from "./outstanding-balances";

beforeEach(() => {
  vi.clearAllMocks();
});

// --- computeOutstanding (pure) ---------------------------------------

describe("computeOutstanding", () => {
  it("returns total when no payments and no returns", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [],
        returns: [],
      }),
    ).toBe(50000n);
  });

  it("subtracts payments (PAYMENT type only counts positively)", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [
          {
            amount: 20000n,
            type: "PAYMENT",
            deletedAt: null,
          },
        ],
      }),
    ).toBe(30000n);
  });

  it("subtracts payments + adds back refunds (REFUND nets against PAYMENT)", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [
          { amount: 20000n, type: "PAYMENT", deletedAt: null },
          { amount: 5000n, type: "REFUND", deletedAt: null },
        ],
      }),
    ).toBe(35000n); // 50000 - (20000 - 5000) = 35000
  });

  it("subtracts returnTotal from total", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [],
        returns: [
          { refundAmount: 10000n, deletedAt: null },
        ],
      }),
    ).toBe(40000n);
  });

  it("clamps to 0n when fully paid", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [{ amount: 50000n, type: "PAYMENT", deletedAt: null }],
      }),
    ).toBe(0n);
  });

  it("clamps to 0n when overpaid (refund_due case)", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [{ amount: 70000n, type: "PAYMENT", deletedAt: null }],
      }),
    ).toBe(0n);
  });

  it("excludes soft-deleted payments", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [
          { amount: 20000n, type: "PAYMENT", deletedAt: new Date() }, // deleted
          { amount: 10000n, type: "PAYMENT", deletedAt: null },
        ],
      }),
    ).toBe(40000n); // only the non-deleted 10000 counts
  });

  it("excludes soft-deleted returns", () => {
    expect(
      computeOutstanding({
        total: 50000n,
        payments: [],
        returns: [
          { refundAmount: 20000n, deletedAt: new Date() }, // deleted
          { refundAmount: 5000n, deletedAt: null },
        ],
      }),
    ).toBe(45000n);
  });

  it("treats missing returns field as empty (casting/plating shape)", () => {
    expect(
      computeOutstanding({
        total: 25000n,
        payments: [{ amount: 5000n, type: "PAYMENT", deletedAt: null }],
        // returns omitted — Casting/Plating entries don't have returns
      }),
    ).toBe(20000n);
  });
});

// --- listPayables (aggregator) ---------------------------------------

function makeParty(overrides: Partial<{ id: string; name: string; phone: string | null }> = {}) {
  return {
    id: "party-1",
    name: "Test Party",
    phone: "9999999999",
    email: null,
    address: null,
    notes: null,
    isCustomer: false,
    isSupplier: false,
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

describe("listPayables", () => {
  it("returns empty array when no parties have outstanding payables", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);
    const r = await listPayables("all");
    expect(r).toEqual([]);
  });

  it("aggregates purchase outstanding for purchase scope", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([
      {
        ...makeParty({ id: "p1", name: "Supplier A" }),
        purchases: [
          {
            id: "pu1",
            total: 50000n,
            payments: [
              {
                amount: 20000n,
                type: "PAYMENT",
                deletedAt: null,
              },
            ],
            returns: [],
            deletedAt: null,
          },
        ],
        castingEntries: [],
        platingEntries: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await listPayables("purchase");
    expect(r).toHaveLength(1);
    expect(r[0].party.name).toBe("Supplier A");
    expect(r[0].purchaseOutstanding).toBe(30000);
    expect(r[0].totalOutstanding).toBe(30000);
    expect(r[0].hasMissingAttachment).toBe(true);
  });

  it("excludes fully-paid parties from result", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([
      {
        ...makeParty({ id: "p2", name: "Paid Supplier" }),
        purchases: [
          {
            id: "pu2",
            total: 10000n,
            payments: [
              { amount: 10000n, type: "PAYMENT", deletedAt: null },
            ],
            returns: [],
            deletedAt: null,
          },
        ],
        castingEntries: [],
        platingEntries: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await listPayables("purchase");
    expect(r).toEqual([]);
  });

  it("aggregates casting AND plating outstanding for casting_plating scope", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([
      {
        ...makeParty({ id: "v1", name: "Vendor X" }),
        purchases: [],
        castingEntries: [
          {
            id: "ce1",
            total: 25000n,
            payments: [],
            attachment: null,
            deletedAt: null,
          },
        ],
        platingEntries: [
          {
            id: "pe1",
            total: 15000n,
            payments: [],
            attachment: null,
            deletedAt: null,
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await listPayables("casting_plating");
    expect(r).toHaveLength(1);
    expect(r[0].castingOutstanding).toBe(25000);
    expect(r[0].platingOutstanding).toBe(15000);
    expect(r[0].totalOutstanding).toBe(40000);
    expect(r[0].hasMissingAttachment).toBe(true);
  });

  it("sorts results by totalOutstanding desc", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([
      {
        ...makeParty({ id: "smaller", name: "Small Debt" }),
        purchases: [
          {
            id: "small-p",
            total: 10000n,
            payments: [],
            returns: [],
            deletedAt: null,
          },
        ],
        castingEntries: [],
        platingEntries: [],
      },
      {
        ...makeParty({ id: "bigger", name: "Big Debt" }),
        purchases: [
          {
            id: "big-p",
            total: 100000n,
            payments: [],
            returns: [],
            deletedAt: null,
          },
        ],
        castingEntries: [],
        platingEntries: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await listPayables("purchase");
    expect(r).toHaveLength(2);
    expect(r[0].party.name).toBe("Big Debt");
    expect(r[1].party.name).toBe("Small Debt");
  });

  it("marks hasMissingAttachment=false when all transactions have READY attachments", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([
      {
        ...makeParty({ id: "p1", name: "Supplier A" }),
        purchases: [
          {
            id: "pu1",
            total: 50000n,
            payments: [],
            returns: [],
            deletedAt: null,
          },
        ],
        castingEntries: [],
        platingEntries: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { attachedToId: "pu1" } as any,
    ]);

    const r = await listPayables("purchase");
    expect(r[0].hasMissingAttachment).toBe(false);
  });
});

// --- listReceivables -------------------------------------------------

describe("listReceivables", () => {
  it("returns empty when no parties have outstanding sales", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);
    const r = await listReceivables();
    expect(r).toEqual([]);
  });

  it("aggregates sale outstanding across customers", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([
      {
        ...makeParty({ id: "c1", name: "Customer Hitesh" }),
        sales: [
          {
            id: "s1",
            total: 50000n,
            payments: [
              {
                amount: 20000n,
                type: "PAYMENT",
                deletedAt: null,
              },
            ],
            returns: [],
            deletedAt: null,
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await listReceivables();
    expect(r).toHaveLength(1);
    expect(r[0].party.name).toBe("Customer Hitesh");
    expect(r[0].totalOutstanding).toBe(30000);
  });

  it("excludes fully-paid sales", async () => {
    vi.mocked(prisma.party.findMany).mockResolvedValue([
      {
        ...makeParty({ id: "c1", name: "Paid Customer" }),
        sales: [
          {
            id: "s1",
            total: 50000n,
            payments: [
              { amount: 50000n, type: "PAYMENT", deletedAt: null },
            ],
            returns: [],
            deletedAt: null,
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await listReceivables();
    expect(r).toEqual([]);
  });
});

// --- getPayablesForParty / getReceivablesForParty --------------------

describe("getPayablesForParty", () => {
  it("returns null for missing party", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(null);
    const r = await getPayablesForParty("nonexistent", "all");
    expect(r).toBeNull();
  });

  it("returns scoped transactions with per-row outstanding", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue({
      ...makeParty({ id: "p1", name: "Mixed Supplier" }),
      purchases: [
        {
          id: "pu1",
          total: 50000n,
          payments: [{ amount: 20000n, type: "PAYMENT", deletedAt: null }],
          returns: [],
          deletedAt: null,
        },
      ],
      castingEntries: [],
      platingEntries: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await getPayablesForParty("p1", "purchase");
    expect(r).not.toBeNull();
    expect(r!.purchases).toHaveLength(1);
    expect(r!.purchases[0].outstanding).toBe(30000);
    expect(r!.totalOutstanding).toBe(30000);
    expect(r!.purchases[0].hasAttachment).toBe(false);
  });
});

describe("getReceivablesForParty", () => {
  it("returns sales with outstanding per row", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue({
      ...makeParty({ id: "c1", name: "Customer" }),
      sales: [
        {
          id: "s1",
          total: 50000n,
          payments: [{ amount: 20000n, type: "PAYMENT", deletedAt: null }],
          returns: [],
          deletedAt: null,
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const r = await getReceivablesForParty("c1");
    expect(r).not.toBeNull();
    expect(r!.sales).toHaveLength(1);
    expect(r!.sales[0].outstanding).toBe(30000);
    expect(r!.totalOutstanding).toBe(30000);
  });
});
