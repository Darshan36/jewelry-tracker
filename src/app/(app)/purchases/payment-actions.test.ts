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
  createPurchasePayment,
  softDeletePurchasePayment,
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

type RawPurchase = {
  id: string;
  date: Date;
  supplierId: string | null;
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
  purchaseId: string;
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
  purchaseId: string;
  date: Date;
  qtyReturned: number;
  refundAmount: bigint;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function makePurchaseRow(
  overrides: Partial<RawPurchase> = {},
  payments: RawPayment[] = [],
  returns: RawReturn[] = [],
): RawPurchase & { payments: RawPayment[]; returns: RawReturn[] } {
  return {
    id: "cuid-purchase-test",
    date: new Date("2026-05-14T00:00:00Z"),
    supplierId: null,
    partyName: "Test Walkin Vendor",
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
    purchaseId: "cuid-purchase-test",
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
      purchaseId: "cuid-purchase-test",
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

describe("createPurchasePayment", () => {
  it("happy path — converts rupees to BigInt paise at Prisma boundary", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());
    vi.mocked(prisma.purchasePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 50000n }),
    );

    await createPurchasePayment(validInput({ amount: 500 }));

    expect(prisma.purchasePayment.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.purchasePayment.create).mock.calls[0][0];
    expect(call.data.amount).toBe(50000n);
    expect(typeof call.data.amount).toBe("bigint");
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("aggregates existing non-deleted payments for remaining-balance check", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [makePaymentRow({ id: "p1", amount: 50000n })]),
    );
    vi.mocked(prisma.purchasePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 190000n }),
    );

    const result = await createPurchasePayment(validInput({ amount: 1900 }));

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.purchasePayment.create).mock.calls[0][0];
    expect(call.data.amount).toBe(190000n);
  });

  it("rejects overpayment with formatted 'Owed to supplier' in message", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [makePaymentRow({ id: "p1", amount: 50000n })]),
    );

    const result = await createPurchasePayment(validInput({ amount: 2000 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
      const msg = result.errors.amount?.[0] ?? "";
      expect(msg).toContain("Exceeds remaining balance");
      // Purchases-direction inversion: error mentions "Owed to supplier"
      expect(msg).toContain("Owed to supplier");
      expect(msg).toMatch(/₹\s*1,900\.00/);
    }
    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects when purchase is not found", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(null);

    const result = await createPurchasePayment(
      validInput({ purchaseId: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.purchaseId).toContain("Purchase not found");
    }
    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();
  });

  it("treats a soft-deleted purchase as not-found (deletedAt:null guard)", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(null);

    const result = await createPurchasePayment(
      validInput({ purchaseId: "soft-deleted-id" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.purchaseId).toContain("Purchase not found");
    }
    const call = vi.mocked(prisma.purchase.findUnique).mock.calls[0][0];
    expect(call.where).toEqual({
      id: "soft-deleted-id",
      deletedAt: null,
    });
  });

  it("includes payments AND returns where deletedAt:null filter on the lookup query", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());
    vi.mocked(prisma.purchasePayment.create).mockResolvedValue(makePaymentRow());

    await createPurchasePayment(validInput());

    const findCall = vi.mocked(prisma.purchase.findUnique).mock.calls[0][0];
    expect(findCall.include).toEqual({
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
    });
  });

  it("rejects schema-invalid input (zero amount) without touching the DB", async () => {
    const result = await createPurchasePayment(validInput({ amount: 0 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
    }
    expect(prisma.purchase.findUnique).not.toHaveBeenCalled();
    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();
  });

  it("returned payment.amount is Number (paise), not BigInt", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());
    vi.mocked(prisma.purchasePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 50000n }),
    );

    const result = await createPurchasePayment(validInput({ amount: 500 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.payment.amount).toBe("number");
      expect(result.payment.amount).toBe(50000);
    }
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createPurchasePayment(validInput())).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();
  });

  // REFUND-type (supplier-direction: money IN to shop) tests.

  it("REFUND happy path — type=REFUND persisted (supplier refunded shop)", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow(
        {},
        [makePaymentRow({ id: "p1", amount: 240000n, type: "PAYMENT" })],
        [{ id: "r1", purchaseId: "cuid-purchase-test", date: new Date(), qtyReturned: 2, refundAmount: 40000n, note: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }],
      ),
    );
    vi.mocked(prisma.purchasePayment.create).mockResolvedValue(
      makePaymentRow({ id: "r-pmt", amount: 40000n, type: "REFUND" }),
    );

    const result = await createPurchasePayment(
      validInput({ amount: 400, type: "REFUND" }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.purchasePayment.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.purchasePayment.create).mock.calls[0][0];
    expect(call.data.type).toBe("REFUND");
    expect(call.data.amount).toBe(40000n);
  });

  it("REFUND rejects when amount > net paidAmount (can't receive back more than shop paid)", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [
        makePaymentRow({ id: "p1", amount: 50000n, type: "PAYMENT" }),
      ]),
    );

    const result = await createPurchasePayment(
      validInput({ amount: 1000, type: "REFUND" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
      const msg = result.errors.amount?.[0] ?? "";
      expect(msg).toContain("Refund exceeds amount paid");
      expect(msg).toMatch(/₹\s*500\.00/);
    }
    expect(prisma.purchasePayment.create).not.toHaveBeenCalled();
  });

  it("PAYMENT check uses effective total (subtracts returnTotal)", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow(
        {},
        [],
        [{ id: "r1", purchaseId: "cuid-purchase-test", date: new Date(), qtyReturned: 2, refundAmount: 40000n, note: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null }],
      ),
    );

    const result = await createPurchasePayment(
      validInput({ amount: 2500, type: "PAYMENT" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.amount?.[0] ?? "";
      expect(msg).toContain("Exceeds remaining balance");
      // Effective 200000 paise → ₹2,000.00 owed to supplier
      expect(msg).toMatch(/₹\s*2,000\.00/);
    }
  });

  it("aggregates PAYMENT minus REFUND for net paidAmount on PAYMENT check", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [
        makePaymentRow({ id: "p1", amount: 100000n, type: "PAYMENT" }),
        makePaymentRow({ id: "p2", amount: 30000n, type: "REFUND" }),
      ]),
    );
    vi.mocked(prisma.purchasePayment.create).mockResolvedValue(
      makePaymentRow({ id: "p-new", amount: 150000n, type: "PAYMENT" }),
    );

    const result = await createPurchasePayment(
      validInput({ amount: 1500, type: "PAYMENT" }),
    );

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.purchasePayment.create).mock.calls[0][0];
    expect(call.data.amount).toBe(150000n);
  });

  it("excludes soft-deleted refunds AND payments from net paidAmount", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [
        makePaymentRow({ id: "p1", amount: 100000n, type: "PAYMENT" }),
        makePaymentRow({
          id: "p2",
          amount: 30000n,
          type: "REFUND",
          deletedAt: new Date(),
        }),
      ]),
    );
    vi.mocked(prisma.purchasePayment.create).mockResolvedValue(
      makePaymentRow({ amount: 130000n }),
    );

    const result = await createPurchasePayment(
      validInput({ amount: 1300, type: "PAYMENT" }),
    );

    expect(result.ok).toBe(true);
  });
});

describe("softDeletePurchasePayment", () => {
  it("happy path — Prisma update with where.deletedAt:null + data.deletedAt:<Date>", async () => {
    vi.mocked(prisma.purchasePayment.update).mockResolvedValue(
      makePaymentRow({ deletedAt: new Date() }),
    );

    const result = await softDeletePurchasePayment("cuid-pmt-1");

    expect(result.ok).toBe(true);
    expect(prisma.purchasePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cuid-pmt-1", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("deletedAt set on update is a Date instance", async () => {
    vi.mocked(prisma.purchasePayment.update).mockResolvedValue(makePaymentRow());

    await softDeletePurchasePayment("cuid-pmt-1");

    const call = vi.mocked(prisma.purchasePayment.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeletePurchasePayment("cuid-pmt-1")).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.purchasePayment.update).not.toHaveBeenCalled();
  });
});
