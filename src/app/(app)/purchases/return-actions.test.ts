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
  createPurchaseReturn,
  softDeletePurchaseReturn,
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

type RawPurchase = {
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

type RawLineItem = {
  id: string;
  purchaseId: string;
  itemDescription: string;
  qty: number;
  rate: bigint;
  createdAt: Date;
};

function makeLineItem(overrides: Partial<RawLineItem> = {}): RawLineItem {
  return {
    id: "line-1",
    purchaseId: "cuid-purchase-test",
    itemDescription: "Test item",
    qty: 10,
    rate: 25000n,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    ...overrides,
  };
}

// Phase 7: the cumulative-qty guard reads `purchase.lineItems` (sum of qty
// across line items). Default fixture: one line with qty=10.
function makePurchaseRow(
  overrides: Partial<RawPurchase> = {},
  returns: RawReturn[] = [],
  lineItems: RawLineItem[] = [makeLineItem()],
): RawPurchase & { returns: RawReturn[]; lineItems: RawLineItem[] } {
  return {
    id: "cuid-purchase-test",
    date: new Date("2026-05-14T00:00:00Z"),
    partyId: null,
    partyName: "Test Walkin Vendor",
    partyPhone: null,
    discount: 10000n,
    total: 240000n,
    notes: null,
    createdAt: new Date("2026-05-14T12:00:00Z"),
    updatedAt: new Date("2026-05-14T12:00:00Z"),
    deletedAt: null,
    ...overrides,
    returns,
    lineItems,
  };
}

function makeReturnRow(overrides: Partial<RawReturn> = {}): RawReturn {
  return {
    id: "cuid-ret-default",
    purchaseId: "cuid-purchase-test",
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
      purchaseId: "cuid-purchase-test",
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

describe("createPurchaseReturn", () => {
  it("happy path — converts refundAmount rupees to BigInt paise at Prisma boundary", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());
    vi.mocked(prisma.purchaseReturn.create).mockResolvedValue(
      makeReturnRow({ qtyReturned: 2, refundAmount: 40000n }),
    );

    await createPurchaseReturn(validInput({ qtyReturned: 2, refundAmount: 400 }));

    expect(prisma.purchaseReturn.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.purchaseReturn.create).mock.calls[0][0];
    expect(call.data.qtyReturned).toBe(2);
    expect(call.data.refundAmount).toBe(40000n);
    expect(typeof call.data.refundAmount).toBe("bigint");
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("rejects single return where qtyReturned > purchase.qty", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());

    const result = await createPurchaseReturn(validInput({ qtyReturned: 11 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.qtyReturned).toBeDefined();
      const msg = result.errors.qtyReturned?.[0] ?? "";
      expect(msg).toContain("Cannot return more than the original quantity");
      expect(msg).toContain("Already returned: 0 of 10");
    }
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it("aggregates existing returned qty for the cumulative check", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [
        makeReturnRow({ id: "r1", qtyReturned: 3 }),
        makeReturnRow({ id: "r2", qtyReturned: 4 }),
      ]),
    );

    const result = await createPurchaseReturn(validInput({ qtyReturned: 4 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.qtyReturned?.[0]).toContain("Already returned: 7 of 10");
    }
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it("accepts return that exactly hits the cumulative qty boundary", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [makeReturnRow({ id: "r1", qtyReturned: 7 })]),
    );
    vi.mocked(prisma.purchaseReturn.create).mockResolvedValue(
      makeReturnRow({ qtyReturned: 3 }),
    );

    const result = await createPurchaseReturn(
      validInput({ qtyReturned: 3, refundAmount: 100 }),
    );

    expect(result.ok).toBe(true);
    expect(prisma.purchaseReturn.create).toHaveBeenCalledOnce();
  });

  it("rejects refundAmount > purchase.total - existingReturnTotal", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow({}, [
        makeReturnRow({ id: "r1", qtyReturned: 1, refundAmount: 100000n }),
      ]),
    );

    const result = await createPurchaseReturn(
      validInput({ qtyReturned: 1, refundAmount: 2000 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.refundAmount).toBeDefined();
      const msg = result.errors.refundAmount?.[0] ?? "";
      expect(msg).toContain("Refund exceeds remaining returnable value");
      expect(msg).toMatch(/₹\s*1,400\.00/);
    }
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it("rejects when purchase is not found", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(null);

    const result = await createPurchaseReturn(
      validInput({ purchaseId: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.purchaseId).toContain("Purchase not found");
    }
  });

  it("treats a soft-deleted purchase as not found (deletedAt:null guard)", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(null);

    const result = await createPurchaseReturn(
      validInput({ purchaseId: "soft-deleted-id" }),
    );

    expect(result.ok).toBe(false);
    const call = vi.mocked(prisma.purchase.findUnique).mock.calls[0][0];
    expect(call.where).toEqual({
      id: "soft-deleted-id",
      deletedAt: null,
    });
  });

  it("schema rejection (negative qty) without touching DB", async () => {
    const result = await createPurchaseReturn(validInput({ qtyReturned: -1 }));

    expect(result.ok).toBe(false);
    expect(prisma.purchase.findUnique).not.toHaveBeenCalled();
    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });

  it("returned return.refundAmount is Number (paise), not BigInt", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());
    vi.mocked(prisma.purchaseReturn.create).mockResolvedValue(
      makeReturnRow({ refundAmount: 40000n }),
    );

    const result = await createPurchaseReturn(
      validInput({ qtyReturned: 1, refundAmount: 400 }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.return.refundAmount).toBe("number");
      expect(result.return.refundAmount).toBe(40000);
    }
  });

  it("Phase 7 — cumulative qty guard sums across multiple line items", async () => {
    // Two lines qty 6+4=10 total. Existing returns 7. Request 4 → 11 > 10 → reject.
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      makePurchaseRow(
        {},
        [makeReturnRow({ id: "r1", qtyReturned: 7 })],
        [
          makeLineItem({ id: "l1", qty: 6 }),
          makeLineItem({ id: "l2", qty: 4 }),
        ],
      ),
    );

    const result = await createPurchaseReturn(validInput({ qtyReturned: 4 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.qtyReturned?.[0]).toContain("Already returned: 7 of 10");
    }
  });

  it("includes returns+lineItems on the lookup query (Phase 7)", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());
    vi.mocked(prisma.purchaseReturn.create).mockResolvedValue(makeReturnRow());

    await createPurchaseReturn(validInput());

    const call = vi.mocked(prisma.purchase.findUnique).mock.calls[0][0];
    expect(call.include).toEqual({
      returns: { where: { deletedAt: null } },
      lineItems: true,
    });
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createPurchaseReturn(validInput())).rejects.toThrow("Unauthorized");

    expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
  });
});

describe("softDeletePurchaseReturn", () => {
  it("happy path — Prisma update with where.deletedAt:null + data.deletedAt:<Date>", async () => {
    vi.mocked(prisma.purchaseReturn.update).mockResolvedValue(
      makeReturnRow({ deletedAt: new Date() }),
    );

    const result = await softDeletePurchaseReturn("cuid-ret-1");

    expect(result.ok).toBe(true);
    expect(prisma.purchaseReturn.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cuid-ret-1", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/purchases");
  });

  it("deletedAt set on update is a Date instance", async () => {
    vi.mocked(prisma.purchaseReturn.update).mockResolvedValue(makeReturnRow());

    await softDeletePurchaseReturn("cuid-ret-1");

    const call = vi.mocked(prisma.purchaseReturn.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeletePurchaseReturn("cuid-ret-1")).rejects.toThrow(
      "Unauthorized",
    );

    expect(prisma.purchaseReturn.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Phase 5 RBAC — parameterised role matrix.
// PurchaseReturn: ADMIN and PURCHASE_DEPT allowed; LABOUR_MGMT and
// CASTING_PLATING_MGMT rejected at the guard.
// 2 actions × 4 roles = 8 tests.
// =====================================================================

const PURCHASE_RETURN_ROLE_MATRIX = [
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

describe.each(PURCHASE_RETURN_ROLE_MATRIX)("createPurchaseReturn role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.purchase.findUnique).mockResolvedValue(makePurchaseRow());
      vi.mocked(prisma.purchaseReturn.create).mockResolvedValue(makeReturnRow());
      const r = await createPurchaseReturn(validInput());
      expect(r.ok).toBe(true);
      expect(prisma.purchaseReturn.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createPurchaseReturn(validInput())).rejects.toThrow("Forbidden");
      expect(prisma.purchaseReturn.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(PURCHASE_RETURN_ROLE_MATRIX)("softDeletePurchaseReturn role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.purchaseReturn.update).mockResolvedValue(
        makeReturnRow({ deletedAt: new Date() }),
      );
      const r = await softDeletePurchaseReturn("cuid-ret-1");
      expect(r.ok).toBe(true);
      expect(prisma.purchaseReturn.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeletePurchaseReturn("cuid-ret-1")).rejects.toThrow("Forbidden");
      expect(prisma.purchaseReturn.update).not.toHaveBeenCalled();
    }
  });
});
