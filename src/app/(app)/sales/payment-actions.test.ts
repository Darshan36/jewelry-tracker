import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireSession: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guards";
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
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function makeSaleRow(
  overrides: Partial<RawSale> = {},
  payments: RawPayment[] = [],
): RawSale & { payments: RawPayment[] } {
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
  };
}

function makePaymentRow(overrides: Partial<RawPayment> = {}): RawPayment {
  return {
    id: "cuid-pmt-default",
    saleId: "cuid-sale-test",
    date: new Date("2026-05-14T00:00:00Z"),
    amount: 50000n,
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
      note: null as string | null,
    };
  }
  return { ...base(), ...overrides };
}

beforeEach(() => {
  vi.mocked(requireSession).mockReset();
  vi.mocked(requireSession).mockResolvedValue(fakeSession);
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

  it("excludes already-soft-deleted payments from the aggregation via include filter", async () => {
    // Test the *intent* — the action passes `where: { deletedAt: null }` to
    // the include, so Prisma returns only active payments. We verify the
    // shape of the include argument.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
    vi.mocked(prisma.salePayment.create).mockResolvedValue(makePaymentRow());

    await createSalePayment(validInput());

    const findCall = vi.mocked(prisma.sale.findUnique).mock.calls[0][0];
    expect(findCall.include).toEqual({
      payments: { where: { deletedAt: null } },
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
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createSalePayment(validInput())).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.salePayment.create).not.toHaveBeenCalled();
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
    vi.mocked(requireSession).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteSalePayment("cuid-pmt-1")).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.salePayment.update).not.toHaveBeenCalled();
  });
});
