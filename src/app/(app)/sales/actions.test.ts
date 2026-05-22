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
  createSale,
  softDeleteSale,
  updateSale,
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

function makeSaleLineItem(
  overrides: Partial<{
    id: string;
    saleId: string;
    itemDescription: string;
    qty: number;
    rate: bigint;
    createdAt: Date;
  }> = {},
) {
  return {
    id: "line-1",
    saleId: "cuid-sale-test",
    itemDescription: "Test item",
    qty: 10,
    rate: 25000n,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    ...overrides,
  };
}

function makeSale(
  overrides: Partial<{
    id: string;
    date: Date;
    partyId: string | null;
    partyName: string;
    partyPhone: string | null;
    discount: bigint;
    total: bigint;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
  lineItems: ReturnType<typeof makeSaleLineItem>[] = [makeSaleLineItem()],
) {
  return {
    id: "cuid-sale-test",
    date: new Date("2026-05-14T00:00:00Z"),
    partyId: null,
    partyName: "Test Walkin",
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

function makeParty(
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
    id: "cuid-customer-1",
    name: "Real Customer",
    phone: "9999999999",
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    isCustomer: false,
    isSupplier: false,
    isCastingVendor: false,
    isPlatingVendor: false,
    createdById: null,
    updatedById: null,
    deletedById: null,
    ...overrides,
  };
}

// Valid form-shape input — passes the schema. Rupee numbers, not paise.
function validInput(
  overrides: Partial<{
    date: Date;
    partyId: string | null;
    partyName: string;
    partyPhone: string | null;
    lineItems: Array<{ itemDescription: string; qty: number; rate: number }>;
    discount: number;
    notes: string | null;
  }> = {},
) {
  return {
    date: new Date("2026-05-14T00:00:00Z"),
    partyId: null as string | null,
    partyName: "Test Walkin",
    partyPhone: null as string | null,
    lineItems: [{ itemDescription: "Gold chain", qty: 10, rate: 250 }],
    discount: 100,
    notes: null as string | null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
  // Phase 21a: updateSale + softDeleteSale pre-fetch the existing
  // sale's partyId. Default the auto-mock to "walk-in" so existing
  // tests that don't care about partyId transitions keep passing.
  // Tests that DO care about transitions can override per-test via
  // vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(...).
  vi.mocked(prisma.sale.findUnique).mockResolvedValue({
    partyId: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  // Same: walk-in→party transition's payment-migration helper calls
  // tx.salePayment.findMany. Default to no walk-in payments.
  vi.mocked(prisma.salePayment.findMany).mockResolvedValue([]);
});

describe("createSale", () => {
  it("walk-in happy path — converts rupees to BigInt paise at the Prisma boundary on each line", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(
      makeSale({ total: 240000n, discount: 10000n }),
    );

    await createSale(validInput());

    expect(prisma.sale.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    // Top-level Sale fields
    expect(call.data.discount).toBe(10000n);
    expect(typeof call.data.discount).toBe("bigint");
    // total computed: 10 * 25000 - 10000 = 240000
    expect(call.data.total).toBe(240000n);
    expect(typeof call.data.total).toBe("bigint");
    // Line item nested create
    const created =
      (call.data.lineItems as { create: Array<{ rate: bigint; qty: number; itemDescription: string }> })
        .create;
    expect(created).toHaveLength(1);
    expect(created[0].rate).toBe(25000n);
    expect(typeof created[0].rate).toBe("bigint");
    expect(created[0].qty).toBe(10);
    expect(created[0].itemDescription).toBe("Gold chain");
    expect(revalidatePath).toHaveBeenCalledWith("/sales");
  });

  it("walk-in happy path — passes through partyName, leaves phone null when not provided", async () => {
    // Phase 6: walk-ins WITH a phone trigger auto-promotion. This test covers
    // the pure walk-in case (no phone) which stays snapshot-only.
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    await createSale(
      validInput({ partyName: "Walkin Bob", partyPhone: null }),
    );

    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Walkin Bob");
    expect(call.data.partyPhone).toBeNull();
    expect(call.data.partyId).toBeNull();
  });

  it("linked-customer happy path — snapshots partyName/partyPhone from Customer row, ignoring form values", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(
      makeParty({ id: "cust-real", name: "Real Customer Name", phone: "8888888888" }),
    );
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    await createSale(
      validInput({
        partyId: "cust-real",
        partyName: "FORM TYPED THIS — should be ignored",
        partyPhone: "0000000000",
      }),
    );

    expect(prisma.party.findUnique).toHaveBeenCalledWith({
      where: { id: "cust-real", deletedAt: null },
    });
    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Real Customer Name");
    expect(call.data.partyPhone).toBe("8888888888");
    expect(call.data.partyId).toBe("cust-real");
  });

  it("returns partyId error when the customer is not found", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(null);

    const result = await createSale(
      validInput({ partyId: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.partyId).toContain("Party not found");
    }
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it("treats a soft-deleted customer as not found (deletedAt:null guard)", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(null);

    const result = await createSale(
      validInput({ partyId: "soft-deleted-id" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.partyId).toContain("Party not found");
    }
  });

  it("rejects when discount exceeds subtotal (action-layer guard)", async () => {
    // subtotal = 2 * 100 = 200; discount = 500 → discount > subtotal
    const result = await createSale(
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
    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("computes total in BigInt paise across line items (no float math)", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    // line 1: 3 × 99.99 = 299.97; line 2: 5 × 49.99 = 249.95
    // subtotal = 549.92 → 54992 paise; discount = 9.99 → 999 paise
    // total = 54992 - 999 = 53993 paise
    await createSale(
      validInput({
        lineItems: [
          { itemDescription: "A", qty: 3, rate: 99.99 },
          { itemDescription: "B", qty: 5, rate: 49.99 },
        ],
        discount: 9.99,
      }),
    );

    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(call.data.total).toBe(53993n);
  });

  it("schema rejection — returns field errors without touching the DB", async () => {
    const result = await createSale(
      validInput({ partyName: "" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.partyName).toBeDefined();
    }
    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(prisma.party.findUnique).not.toHaveBeenCalled();
  });

  it("returned sale.discount, total are Number (paise); lineItems[].rate is Number paise", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(
      makeSale(
        { discount: 10000n, total: 240000n },
        [makeSaleLineItem({ rate: 25000n, qty: 10 })],
      ),
    );

    const result = await createSale(validInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.sale.discount).toBe("number");
      expect(typeof result.sale.total).toBe("number");
      expect(result.sale.total).toBe(240000);
      expect(result.sale.lineItems).toHaveLength(1);
      expect(typeof result.sale.lineItems[0].rate).toBe("number");
      expect(result.sale.lineItems[0].rate).toBe(25000);
      // Without payments/returns mocked, status defaults to "pending".
      expect(result.sale.status).toBe("pending");
    }
  });

  it("creates one SaleLineItem per input line", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    await createSale(
      validInput({
        lineItems: [
          { itemDescription: "A", qty: 1, rate: 100 },
          { itemDescription: "B", qty: 2, rate: 200 },
          { itemDescription: "C", qty: 3, rate: 300 },
        ],
      }),
    );

    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    const created =
      (call.data.lineItems as { create: unknown[] }).create;
    expect(created).toHaveLength(3);
  });

  it("rejects an empty lineItems array (schema-level minimum 1)", async () => {
    const result = await createSale(validInput({ lineItems: [] }));
    expect(result.ok).toBe(false);
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it("propagates auth failure (requireRole throws)", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createSale(validInput())).rejects.toThrow("Unauthorized");

    expect(prisma.sale.create).not.toHaveBeenCalled();
  });
});

describe("updateSale", () => {
  it("happy path — deletes old line items, recreates new ones, recomputes total", async () => {
    vi.mocked(prisma.saleLineItem.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.sale.update).mockResolvedValue(
      makeSale({ id: "sale-abc", total: 60000n, discount: 15000n }),
    );

    await updateSale(
      "sale-abc",
      validInput({
        lineItems: [{ itemDescription: "X", qty: 3, rate: 250 }],
        discount: 150,
      }),
    );

    // deleteMany should fire BEFORE update
    expect(prisma.saleLineItem.deleteMany).toHaveBeenCalledWith({
      where: { saleId: "sale-abc" },
    });
    expect(prisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sale-abc", deletedAt: null },
        data: expect.objectContaining({
          // 3 × 25000 - 15000 = 60000
          total: 60000n,
          discount: 15000n,
        }),
      }),
    );
    const updateCall = vi.mocked(prisma.sale.update).mock.calls[0][0];
    const created =
      (updateCall.data.lineItems as { create: Array<{ rate: bigint }> }).create;
    expect(created).toHaveLength(1);
    expect(created[0].rate).toBe(25000n);
  });

  it("re-snapshots customer when partyId changes during update", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(
      makeParty({ id: "cust-new", name: "Newly Linked", phone: "7777" }),
    );
    vi.mocked(prisma.saleLineItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.sale.update).mockResolvedValue(makeSale());

    await updateSale(
      "sale-abc",
      validInput({
        partyId: "cust-new",
        partyName: "form said this",
        partyPhone: "form said this phone",
      }),
    );

    const call = vi.mocked(prisma.sale.update).mock.calls[0][0];
    expect(call.data.partyName).toBe("Newly Linked");
    expect(call.data.partyPhone).toBe("7777");
  });

  it("rejects discount-exceeds-subtotal on update too", async () => {
    const result = await updateSale(
      "sale-abc",
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
    expect(prisma.sale.update).not.toHaveBeenCalled();
    expect(prisma.saleLineItem.deleteMany).not.toHaveBeenCalled();
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(updateSale("sale-abc", validInput())).rejects.toThrow(
      "Unauthorized",
    );
  });

  // Phase 21a Gate 2: atomicity rollback at the action layer.
  // When the ledger write inside the prisma.$transaction throws, the
  // whole transaction (including the parent sale mutation) must roll
  // back — the action propagates the error rather than returning
  // a partially-applied success.
  it("ATOMICITY — ledger.create throw inside $transaction propagates and rolls back parent", async () => {
    // Override the default $transaction mock to re-throw a callback's
    // error (the shared mock just returns the callback's resolved
    // value; we need it to surface throws as the real Prisma would).
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (arg) => {
      if (typeof arg === "function") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma as any);
      }
      throw new Error("unexpected $transaction args in test");
    });

    // Party-linked update path so the ledger write is invoked.
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce({
      partyId: "pre-existing-party",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    vi.mocked(prisma.party.findUnique).mockResolvedValueOnce(
      makeParty({ id: "pre-existing-party" }),
    );
    vi.mocked(prisma.saleLineItem.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.sale.update).mockResolvedValueOnce(
      makeSale({ id: "sale-abc", partyId: "pre-existing-party", total: 50000n }),
    );
    // Make the ledger write throw → simulates a DB-side ledger insert error.
    vi.mocked(prisma.ledgerEntry.create).mockRejectedValueOnce(
      new Error("ledger insert failed (deadlock / constraint)"),
    );

    // Action should reject — the $transaction rollback semantics mean
    // the parent sale.update is "undone" at the DB level. The test
    // mock doesn't simulate row-level rollback (no real DB) but the
    // important assertion is: the action does NOT return ok=true,
    // it propagates the error.
    await expect(
      updateSale("sale-abc", validInput({ partyId: "pre-existing-party" })),
    ).rejects.toThrow(/ledger insert failed/);
  });
});

describe("softDeleteSale", () => {
  it("happy path — Prisma update called with where.deletedAt=null + data.deletedAt=<Date>", async () => {
    vi.mocked(prisma.sale.update).mockResolvedValue(
      makeSale({ deletedAt: new Date() }),
    );

    const result = await softDeleteSale("sale-abc");

    expect(result.ok).toBe(true);
    expect(prisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sale-abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/sales");
  });

  it("deletedAt is a Date instance (not string/number)", async () => {
    vi.mocked(prisma.sale.update).mockResolvedValue(makeSale());

    await softDeleteSale("sale-abc");

    const call = vi.mocked(prisma.sale.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteSale("sale-abc")).rejects.toThrow("Unauthorized");

    expect(prisma.sale.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Phase 5 RBAC — parameterised role matrix.
// =====================================================================

const SALE_ROLE_MATRIX = [
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

describe.each(SALE_ROLE_MATRIX)("createSale role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());
      const r = await createSale(validInput());
      expect(r.ok).toBe(true);
      expect(prisma.sale.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createSale(validInput())).rejects.toThrow("Forbidden");
      expect(prisma.sale.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(SALE_ROLE_MATRIX)("updateSale role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.saleLineItem.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.sale.update).mockResolvedValue(makeSale());
      const r = await updateSale("sale-abc", validInput());
      expect(r.ok).toBe(true);
      expect(prisma.sale.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(updateSale("sale-abc", validInput())).rejects.toThrow("Forbidden");
      expect(prisma.sale.update).not.toHaveBeenCalled();
    }
  });
});

describe.each(SALE_ROLE_MATRIX)("softDeleteSale role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.sale.update).mockResolvedValue(makeSale({ deletedAt: new Date() }));
      const r = await softDeleteSale("sale-abc");
      expect(r.ok).toBe(true);
      expect(prisma.sale.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeleteSale("sale-abc")).rejects.toThrow("Forbidden");
      expect(prisma.sale.update).not.toHaveBeenCalled();
    }
  });
});

// =====================================================================
// Phase 6 — walk-in auto-promotion.
// =====================================================================

describe("createSale auto-promotion (Phase 6)", () => {
  it("walk-in + new phone → auto-creates customer and links the sale", async () => {
    vi.mocked(prisma.party.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.party.create).mockResolvedValue(
      makeParty({ id: "auto-cust-1", name: "New Walkin", phone: "9876500001" }),
    );
    vi.mocked(prisma.sale.create).mockResolvedValue(
      makeSale({ partyId: "auto-cust-1", partyName: "New Walkin", partyPhone: "9876500001" }),
    );

    const result = await createSale(
      validInput({ partyName: "New Walkin", partyPhone: "9876500001" }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.party.findFirst).toHaveBeenCalledWith({
      where: { phone: "9876500001", deletedAt: null },
    });
    expect(prisma.party.create).toHaveBeenCalledWith({
      data: {
        name: "New Walkin",
        phone: "9876500001",
        email: null,
        address: null,
        notes: null,
        isCustomer: true,
      },
    });
    const saleCall = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(saleCall.data.partyId).toBe("auto-cust-1");
    expect(saleCall.data.partyName).toBe("New Walkin");
    expect(saleCall.data.partyPhone).toBe("9876500001");
  });

  it("walk-in + existing phone → links to existing customer, no new customer created", async () => {
    vi.mocked(prisma.party.findFirst).mockResolvedValue(
      makeParty({ id: "existing-cust", name: "Canonical Name", phone: "9876500001" }),
    );
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    const result = await createSale(
      validInput({ partyName: "Whatever Typed", partyPhone: "9876500001" }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.party.findFirst).toHaveBeenCalledOnce();
    expect(prisma.party.create).not.toHaveBeenCalled();
    const saleCall = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(saleCall.data.partyId).toBe("existing-cust");
    expect(saleCall.data.partyName).toBe("Canonical Name");
    expect(saleCall.data.partyPhone).toBe("9876500001");
  });

  it("walk-in + existing phone, typed name differs → canonical name wins", async () => {
    vi.mocked(prisma.party.findFirst).mockResolvedValue(
      makeParty({ id: "c", name: "Real Customer", phone: "9876500001" }),
    );
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    await createSale(
      validInput({
        partyId: null,
        partyName: "TYPED — should be overridden",
        partyPhone: "9876500001",
      }),
    );

    const saleCall = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(saleCall.data.partyName).toBe("Real Customer");
    expect(saleCall.data.partyName).not.toBe("TYPED — should be overridden");
  });

  it("walk-in + null phone → stays snapshot-only, no customer touched", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    const result = await createSale(
      validInput({ partyName: "No Phone Walkin", partyPhone: null }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.party.findFirst).not.toHaveBeenCalled();
    expect(prisma.party.create).not.toHaveBeenCalled();
    const saleCall = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(saleCall.data.partyId).toBeNull();
    expect(saleCall.data.partyName).toBe("No Phone Walkin");
    expect(saleCall.data.partyPhone).toBeNull();
  });

  it("normalised phone — dashes/spaces in the input still match a clean stored phone", async () => {
    vi.mocked(prisma.party.findFirst).mockResolvedValue(
      makeParty({ id: "c", name: "Existing", phone: "9876500001" }),
    );
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    await createSale(
      validInput({ partyName: "Whatever", partyPhone: "9876-500-001" }),
    );

    expect(prisma.party.findFirst).toHaveBeenCalledWith({
      where: { phone: "9876500001", deletedAt: null },
    });
  });

  it("transaction atomicity — if customer.create throws, sale.create is never called", async () => {
    vi.mocked(prisma.party.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.party.create).mockRejectedValueOnce(
      new Error("DB constraint violation"),
    );

    await expect(
      createSale(validInput({ partyName: "X", partyPhone: "9876500001" })),
    ).rejects.toThrow();
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });
});
