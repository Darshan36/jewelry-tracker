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
  createSalePayment,
  softDeleteSalePayment,
} from "./payment-actions";

const fakeSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    name: "Test Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

type RawSale = {
  id: string;
  date: Date;
  customerId: string | null;
  partyName: string;
  partyPhone: string | null;
  itemDescription: string;
  qty: number;
  rate: bigint;
  discount: bigint;
  total: bigint;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type RawPayment = {
  id: string;
  saleId: string;
  date: Date;
  amount: bigint;
  type: "PAYMENT" | "REFUND";
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

type RawReturn = {
  id: string;
  saleId: string;
  date: Date;
  qtyReturned: number;
  refundAmount: bigint;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function makeSaleRow(
  overrides: Partial<RawSale> = {},
  payments: RawPayment[] = [],
  returns: RawReturn[] = [],
): RawSale & { payments: RawPayment[]; returns: RawReturn[] } {
  return {
    id: "cuid-sale-test",
    date: new Date("2026-05-14T00:00:00Z"),
    customerId: null,
    partyName: "Test Walkin",
    partyPhone: null,
    itemDescription: "Test item",
    qty: 10,
    rate: 25000n,
    discount: 10000n,
    total: 240000n,
    notes: null,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    updatedAt: new Date("2026-05-14T12:00:00Z"),
    deletedAt: null,
    ...overrides,
    payments,
    returns,
  };
}

function makePaymentRow(overrides: Partial<RawPayment> = {}): RawPayment {
  return {
    id: "cuid-pmt-default",
    saleId: "cuid-sale-test",
    date: new Date("2026-05-14T00:00:00Z"),
    amount: 50000n,
    type: "PAYMENT",
    note: null,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    updatedAt: new Date("2026-05-14T12:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function validInput(overrides: Partial<ReturnType<typeof base>> = {}) {
  function base() {
    return {
      saleId: "cuid-sale-test",
      date: new Date("2026-05-14T00:00:00Z"),
      amount: 500,
      type: "PAYMENT" as "PAYMENT" | "REFUND",
      note: null as string | null,
    };
  }
  return { ...base(), ...overrides };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
});

describe("createSalePayment", () => {
  it("happy path — converts rupees to BigInt paise at Prisma boundary", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
    vi.mocked(prisma.salePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 50000n }),
    );

    await createSalePayment(validInput({ amount: 500 }));

    expect(prisma.salePayment.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.salePayment.create).mock.calls[0][0];
    // 500 rupees → 50000 paise as BigInt
    expect(call.data.amount).toBe(50000n);
    expect(typeof call.data.amount).toBe("bigint");
    expect(revalidatePath).toHaveBeenCalledWith("/sales");
  });

  it("aggregates existing non-deleted payments for remaining-balance check", async () => {
    // total 240000 paise, existing payment 50000 paise → remaining 190000
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [makePaymentRow({ id: "p1", amount: 50000n })]),
    );
    vi.mocked(prisma.salePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 190000n }),
    );

    // Try to pay the remaining 1900 rupees exactly — should succeed
    const result = await createSalePayment(validInput({ amount: 1900 }));

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.salePayment.create).mock.calls[0][0];
    expect(call.data.amount).toBe(190000n);
  });

  it("rejects overpayment with formatted outstanding balance in message", async () => {
    // total 240000, existing 50000 → remaining 190000
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [makePaymentRow({ id: "p1", amount: 50000n })]),
    );

    // Try ₹2000 (200000 paise) > remaining 190000
    const result = await createSalePayment(validInput({ amount: 2000 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
      const msg = result.errors.amount?.[0] ?? "";
      expect(msg).toContain("Exceeds remaining balance");
      // Outstanding should appear formatted: ₹1,900.00
      expect(msg).toMatch(/₹\s*1,900\.00/);
    }
    expect(prisma.salePayment.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects when sale is not found", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null);

    const result = await createSalePayment(
      validInput({ saleId: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.saleId).toContain("Sale not found");
    }
    expect(prisma.salePayment.create).not.toHaveBeenCalled();
  });

  it("treats a soft-deleted sale as not-found (deletedAt:null guard)", async () => {
    // findUnique with the deletedAt:null filter returns null for soft-deleted
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null);

    const result = await createSalePayment(
      validInput({ saleId: "soft-deleted-id" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.saleId).toContain("Sale not found");
    }
    // Verify the where clause included deletedAt:null
    const call = vi.mocked(prisma.sale.findUnique).mock.calls[0][0];
    expect(call.where).toEqual({
      id: "soft-deleted-id",
      deletedAt: null,
    });
  });

  it("excludes already-soft-deleted payments AND returns from the aggregation via include filter", async () => {
    // The action passes `where: { deletedAt: null }` to BOTH the payments
    // and returns includes (Phase 3.3 adds returns), so Prisma returns only
    // active children in either category. Verify the shape of the include.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
    vi.mocked(prisma.salePayment.create).mockResolvedValue(makePaymentRow());

    await createSalePayment(validInput());

    const findCall = vi.mocked(prisma.sale.findUnique).mock.calls[0][0];
    expect(findCall.include).toEqual({
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
    });
  });

  it("rejects schema-invalid input (zero amount) without touching the DB", async () => {
    const result = await createSalePayment(validInput({ amount: 0 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
    }
    expect(prisma.sale.findUnique).not.toHaveBeenCalled();
    expect(prisma.salePayment.create).not.toHaveBeenCalled();
  });

  it("returned payment.amount is Number (paise), not BigInt", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
    vi.mocked(prisma.salePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 50000n }),
    );

    const result = await createSalePayment(validInput({ amount: 500 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.payment.amount).toBe("number");
      expect(result.payment.amount).toBe(50000);
    }
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createSalePayment(validInput())).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.salePayment.create).not.toHaveBeenCalled();
  });

  // Phase 3.3: REFUND-type payment behavior + net paidAmount aggregation.

  it("REFUND happy path — type=REFUND persisted, amount as BigInt paise", async () => {
    // total 240000, paid PAYMENT 240000, then return creates refund_due.
    // User issues a REFUND of 40000 paise (₹400).
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow(
        {},
        [makePaymentRow({ id: "p1", amount: 240000n, type: "PAYMENT" })],
        [{ id: "r1", saleId: "cuid-sale-test", date: new Date(), qtyReturned: 2, refundAmount: 40000n, note: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }],
      ),
    );
    vi.mocked(prisma.salePayment.create).mockResolvedValue(
      makePaymentRow({ id: "r-pmt", amount: 40000n, type: "REFUND" }),
    );

    const result = await createSalePayment(
      validInput({ amount: 400, type: "REFUND" }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.salePayment.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.salePayment.create).mock.calls[0][0];
    expect(call.data.type).toBe("REFUND");
    expect(call.data.amount).toBe(40000n);
  });

  it("REFUND rejects when amount > net paidAmount", async () => {
    // total 240000, paid PAYMENT 50000 (₹500), no returns. Net paid = 50000.
    // Refund 1000 rupees = 100000 paise > 50000 → reject.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [
        makePaymentRow({ id: "p1", amount: 50000n, type: "PAYMENT" }),
      ]),
    );

    const result = await createSalePayment(
      validInput({ amount: 1000, type: "REFUND" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
      const msg = result.errors.amount?.[0] ?? "";
      expect(msg).toContain("Refund exceeds amount paid");
      // Maximum is ₹500.00 (50000 paise net)
      expect(msg).toMatch(/₹\s*500\.00/);
    }
    expect(prisma.salePayment.create).not.toHaveBeenCalled();
  });

  it("PAYMENT check uses effective total (subtracts returnTotal)", async () => {
    // total 240000, return 40000 → effective 200000.
    // No payments yet → remaining = 200000 - 0 = 200000.
    // Payment of 2500 rupees = 250000 paise > 200000 → reject.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow(
        {},
        [],
        [{ id: "r1", saleId: "cuid-sale-test", date: new Date(), qtyReturned: 2, refundAmount: 40000n, note: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }],
      ),
    );

    const result = await createSalePayment(
      validInput({ amount: 2500, type: "PAYMENT" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.amount?.[0] ?? "";
      expect(msg).toContain("Exceeds remaining balance");
      // Outstanding should be ₹2,000.00 (effective 200000 − paid 0)
      expect(msg).toMatch(/₹\s*2,000\.00/);
    }
  });

  it("aggregates PAYMENT minus REFUND for net paidAmount on PAYMENT check", async () => {
    // total 240000. Payments: PAYMENT 100000, REFUND 30000 → net 70000.
    // Remaining for new PAYMENT = 240000 - 70000 = 170000.
    // New PAYMENT of 1500 rupees = 150000 paise < 170000 → accept.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [
        makePaymentRow({ id: "p1", amount: 100000n, type: "PAYMENT" }),
        makePaymentRow({ id: "p2", amount: 30000n, type: "REFUND" }),
      ]),
    );
    vi.mocked(prisma.salePayment.create).mockResolvedValue(
      makePaymentRow({ id: "p-new", amount: 150000n, type: "PAYMENT" }),
    );

    const result = await createSalePayment(
      validInput({ amount: 1500, type: "PAYMENT" }),
    );

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.salePayment.create).mock.calls[0][0];
    expect(call.data.amount).toBe(150000n);
  });

  it("excludes soft-deleted refunds AND payments from net paidAmount", async () => {
    // Active PAYMENT 100000 + deleted REFUND 30000 (ignored) → net 100000.
    // Remaining = 240000 - 100000 = 140000.
    // New PAYMENT of 1300 = 130000 < 140000 → accept.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [
        makePaymentRow({ id: "p1", amount: 100000n, type: "PAYMENT" }),
        // This REFUND is soft-deleted, but the Prisma include's `where:
        // { deletedAt: null }` filter would normally strip it. We test
        // defensively: even if a soft-deleted row leaks through, our
        // helper's own .filter() should ignore it.
        makePaymentRow({
          id: "p2",
          amount: 30000n,
          type: "REFUND",
          deletedAt: new Date(),
        }),
      ]),
    );
    vi.mocked(prisma.salePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 130000n }),
    );

    const result = await createSalePayment(
      validInput({ amount: 1300, type: "PAYMENT" }),
    );

    expect(result.ok).toBe(true);
  });
});

describe("softDeleteSalePayment", () => {
  it("happy path — Prisma update with where.deletedAt:null + data.deletedAt:<Date>", async () => {
    vi.mocked(prisma.salePayment.update).mockResolvedValue(
      makePaymentRow({ deletedAt: new Date() }),
    );

    const result = await softDeleteSalePayment("cuid-pmt-1");

    expect(result.ok).toBe(true);
    expect(prisma.salePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cuid-pmt-1", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/sales");
  });

  it("deletedAt set on update is a Date instance", async () => {
    vi.mocked(prisma.salePayment.update).mockResolvedValue(makePaymentRow());

    await softDeleteSalePayment("cuid-pmt-1");

    const call = vi.mocked(prisma.salePayment.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteSalePayment("cuid-pmt-1")).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.salePayment.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Phase 5 RBAC — parameterised role matrix.
// SalePayment actions are ADMIN-only. 2 actions × 4 roles = 8 tests.
// =====================================================================

const SALE_PAYMENT_ROLE_MATRIX = [
  ["ADMIN", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", false],
  ["CASTING_PLATING_MGMT", false],
] as const;

function sessionFor(role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT") {
  return {
    user: { id: "u", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

describe.each(SALE_PAYMENT_ROLE_MATRIX)("createSalePayment role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
      vi.mocked(prisma.salePayment.create).mockResolvedValue(
        makePaymentRow({ amount: 50000n }),
      );
      const r = await createSalePayment(validInput({ amount: 500 }));
      expect(r.ok).toBe(true);
      expect(prisma.salePayment.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createSalePayment(validInput())).rejects.toThrow("Forbidden");
      expect(prisma.salePayment.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(SALE_PAYMENT_ROLE_MATRIX)("softDeleteSalePayment role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.salePayment.update).mockResolvedValue(
        makePaymentRow({ deletedAt: new Date() }),
      );
      const r = await softDeleteSalePayment("cuid-pmt-1");
      expect(r.ok).toBe(true);
      expect(prisma.salePayment.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeleteSalePayment("cuid-pmt-1")).rejects.toThrow("Forbidden");
      expect(prisma.salePayment.update).not.toHaveBeenCalled();
    }
  });
});
