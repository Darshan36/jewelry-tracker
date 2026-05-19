import { describe, expect, it, vi } from "vitest";
import { Decimal } from "decimal.js";

vi.mock("@/lib/prisma");

import { prisma } from "@/lib/prisma";
import {
  getCompletedCastingEntries,
  getCompletedEmployeePayments,
  getCompletedPlatingEntries,
  getCompletedPurchases,
  getCompletedSales,
  type CompletedFilter,
} from "./completed-queries";

// ---------- Fixtures ----------

function rangeMay2026(): CompletedFilter {
  return {
    range: {
      from: new Date(Date.UTC(2026, 4, 1)),
      to: new Date(Date.UTC(2026, 5, 1)),
    },
  };
}

function makeSale(
  overrides: {
    id?: string;
    total?: bigint;
    paid?: bigint;
    returnTotal?: bigint;
    partyName?: string;
  } = {},
) {
  const id = overrides.id ?? "sale-1";
  const total = overrides.total ?? 10000n;
  const paid = overrides.paid ?? 10000n;
  const returnTotal = overrides.returnTotal ?? 0n;
  return {
    id,
    date: new Date("2026-05-15T00:00:00Z"),
    partyId: null,
    partyName: overrides.partyName ?? "Test party",
    partyPhone: null,
    discount: 0n,
    total,
    notes: null,
    createdAt: new Date("2026-05-15T00:00:00Z"),
    updatedAt: new Date("2026-05-15T00:00:00Z"),
    deletedAt: null,
    lineItems: [
      {
        id: `${id}-line`,
        saleId: id,
        itemDescription: "Item A",
        qty: 1,
        rate: total,
        createdAt: new Date(),
      },
    ],
    payments: [
      {
        id: `${id}-pay`,
        saleId: id,
        date: new Date(),
        amount: paid,
        type: "PAYMENT" as const,
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ],
    returns:
      returnTotal === 0n
        ? []
        : [
            {
              id: `${id}-ret`,
              saleId: id,
              date: new Date(),
              qtyReturned: 1,
              refundAmount: returnTotal,
              note: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            },
          ],
  };
}

function makePurchase(overrides: { id?: string; paid?: bigint } = {}) {
  const id = overrides.id ?? "purchase-1";
  const paid = overrides.paid ?? 10000n;
  return {
    id,
    date: new Date("2026-05-15T00:00:00Z"),
    partyId: null,
    partyName: "Test supplier",
    partyPhone: null,
    discount: 0n,
    total: 10000n,
    notes: null,
    createdAt: new Date("2026-05-15T00:00:00Z"),
    updatedAt: new Date("2026-05-15T00:00:00Z"),
    deletedAt: null,
    lineItems: [
      {
        id: `${id}-line`,
        purchaseId: id,
        itemDescription: "Item B",
        qty: 1,
        rate: 10000n,
        createdAt: new Date(),
      },
    ],
    payments: [
      {
        id: `${id}-pay`,
        purchaseId: id,
        date: new Date(),
        amount: paid,
        type: "PAYMENT" as const,
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ],
    returns: [],
  };
}

function makeCasting(overrides: { id?: string; paid?: bigint } = {}) {
  const id = overrides.id ?? "cast-1";
  const paid = overrides.paid ?? 30000n;
  return {
    id,
    date: new Date("2026-05-15T00:00:00Z"),
    partyId: null,
    partyName: "Test vendor",
    partyPhone: null,
    discount: 0n,
    total: 30000n,
    notes: null,
    attachmentId: null,
    createdAt: new Date("2026-05-15T00:00:00Z"),
    updatedAt: new Date("2026-05-15T00:00:00Z"),
    deletedAt: null,
    party: null,
    attachment: null,
    lineItems: [
      {
        id: `${id}-line`,
        castingEntryId: id,
        materialDescription: "Material X",
        weightKg: new Decimal("1.000"),
        ratePerKg: 30000n,
        lineTotal: 30000n,
        createdAt: new Date(),
      },
    ],
    payments: [
      {
        id: `${id}-pay`,
        castingEntryId: id,
        date: new Date(),
        amount: paid,
        type: "PAYMENT" as const,
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ],
  };
}

function makePlating(overrides: { id?: string; paid?: bigint } = {}) {
  const id = overrides.id ?? "plat-1";
  const paid = overrides.paid ?? 40000n;
  return {
    id,
    date: new Date("2026-05-15T00:00:00Z"),
    partyId: null,
    partyName: "Test vendor",
    partyPhone: null,
    discount: 0n,
    total: 40000n,
    notes: null,
    attachmentId: null,
    createdAt: new Date("2026-05-15T00:00:00Z"),
    updatedAt: new Date("2026-05-15T00:00:00Z"),
    deletedAt: null,
    party: null,
    attachment: null,
    lineItems: [
      {
        id: `${id}-line`,
        platingEntryId: id,
        materialDescription: "Material Y",
        weightKg: new Decimal("1.000"),
        ratePerKg: 40000n,
        lineTotal: 40000n,
        createdAt: new Date(),
      },
    ],
    payments: [
      {
        id: `${id}-pay`,
        platingEntryId: id,
        date: new Date(),
        amount: paid,
        type: "PAYMENT" as const,
        note: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ],
  };
}

function makeEmployeePayment(overrides: { id?: string; name?: string } = {}) {
  const id = overrides.id ?? "ep-1";
  return {
    id,
    employeeId: "emp-1",
    type: "WAGE" as const,
    paidAt: new Date("2026-05-15T10:00:00Z"),
    amount: 50000n,
    periodStart: new Date("2026-05-10T00:00:00Z"),
    periodEnd: new Date("2026-05-15T00:00:00Z"),
    note: null,
    createdAt: new Date("2026-05-15T10:00:00Z"),
    updatedAt: new Date("2026-05-15T10:00:00Z"),
    deletedAt: null,
    createdById: null,
    updatedById: null,
    deletedById: null,
    employee: {
      name: overrides.name ?? "Karigar A",
      type: "LABOUR" as const,
    },
  };
}

// ---------- getCompletedSales ----------

describe("getCompletedSales", () => {
  it("returns only sales with status === 'completed'", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSale({ id: "s-paid", total: 10000n, paid: 10000n }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSale({ id: "s-pending", total: 10000n, paid: 0n }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeSale({ id: "s-partial", total: 10000n, paid: 4000n }) as any,
    ]);
    const out = await getCompletedSales(rangeMay2026());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("s-paid");
    expect(out[0].status).toBe("completed");
  });

  it("excludes refund_due sales (overpaid relative to returns)", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([
      makeSale({
        id: "s-refund",
        total: 10000n,
        paid: 10000n,
        returnTotal: 4000n,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ]);
    const out = await getCompletedSales(rangeMay2026());
    expect(out).toHaveLength(0);
  });

  it("returns empty array when no sales match", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([]);
    const out = await getCompletedSales(rangeMay2026());
    expect(out).toEqual([]);
  });

  it("passes deletedAt: null + date range to Prisma findMany", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([]);
    const filter = rangeMay2026();
    await getCompletedSales(filter);
    const call = vi.mocked(prisma.sale.findMany).mock.calls[0][0];
    expect(call?.where).toMatchObject({
      deletedAt: null,
      date: { gte: filter.range.from, lt: filter.range.to },
    });
  });

  it("applies case-insensitive party search when partyQuery present", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([]);
    await getCompletedSales({ ...rangeMay2026(), partyQuery: "ramesh" });
    const call = vi.mocked(prisma.sale.findMany).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where = call?.where as any;
    expect(where.OR).toEqual([
      { partyName: { contains: "ramesh", mode: "insensitive" } },
      { partyPhone: { contains: "ramesh", mode: "insensitive" } },
    ]);
  });

  it("skips party search when partyQuery is empty/whitespace", async () => {
    vi.mocked(prisma.sale.findMany).mockResolvedValueOnce([]);
    await getCompletedSales({ ...rangeMay2026(), partyQuery: "   " });
    const call = vi.mocked(prisma.sale.findMany).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((call?.where as any).OR).toBeUndefined();
  });
});

// ---------- getCompletedPurchases ----------

describe("getCompletedPurchases", () => {
  it("returns only purchases with status === 'completed'", async () => {
    vi.mocked(prisma.purchase.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makePurchase({ id: "p-paid", paid: 10000n }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makePurchase({ id: "p-pending", paid: 0n }) as any,
    ]);
    const out = await getCompletedPurchases(rangeMay2026());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("p-paid");
  });

  it("applies date range filter", async () => {
    vi.mocked(prisma.purchase.findMany).mockResolvedValueOnce([]);
    const filter = rangeMay2026();
    await getCompletedPurchases(filter);
    const call = vi.mocked(prisma.purchase.findMany).mock.calls[0][0];
    expect(call?.where).toMatchObject({
      deletedAt: null,
      date: { gte: filter.range.from, lt: filter.range.to },
    });
  });
});

// ---------- getCompletedCastingEntries ----------

describe("getCompletedCastingEntries", () => {
  it("returns only casting entries with status === 'completed'", async () => {
    vi.mocked(prisma.castingEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeCasting({ id: "c-paid", paid: 30000n }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeCasting({ id: "c-pending", paid: 0n }) as any,
    ]);
    const out = await getCompletedCastingEntries(rangeMay2026());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c-paid");
    expect(out[0].status).toBe("completed");
  });
});

// ---------- getCompletedPlatingEntries ----------

describe("getCompletedPlatingEntries", () => {
  it("returns only plating entries with status === 'completed'", async () => {
    vi.mocked(prisma.platingEntry.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makePlating({ id: "pl-paid", paid: 40000n }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makePlating({ id: "pl-pending", paid: 0n }) as any,
    ]);
    const out = await getCompletedPlatingEntries(rangeMay2026());
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("pl-paid");
  });
});

// ---------- getCompletedEmployeePayments ----------

describe("getCompletedEmployeePayments", () => {
  it("returns every non-deleted payment in range (all are inherently completed)", async () => {
    vi.mocked(prisma.employeePayment.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEmployeePayment({ id: "p1", name: "Karigar A" }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEmployeePayment({ id: "p2", name: "Karigar B" }) as any,
    ]);
    const out = await getCompletedEmployeePayments(rangeMay2026());
    expect(out).toHaveLength(2);
    expect(out[0].employeeName).toBe("Karigar A");
    expect(out[1].employeeName).toBe("Karigar B");
  });

  it("filters by paidAt (not date) in the date range", async () => {
    vi.mocked(prisma.employeePayment.findMany).mockResolvedValueOnce([]);
    const filter = rangeMay2026();
    await getCompletedEmployeePayments(filter);
    const call = vi.mocked(prisma.employeePayment.findMany).mock.calls[0][0];
    expect(call?.where).toMatchObject({
      deletedAt: null,
      paidAt: { gte: filter.range.from, lt: filter.range.to },
    });
  });

  it("applies employee name search when partyQuery present", async () => {
    vi.mocked(prisma.employeePayment.findMany).mockResolvedValueOnce([]);
    await getCompletedEmployeePayments({ ...rangeMay2026(), partyQuery: "ramesh" });
    const call = vi.mocked(prisma.employeePayment.findMany).mock.calls[0][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where = call?.where as any;
    expect(where.employee).toEqual({
      name: { contains: "ramesh", mode: "insensitive" },
    });
  });

  it("returns BigInt amount as Number and Date fields as ISO strings", async () => {
    vi.mocked(prisma.employeePayment.findMany).mockResolvedValueOnce([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEmployeePayment() as any,
    ]);
    const out = await getCompletedEmployeePayments(rangeMay2026());
    expect(out[0].amount).toBe(50000);
    expect(typeof out[0].amount).toBe("number");
    expect(out[0].paidAt).toBe("2026-05-15T10:00:00.000Z");
    expect(typeof out[0].paidAt).toBe("string");
  });
});
