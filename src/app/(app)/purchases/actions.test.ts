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

function makePurchaseLineItem(
  overrides: Partial<{
    id: string;
    purchaseId: string;
    itemDescription: string;
    qty: number;
    rate: bigint;
    createdAt: Date;
  }> = {},
) {
  return {
    id: "line-1",
    purchaseId: "cuid-purchase-test",
    itemDescription: "Raw gold-plated wire",
    qty: 10,
    rate: 25000n,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    ...overrides,
  };
}

function makePurchase(
  overrides: Partial<{
    id: string;
    date: Date;
    supplierId: string | null;
    partyName: string;
    partyPhone: string | null;
    discount: bigint;
    total: bigint;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
  lineItems: ReturnType<typeof makePurchaseLineItem>[] = [
    makePurchaseLineItem(),
  ],
) {
  return {
    id: "cuid-purchase-test",
    date: new Date("2026-05-14T00:00:00Z"),
    supplierId: null,
    partyName: "Test Walkin Vendor",
    partyPhone: null,
    discount: 0n,
    total: 240000n,
    notes: null,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    updatedAt: new Date("2026-05-14T12:00:00Z"),
    deletedAt: null,
    ...overrides,
    lineItems,
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

function validInput(
  overrides: Partial<{
    date: Date;
    supplierId: string | null;
    partyName: string;
    partyPhone: string | null;
    lineItems: Array<{ itemDescription: string; qty: number; rate: number }>;
    discount: number;
    notes: string | null;
  }> = {},
) {
  return {
    date: new Date("2026-05-14T00:00:00Z"),
    supplierId: null as string | null,
    partyName: "Test Walkin Vendor",
    partyPhone: null as string | null,
    lineItems: [{ itemDescription: "Raw gold-plated wire", qty: 10, rate: 250 }],
    discount: 100,
    notes: null as string | null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
});

describe("createPurchase", () => {
  it("walk-in happy path — converts rupees to BigInt paise at the Prisma boundary on each line", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(
      makePurchase({ total: 240000n, discount: 10000n }),
    );

    await createPurchase(validInput());

    expect(prisma.purchase.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.discount).toBe(10000n);
    expect(typeof call.data.discount).toBe("bigint");
    expect(call.data.total).toBe(240000n);
    expect(typeof call.data.total).toBe("bigint");
    const created =
      (call.data.lineItems as { create: Array<{ rate: bigint; qty: number; itemDescription: string }> })
        .create;
    expect(created).toHaveLength(1);
    expect(created[0].rate).toBe(25000n);
    expect(typeof created[0].rate).toBe("bigint");
    expect(created[0].qty).toBe(10);
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("walk-in happy path — passes through partyName, leaves phone null when not provided", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    await createPurchase(
      validInput({ partyName: "Walkin Vendor Co", partyPhone: null }),
    );

    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Walkin Vendor Co");
    expect(call.data.partyPhone).toBeNull();
    expect(call.data.supplierId).toBeNull();
  });

  it("linked-supplier happy path — snapshots partyName/partyPhone from Supplier row, ignoring form values", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(
      makeSupplier({ id: "supp-real", name: "Real Supplier Name", phone: "8888888888" }),
    );
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    await createPurchase(
      validInput({
        supplierId: "supp-real",
        partyName: "FORM TYPED THIS — should be ignored",
        partyPhone: "0000000000",
      }),
    );

    expect(prisma.supplier.findUnique).toHaveBeenCalledWith({
      where: { id: "supp-real", deletedAt: null },
    });
    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Real Supplier Name");
    expect(call.data.partyPhone).toBe("8888888888");
    expect(call.data.supplierId).toBe("supp-real");
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

  it("rejects when discount exceeds subtotal (action-layer guard)", async () => {
    const result = await createPurchase(
      validInput({
        lineItems: [{ itemDescription: "x", qty: 2, rate: 100 }],
        discount: 500,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.discount).toContain(
        "Discount cannot exceed line item subtotal",
      );
    }
    expect(prisma.purchase.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("computes total in BigInt paise across line items (no float math)", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    // line 1: 3 × 99.99 = 299.97; line 2: 5 × 49.99 = 249.95
    // subtotal = 549.92 → 54992 paise; discount = 9.99 → 999 paise
    await createPurchase(
      validInput({
        lineItems: [
          { itemDescription: "A", qty: 3, rate: 99.99 },
          { itemDescription: "B", qty: 5, rate: 49.99 },
        ],
        discount: 9.99,
      }),
    );

    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.total).toBe(53993n);
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

  it("returned purchase.discount, total are Number (paise); lineItems[].rate is Number paise", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(
      makePurchase(
        { discount: 10000n, total: 240000n },
        [makePurchaseLineItem({ rate: 25000n, qty: 10 })],
      ),
    );

    const result = await createPurchase(validInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.purchase.discount).toBe("number");
      expect(typeof result.purchase.total).toBe("number");
      expect(result.purchase.total).toBe(240000);
      expect(result.purchase.lineItems).toHaveLength(1);
      expect(typeof result.purchase.lineItems[0].rate).toBe("number");
      expect(result.purchase.lineItems[0].rate).toBe(25000);
      expect(result.purchase.status).toBe("pending");
    }
  });

  it("creates one PurchaseLineItem per input line", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    await createPurchase(
      validInput({
        lineItems: [
          { itemDescription: "A", qty: 1, rate: 100 },
          { itemDescription: "B", qty: 2, rate: 200 },
          { itemDescription: "C", qty: 3, rate: 300 },
        ],
      }),
    );

    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    const created = (call.data.lineItems as { create: unknown[] }).create;
    expect(created).toHaveLength(3);
  });

  it("rejects an empty lineItems array (schema-level minimum 1)", async () => {
    const result = await createPurchase(validInput({ lineItems: [] }));
    expect(result.ok).toBe(false);
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });

  it("propagates auth failure (requireRole throws)", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createPurchase(validInput())).rejects.toThrow("Unauthorized");

    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });
});

describe("updatePurchase", () => {
  it("happy path — deletes old line items, recreates new ones, recomputes total", async () => {
    vi.mocked(prisma.purchaseLineItem.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.purchase.update).mockResolvedValue(
      makePurchase({ id: "purchase-abc", total: 60000n, discount: 15000n }),
    );

    await updatePurchase(
      "purchase-abc",
      validInput({
        lineItems: [{ itemDescription: "X", qty: 3, rate: 250 }],
        discount: 150,
      }),
    );

    expect(prisma.purchaseLineItem.deleteMany).toHaveBeenCalledWith({
      where: { purchaseId: "purchase-abc" },
    });
    expect(prisma.purchase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "purchase-abc", deletedAt: null },
        data: expect.objectContaining({
          total: 60000n,
          discount: 15000n,
        }),
      }),
    );
    const updateCall = vi.mocked(prisma.purchase.update).mock.calls[0][0];
    const created =
      (updateCall.data.lineItems as { create: Array<{ rate: bigint }> }).create;
    expect(created).toHaveLength(1);
    expect(created[0].rate).toBe(25000n);
  });

  it("re-snapshots supplier when supplierId changes during update", async () => {
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue(
      makeSupplier({ id: "supp-new", name: "Newly Linked", phone: "7777" }),
    );
    vi.mocked(prisma.purchaseLineItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.purchase.update).mockResolvedValue(makePurchase());

    await updatePurchase(
      "purchase-abc",
      validInput({
        supplierId: "supp-new",
        partyName: "form said this",
        partyPhone: "form said this phone",
      }),
    );

    const call = vi.mocked(prisma.purchase.update).mock.calls[0][0];
    expect(call.data.partyName).toBe("Newly Linked");
    expect(call.data.partyPhone).toBe("7777");
  });

  it("rejects discount-exceeds-subtotal on update too", async () => {
    const result = await updatePurchase(
      "purchase-abc",
      validInput({
        lineItems: [{ itemDescription: "x", qty: 1, rate: 100 }],
        discount: 200,
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.discount).toContain(
        "Discount cannot exceed line item subtotal",
      );
    }
    expect(prisma.purchase.update).not.toHaveBeenCalled();
    expect(prisma.purchaseLineItem.deleteMany).not.toHaveBeenCalled();
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

// =====================================================================
// Phase 5 RBAC — parameterised role matrix.
// =====================================================================

const PURCHASE_ROLE_MATRIX = [
  ["ADMIN", true],
  ["PURCHASE_DEPT", true],
  ["LABOUR_MGMT", false],
  ["CASTING_PLATING_MGMT", false],
] as const;

function sessionFor(role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT") {
  return {
    user: { id: "u", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

describe.each(PURCHASE_ROLE_MATRIX)("createPurchase role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());
      const r = await createPurchase(validInput());
      expect(r.ok).toBe(true);
      expect(prisma.purchase.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createPurchase(validInput())).rejects.toThrow("Forbidden");
      expect(prisma.purchase.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(PURCHASE_ROLE_MATRIX)("updatePurchase role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.purchaseLineItem.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.purchase.update).mockResolvedValue(makePurchase());
      const r = await updatePurchase("purchase-abc", validInput());
      expect(r.ok).toBe(true);
      expect(prisma.purchase.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(updatePurchase("purchase-abc", validInput())).rejects.toThrow("Forbidden");
      expect(prisma.purchase.update).not.toHaveBeenCalled();
    }
  });
});

describe.each(PURCHASE_ROLE_MATRIX)("softDeletePurchase role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.purchase.update).mockResolvedValue(makePurchase({ deletedAt: new Date() }));
      const r = await softDeletePurchase("purchase-abc");
      expect(r.ok).toBe(true);
      expect(prisma.purchase.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeletePurchase("purchase-abc")).rejects.toThrow("Forbidden");
      expect(prisma.purchase.update).not.toHaveBeenCalled();
    }
  });
});

// =====================================================================
// Phase 6 — walk-in auto-promotion (Supplier mirror of Sales).
// =====================================================================

describe("createPurchase auto-promotion (Phase 6)", () => {
  it("walk-in + new phone → auto-creates supplier and links the purchase", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.supplier.create).mockResolvedValue(
      makeSupplier({ id: "auto-supp-1", name: "New Supplier", phone: "9876500001" }),
    );
    vi.mocked(prisma.purchase.create).mockResolvedValue(
      makePurchase({
        supplierId: "auto-supp-1",
        partyName: "New Supplier",
        partyPhone: "9876500001",
      }),
    );

    const result = await createPurchase(
      validInput({ partyName: "New Supplier", partyPhone: "9876500001" }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
      where: { phone: "9876500001", deletedAt: null },
    });
    expect(prisma.supplier.create).toHaveBeenCalledWith({
      data: {
        name: "New Supplier",
        phone: "9876500001",
        email: null,
        address: null,
        notes: null,
      },
    });
    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.supplierId).toBe("auto-supp-1");
    expect(call.data.partyName).toBe("New Supplier");
    expect(call.data.partyPhone).toBe("9876500001");
  });

  it("walk-in + existing phone → links to existing supplier, no new supplier created", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue(
      makeSupplier({ id: "existing-supp", name: "Canonical Vendor", phone: "9876500001" }),
    );
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    const result = await createPurchase(
      validInput({ partyName: "Whatever Typed", partyPhone: "9876500001" }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.supplier.findFirst).toHaveBeenCalledOnce();
    expect(prisma.supplier.create).not.toHaveBeenCalled();
    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.supplierId).toBe("existing-supp");
    expect(call.data.partyName).toBe("Canonical Vendor");
    expect(call.data.partyPhone).toBe("9876500001");
  });

  it("walk-in + existing phone, typed name differs → canonical name wins", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue(
      makeSupplier({ id: "s", name: "Real Vendor", phone: "9876500001" }),
    );
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    await createPurchase(
      validInput({
        supplierId: null,
        partyName: "TYPED — should be overridden",
        partyPhone: "9876500001",
      }),
    );

    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Real Vendor");
    expect(call.data.partyName).not.toBe("TYPED — should be overridden");
  });

  it("walk-in + null phone → stays snapshot-only, no supplier touched", async () => {
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    const result = await createPurchase(
      validInput({ partyName: "No Phone Vendor", partyPhone: null }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
    expect(prisma.supplier.create).not.toHaveBeenCalled();
    const call = vi.mocked(prisma.purchase.create).mock.calls[0][0];
    expect(call.data.supplierId).toBeNull();
    expect(call.data.partyName).toBe("No Phone Vendor");
    expect(call.data.partyPhone).toBeNull();
  });

  it("normalised phone — dashes/spaces in the input still match a clean stored phone", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue(
      makeSupplier({ id: "s", name: "Existing", phone: "9876500001" }),
    );
    vi.mocked(prisma.purchase.create).mockResolvedValue(makePurchase());

    await createPurchase(
      validInput({ partyName: "Whatever", partyPhone: "9876-500-001" }),
    );

    expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
      where: { phone: "9876500001", deletedAt: null },
    });
  });

  it("transaction atomicity — if supplier.create throws, purchase.create is never called", async () => {
    vi.mocked(prisma.supplier.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.supplier.create).mockRejectedValueOnce(
      new Error("DB constraint violation"),
    );

    await expect(
      createPurchase(validInput({ partyName: "X", partyPhone: "9876500001" })),
    ).rejects.toThrow();
    expect(prisma.purchase.create).not.toHaveBeenCalled();
  });
});
