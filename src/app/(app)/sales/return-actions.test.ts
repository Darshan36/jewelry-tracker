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
  createSaleReturn,
  softDeleteSaleReturn,
} from "./return-actions";

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
  returns: RawReturn[] = [],
): RawSale & { returns: RawReturn[] } {
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
    returns,
  };
}

function makeReturnRow(overrides: Partial<RawReturn> = {}): RawReturn {
  return {
    id: "cuid-ret-default",
    saleId: "cuid-sale-test",
    date: new Date("2026-05-14T00:00:00Z"),
    qtyReturned: 1,
    refundAmount: 10000n,
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
      qtyReturned: 2,
      refundAmount: 400,
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

describe("createSaleReturn", () => {
  it("happy path — converts refundAmount rupees to BigInt paise at Prisma boundary", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
    vi.mocked(prisma.saleReturn.create).mockResolvedValue(
      makeReturnRow({ qtyReturned: 2, refundAmount: 40000n }),
    );

    await createSaleReturn(validInput({ qtyReturned: 2, refundAmount: 400 }));

    expect(prisma.saleReturn.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.saleReturn.create).mock.calls[0][0];
    expect(call.data.qtyReturned).toBe(2);
    // 400 rupees → 40000 paise as BigInt
    expect(call.data.refundAmount).toBe(40000n);
    expect(typeof call.data.refundAmount).toBe("bigint");
    expect(revalidatePath).toHaveBeenCalledWith("/sales");
  });

  it("rejects single return where qtyReturned > sale.qty", async () => {
    // sale.qty = 10, request qty 11 → reject
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());

    const result = await createSaleReturn(validInput({ qtyReturned: 11 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.qtyReturned).toBeDefined();
      const msg = result.errors.qtyReturned?.[0] ?? "";
      expect(msg).toContain("Cannot return more than the original quantity");
      expect(msg).toContain("Already returned: 0 of 10");
    }
    expect(prisma.saleReturn.create).not.toHaveBeenCalled();
  });

  it("aggregates existing returned qty for the cumulative check", async () => {
    // sale.qty = 10, existing returns of qty 3 + 4 = 7. New qty 4 → 7 + 4 = 11 > 10 → reject.
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [
        makeReturnRow({ id: "r1", qtyReturned: 3 }),
        makeReturnRow({ id: "r2", qtyReturned: 4 }),
      ]),
    );

    const result = await createSaleReturn(validInput({ qtyReturned: 4 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.qtyReturned?.[0]).toContain("Already returned: 7 of 10");
    }
    expect(prisma.saleReturn.create).not.toHaveBeenCalled();
  });

  it("accepts return that exactly hits the cumulative qty boundary", async () => {
    // existing 7 returned, new 3 → 10 of 10 → allowed
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [makeReturnRow({ id: "r1", qtyReturned: 7 })]),
    );
    vi.mocked(prisma.saleReturn.create).mockResolvedValue(
      makeReturnRow({ qtyReturned: 3 }),
    );

    const result = await createSaleReturn(
      validInput({ qtyReturned: 3, refundAmount: 100 }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.saleReturn.create).toHaveBeenCalledOnce();
  });

  it("rejects refundAmount > sale.total - existingReturnTotal", async () => {
    // sale.total = 240000 paise, existing refund 100000n → remaining 140000 paise = ₹1400
    // request refund 2000 rupees = 200000 paise > 140000 → reject
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(
      makeSaleRow({}, [
        makeReturnRow({ id: "r1", qtyReturned: 1, refundAmount: 100000n }),
      ]),
    );

    const result = await createSaleReturn(
      validInput({ qtyReturned: 1, refundAmount: 2000 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.refundAmount).toBeDefined();
      const msg = result.errors.refundAmount?.[0] ?? "";
      expect(msg).toContain("Refund exceeds remaining returnable value");
      // Maximum is ₹1,400.00 (140000 paise)
      expect(msg).toMatch(/₹\s*1,400\.00/);
    }
    expect(prisma.saleReturn.create).not.toHaveBeenCalled();
  });

  it("rejects when sale is not found", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null);

    const result = await createSaleReturn(
      validInput({ saleId: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.saleId).toContain("Sale not found");
    }
  });

  it("treats a soft-deleted sale as not found (deletedAt:null guard)", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null);

    const result = await createSaleReturn(
      validInput({ saleId: "soft-deleted-id" }),
    );

    expect(result.ok).toBe(false);
    // Verify the where included deletedAt:null
    const call = vi.mocked(prisma.sale.findUnique).mock.calls[0][0];
    expect(call.where).toEqual({
      id: "soft-deleted-id",
      deletedAt: null,
    });
  });

  it("schema rejection (negative qty) without touching DB", async () => {
    const result = await createSaleReturn(validInput({ qtyReturned: -1 }));

    expect(result.ok).toBe(false);
    expect(prisma.sale.findUnique).not.toHaveBeenCalled();
    expect(prisma.saleReturn.create).not.toHaveBeenCalled();
  });

  it("returned return.refundAmount is Number (paise), not BigInt", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
    vi.mocked(prisma.saleReturn.create).mockResolvedValue(
      makeReturnRow({ refundAmount: 40000n }),
    );

    const result = await createSaleReturn(
      validInput({ qtyReturned: 1, refundAmount: 400 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.return.refundAmount).toBe("number");
      expect(result.return.refundAmount).toBe(40000);
    }
  });

  it("includes returns where deletedAt:null filter on the lookup query", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow());
    vi.mocked(prisma.saleReturn.create).mockResolvedValue(makeReturnRow());

    await createSaleReturn(validInput());

    const call = vi.mocked(prisma.sale.findUnique).mock.calls[0][0];
    expect(call.include).toEqual({
      returns: { where: { deletedAt: null } },
    });
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createSaleReturn(validInput())).rejects.toThrow("Unauthorized");

    expect(prisma.saleReturn.create).not.toHaveBeenCalled();
  });
});

describe("softDeleteSaleReturn", () => {
  it("happy path — Prisma update with where.deletedAt:null + data.deletedAt:<Date>", async () => {
    vi.mocked(prisma.saleReturn.update).mockResolvedValue(
      makeReturnRow({ deletedAt: new Date() }),
    );

    const result = await softDeleteSaleReturn("cuid-ret-1");

    expect(result.ok).toBe(true);
    expect(prisma.saleReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cuid-ret-1", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/sales");
  });

  it("deletedAt set on update is a Date instance", async () => {
    vi.mocked(prisma.saleReturn.update).mockResolvedValue(makeReturnRow());

    await softDeleteSaleReturn("cuid-ret-1");

    const call = vi.mocked(prisma.saleReturn.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteSaleReturn("cuid-ret-1")).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.saleReturn.update).not.toHaveBeenCalled();
  });
});
