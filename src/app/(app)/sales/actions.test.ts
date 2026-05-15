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

function makeSale(
  overrides: Partial<{
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
  }> = {},
) {
  return {
    id: "cuid-sale-test",
    date: new Date("2026-05-14T00:00:00Z"),
    customerId: null,
    partyName: "Test Walkin",
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

function makeCustomer(
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
    ...overrides,
  };
}

// Valid form-shape input — passes the schema. Rupee numbers, not paise.
// `date` is a Date instance (post-zodResolver coercion) — matches what the
// RHF `handleSubmit` actually hands the server action at runtime.
function validInput(overrides: Partial<ReturnType<typeof base>> = {}) {
  function base() {
    return {
      date: new Date("2026-05-14T00:00:00Z"),
      customerId: null as string | null,
      partyName: "Test Walkin",
      partyPhone: null as string | null,
      itemDescription: "Gold chain",
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

describe("createSale", () => {
  it("walk-in happy path — converts rupees to BigInt paise at Prisma boundary", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(
      makeSale({ total: 2400_00n, rate: 250_00n, discount: 100_00n, qty: 10 }),
    );

    await createSale(validInput());

    expect(prisma.sale.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    // BigInt paise conversion at the boundary
    expect(call.data.rate).toBe(25000n);
    expect(call.data.discount).toBe(10000n);
    expect(typeof call.data.rate).toBe("bigint");
    // total computed: 10 * 25000 - 10000 = 240000
    expect(call.data.total).toBe(240000n);
    expect(typeof call.data.total).toBe("bigint");
    expect(revalidatePath).toHaveBeenCalledWith("/sales");
  });

  it("walk-in happy path — passes through partyName/partyPhone from form input", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    await createSale(
      validInput({ partyName: "Walkin Bob", partyPhone: "1234567890" }),
    );

    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Walkin Bob");
    expect(call.data.partyPhone).toBe("1234567890");
    expect(call.data.customerId).toBeNull();
  });

  it("linked-customer happy path — snapshots partyName/partyPhone from Customer row, ignoring form values", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(
      makeCustomer({ id: "cust-real", name: "Real Customer Name", phone: "8888888888" }),
    );
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    await createSale(
      validInput({
        customerId: "cust-real",
        partyName: "FORM TYPED THIS — should be ignored",
        partyPhone: "0000000000",
      }),
    );

    // Server queried the customer with deletedAt:null guard
    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { id: "cust-real", deletedAt: null },
    });
    // The Prisma create call should have snapshot values, not the form-typed ones
    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    expect(call.data.partyName).toBe("Real Customer Name");
    expect(call.data.partyPhone).toBe("8888888888");
    expect(call.data.customerId).toBe("cust-real");
  });

  it("returns customerId error when the customer is not found", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);

    const result = await createSale(
      validInput({ customerId: "nonexistent" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.customerId).toContain("Customer not found");
    }
    expect(prisma.sale.create).not.toHaveBeenCalled();
  });

  it("treats a soft-deleted customer as not found (deletedAt:null guard)", async () => {
    // Mock returns null because the WHERE clause filters out deletedAt != null.
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(null);

    const result = await createSale(
      validInput({ customerId: "soft-deleted-id" }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.customerId).toContain("Customer not found");
    }
  });

  it("rejects when discount exceeds qty × rate (action-layer guard)", async () => {
    // qty=2, rate=100 → 200; discount=500 → total = 20000 - 50000 = -30000 paise
    const result = await createSale(
      validInput({ qty: 2, rate: 100, discount: 500 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.discount).toContain(
        "Discount cannot exceed line total",
      );
    }
    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("computes total in BigInt paise (no float math)", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(makeSale());

    // 3 × 99.99 - 9.99 = 299.97 - 9.99 = 289.98 → 28998 paise
    await createSale(
      validInput({ qty: 3, rate: 99.99, discount: 9.99 }),
    );

    const call = vi.mocked(prisma.sale.create).mock.calls[0][0];
    // 3 * 9999 - 999 = 29997 - 999 = 28998
    expect(call.data.total).toBe(28998n);
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
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it("returned sale.rate, discount, total are Number (paise), not BigInt", async () => {
    vi.mocked(prisma.sale.create).mockResolvedValue(
      makeSale({ rate: 25000n, discount: 10000n, total: 240000n }),
    );

    const result = await createSale(validInput());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.sale.rate).toBe("number");
      expect(typeof result.sale.discount).toBe("number");
      expect(typeof result.sale.total).toBe("number");
      expect(result.sale.total).toBe(240000);
      // Phase 3.1 — status always "pending" until payments + returns land
      expect(result.sale.status).toBe("pending");
    }
  });

  it("propagates auth failure (requireRole throws)", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(createSale(validInput())).rejects.toThrow("Unauthorized");

    expect(prisma.sale.create).not.toHaveBeenCalled();
  });
});

describe("updateSale", () => {
  it("happy path — Prisma update called with where.deletedAt=null + recomputed total", async () => {
    vi.mocked(prisma.sale.update).mockResolvedValue(
      makeSale({ id: "sale-abc", total: 600_00n }),
    );

    await updateSale(
      "sale-abc",
      validInput({ qty: 3, rate: 250, discount: 150 }),
    );

    expect(prisma.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sale-abc", deletedAt: null },
        data: expect.objectContaining({
          // 3 × 25000 - 15000 = 60000
          total: 60000n,
          rate: 25000n,
          discount: 15000n,
        }),
      }),
    );
  });

  it("re-snapshots customer when customerId changes during update", async () => {
    vi.mocked(prisma.customer.findUnique).mockResolvedValue(
      makeCustomer({ id: "cust-new", name: "Newly Linked", phone: "7777" }),
    );
    vi.mocked(prisma.sale.update).mockResolvedValue(makeSale());

    await updateSale(
      "sale-abc",
      validInput({
        customerId: "cust-new",
        partyName: "form said this",
        partyPhone: "form said this phone",
      }),
    );

    const call = vi.mocked(prisma.sale.update).mock.calls[0][0];
    expect(call.data.partyName).toBe("Newly Linked");
    expect(call.data.partyPhone).toBe("7777");
  });

  it("rejects discount-exceeds-total on update too", async () => {
    const result = await updateSale(
      "sale-abc",
      validInput({ qty: 1, rate: 100, discount: 200 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.discount).toContain(
        "Discount cannot exceed line total",
      );
    }
    expect(prisma.sale.update).not.toHaveBeenCalled();
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(updateSale("sale-abc", validInput())).rejects.toThrow(
      "Unauthorized",
    );
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
// Sales are ADMIN-only. 3 actions × 4 roles = 12 tests.
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
