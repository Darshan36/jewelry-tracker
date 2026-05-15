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
  createPurchase,
  softDeletePurchase,
  updatePurchase,
} from "./actions";

const fakeSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    name: "Test Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

function makePurchase(
  overrides: Partial<{
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
  }> = {},
) {
  return {
    id: "cuid-purchase-test",
    date: new Date("2026-05-14T00:00:00Z"),
    supplierId: null,
    partyName: "Test Walkin Vendor",
    partyPhone: null,
    itemDescription: "Test item",
    qty: 1,
    rate: 10000n,
    discount: 0n,
    total: 10000n,
    notes: null,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    updatedAt: new Date("2026-05-14T12:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function makeSupplier(
  overrides: Partial<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "cuid-supplier-1",
    name: "Real Supplier",
    phone: "9999999999",
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function validInput(overrides: Partial<ReturnType<typeof base>> = {}) {
  function base() {
    return {
      date: new Date("2026-05-14T00:00:00Z"),
      supplierId: null as string | null,
      partyName: "Test Walkin Vendor",
      partyPhone: null as string | null,
      itemDescription: "Gold wire",
      qty: 10,
      rate: 250,
      discount: 100,
      notes: null as string | null,
    };
  }
  return { ...base(), ...overrides };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
});

describe("createPurchase", () => {
  it("walk-in happy path — converts rupees to BigInt paise at Prisma boundary", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(
      makePurchase({ total: 2400_00n, rate: 250_00n, discount: 100_00n, qty: 10 }),
    );

    await createPurchase(validInput());

    expect(prisma.purchase.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.rate).toBe(25000n);
    expect(call.data.discount).toBe(10000n);
    expect(typeof call.data.rate).toBe("bigint");
    expect(call.data.total).toBe(240000n);
    expect(typeof call.data.total).toBe("bigint");
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("walk-in happy path — passes through partyName/partyPhone from form input", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    await createPurchase(
      validInput({ partyName: "Walkin Vendor Co", partyPhone: "1234567890" }),
    );

    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Walkin Vendor Co");
    expect(call.data.partyPhone).toBe("1234567890");
    expect(call.data.supplierId).toBeNull();
  });

  it("linked-supplier happy path — snapshots partyName/partyPhone from Supplier row, ignoring form values", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(
      makeSupplier({ id: "sup-real", name: "Real Supplier Name", phone: "8888888888" }),
    );
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    await createPurchase(
      validInput({
        supplierId: "sup-real",
        partyName: "FORM TYPED THIS — should be ignored",
        partyPhone: "0000000000",
      }),
    );

    expect(prisma.supplier.findUnique).toHaveBeenCalledWith({
      where: { id: "sup-real", deletedAt: null },
    });
    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Real Supplier Name");
    expect(call.data.partyPhone).toBe("8888888888");
    expect(call.data.supplierId).toBe("sup-real");
  });

  it("returns supplierId error when the supplier is not found", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null);

    const result = await createPurchase(
      validInput({ supplierId: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.supplierId).toContain("Supplier not found");
    }
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it("treats a soft-deleted supplier as not found (deletedAt:null guard)", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(null);

    const result = await createPurchase(
      validInput({ supplierId: "soft-deleted-id" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.supplierId).toContain("Supplier not found");
    }
  });

  it("rejects when discount exceeds qty × rate (action-layer guard)", async () => {
    const result = await createPurchase(
      validInput({ qty: 2, rate: 100, discount: 500 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.discount).toContain(
        "Discount cannot exceed line total",
      );
    }
    expect(prisma.purchase.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("computes total in BigInt paise (no float math)", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    // 3 × 99.99 - 9.99 = 289.98 → 28998 paise
    await createPurchase(
      validInput({ qty: 3, rate: 99.99, discount: 9.99 }),
    );

    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.total).toBe(28998n);
  });

  it("schema rejection — returns field errors without touching the DB", async () => {
    const result = await createPurchase(
      validInput({ partyName: "" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.partyName).toBeDefined();
    }
    expect(prisma.purchase.create).not.toHaveBeenCalled();
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
  });

  it("returned purchase.rate, discount, total are Number (paise), not BigInt", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(
      makePurchase({ rate: 25000n, discount: 10000n, total: 240000n }),
    );

    const result = await createPurchase(validInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.purchase.rate).toBe("number");
      expect(typeof result.purchase.discount).toBe("number");
      expect(typeof result.purchase.total).toBe("number");
      expect(result.purchase.total).toBe(240000);
      expect(result.purchase.status).toBe("pending");
    }
  });

  it("propagates auth failure (requireRole throws)", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createPurchase(validInput())).rejects.toThrow("Unauthorized");

    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });
});

describe("updatePurchase", () => {
  it("happy path — Prisma update called with where.deletedAt=null + recomputed total", async () => {
    vi.mocked(prisma.purchase.update).mockResolvedValue(
      makePurchase({ id: "purchase-abc", total: 600_00n }),
    );

    await updatePurchase(
      "purchase-abc",
      validInput({ qty: 3, rate: 250, discount: 150 }),
    );

    expect(prisma.purchase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "purchase-abc", deletedAt: null },
        data: expect.objectContaining({
          total: 60000n,
          rate: 25000n,
          discount: 15000n,
        }),
      }),
    );
  });

  it("re-snapshots supplier when supplierId changes during update", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(
      makeSupplier({ id: "sup-new", name: "Newly Linked", phone: "7777" }),
    );
    vi.mocked(prisma.purchase.update).mockResolvedValue(makePurchase());

    await updatePurchase(
      "purchase-abc",
      validInput({
        supplierId: "sup-new",
        partyName: "form said this",
        partyPhone: "form said this phone",
      }),
    );

    const call = vi.mocked(prisma.purchase.update).mock.calls[0][0];
    expect(call.data.partyName).toBe("Newly Linked");
    expect(call.data.partyPhone).toBe("7777");
  });

  it("rejects discount-exceeds-total on update too", async () => {
    const result = await updatePurchase(
      "purchase-abc",
      validInput({ qty: 1, rate: 100, discount: 200 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.discount).toContain(
        "Discount cannot exceed line total",
      );
    }
    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(updatePurchase("purchase-abc", validInput())).rejects.toThrow(
      "Unauthorized",
    );
  });
});

describe("softDeletePurchase", () => {
  it("happy path — Prisma update called with where.deletedAt=null + data.deletedAt=<Date>", async () => {
    vi.mocked(prisma.purchase.update).mockResolvedValue(
      makePurchase({ deletedAt: new Date() }),
    );

    const result = await softDeletePurchase("purchase-abc");

    expect(result.ok).toBe(true);
    expect(prisma.purchase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "purchase-abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("deletedAt is a Date instance (not string/number)", async () => {
    vi.mocked(prisma.purchase.update).mockResolvedValue(makePurchase());

    await softDeletePurchase("purchase-abc");

    const call = vi.mocked(prisma.purchase.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeletePurchase("purchase-abc")).rejects.toThrow("Unauthorized");

    expect(prisma.purchase.update).not.toHaveBeenCalled();
  });
});
