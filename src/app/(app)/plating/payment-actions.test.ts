import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guards";
import type { PlatingPayment, Role } from "@/generated/prisma";

import {
  createPlatingPayment,
  softDeletePlatingPayment,
} from "./payment-actions";

function sessionFor(role: Role) {
  return {
    user: { id: "user-1", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

function makeEntry(
  total: bigint,
  payments: Array<{ amount: bigint; type: "PAYMENT" | "REFUND" }> = [],
) {
  return {
    id: "entry-1",
    date: new Date("2026-05-17T00:00:00Z"),
    vendorId: null,
    partyName: "Mahesh",
    partyPhone: null,
    discount: 0n,
    total,
    notes: null,
    billId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    payments: payments.map((p, i) => ({
      id: `payment-${i}`,
      platingEntryId: "entry-1",
      date: new Date(),
      amount: p.amount,
      type: p.type,
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    })),
  };
}

function validPayment(overrides: Record<string, unknown> = {}) {
  return {
    platingEntryId: "entry-1",
    date: new Date("2026-05-17T00:00:00Z"),
    amount: 1000, // ₹1,000 → 100000 paise
    type: "PAYMENT" as const,
    note: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(sessionFor("ADMIN"));
});

describe("createPlatingPayment — PAYMENT happy path", () => {
  it("inserts a payment in BigInt paise (₹1,000 → 100000n)", async () => {
    // Entry total ₹2,000, no prior payments.
    vi.mocked(prisma.platingEntry.findUnique)
      .mockResolvedValueOnce(makeEntry(200000n))
      .mockResolvedValueOnce({
        ...makeEntry(200000n),
        lineItems: [],
        vendor: null,
        bill: null,
            } as unknown as Awaited<ReturnType<typeof prisma.platingEntry.findUnique>>);
    vi.mocked(prisma.platingPayment.create).mockResolvedValue({
      id: "payment-new",
    } as unknown as PlatingPayment);

    const result = await createPlatingPayment(validPayment());

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.platingPayment.create).mock.calls[0][0];
    expect(call.data.amount).toBe(100000n);
    expect(call.data.type).toBe("PAYMENT");
  });

  it("rejects PAYMENT exceeding remaining balance with formatted error", async () => {
    // Entry total ₹2,000 with ₹1,500 already paid. Remaining ₹500.
    vi.mocked(prisma.platingEntry.findUnique).mockResolvedValueOnce(
      makeEntry(200000n, [{ amount: 150000n, type: "PAYMENT" }]),
    );

    const result = await createPlatingPayment(validPayment({ amount: 1000 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount?.[0]).toMatch(/Owed to vendor: ₹500\.00/);
    }
    expect(prisma.platingPayment.create).not.toHaveBeenCalled();
  });

  it("accepts a PAYMENT exactly equal to the remaining balance (boundary)", async () => {
    vi.mocked(prisma.platingEntry.findUnique)
      .mockResolvedValueOnce(makeEntry(100000n))
      .mockResolvedValueOnce({
        ...makeEntry(100000n),
        lineItems: [],
        vendor: null,
        bill: null,
            } as unknown as Awaited<ReturnType<typeof prisma.platingEntry.findUnique>>);
    vi.mocked(prisma.platingPayment.create).mockResolvedValue({
      id: "payment-new",
    } as unknown as PlatingPayment);

    const result = await createPlatingPayment(validPayment({ amount: 1000 }));

    expect(result.ok).toBe(true);
  });

  it("returns ok=false when the parent entry does not exist", async () => {
    vi.mocked(prisma.platingEntry.findUnique).mockResolvedValueOnce(null);

    const result = await createPlatingPayment(validPayment());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.platingEntryId).toBeDefined();
  });
});

describe("createPlatingPayment — REFUND handling", () => {
  it("accepts a REFUND up to the net paid amount", async () => {
    // Entry total ₹2,000 with ₹1,500 paid. Net paid 150000n. Refund 500.
    vi.mocked(prisma.platingEntry.findUnique)
      .mockResolvedValueOnce(makeEntry(200000n, [{ amount: 150000n, type: "PAYMENT" }]))
      .mockResolvedValueOnce({
        ...makeEntry(200000n, [{ amount: 150000n, type: "PAYMENT" }]),
        lineItems: [],
        vendor: null,
        bill: null,
            } as unknown as Awaited<ReturnType<typeof prisma.platingEntry.findUnique>>);
    vi.mocked(prisma.platingPayment.create).mockResolvedValue({
      id: "payment-new",
    } as unknown as PlatingPayment);

    const result = await createPlatingPayment(validPayment({ amount: 500, type: "REFUND" }));

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.platingPayment.create).mock.calls[0][0];
    expect(call.data.type).toBe("REFUND");
  });

  it("rejects a REFUND exceeding the net paid amount", async () => {
    vi.mocked(prisma.platingEntry.findUnique).mockResolvedValueOnce(
      makeEntry(200000n, [{ amount: 100000n, type: "PAYMENT" }]),
    );

    const result = await createPlatingPayment(validPayment({ amount: 1500, type: "REFUND" }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount?.[0]).toMatch(/Refund exceeds amount paid. Maximum: ₹1,?000\.00/);
    }
  });

  it("net paid is PAYMENT minus REFUND — previous refunds reduce headroom", async () => {
    // ₹1,500 paid then ₹500 refunded. Net = ₹1,000.
    // New refund of ₹1,001 should be rejected.
    vi.mocked(prisma.platingEntry.findUnique).mockResolvedValueOnce(
      makeEntry(200000n, [
        { amount: 150000n, type: "PAYMENT" },
        { amount: 50000n, type: "REFUND" },
      ]),
    );

    const result = await createPlatingPayment(validPayment({ amount: 1001, type: "REFUND" }));

    expect(result.ok).toBe(false);
  });
});

describe("softDeletePlatingPayment", () => {
  it("sets deletedAt and returns the parent platingEntryId", async () => {
    vi.mocked(prisma.platingPayment.update).mockResolvedValue({
      id: "payment-1",
      platingEntryId: "entry-1",
    } as unknown as PlatingPayment);

    const result = await softDeletePlatingPayment("payment-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.platingEntryId).toBe("entry-1");
    const call = vi.mocked(prisma.platingPayment.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "payment-1", deletedAt: null });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });
});

// Role matrix on the payment action.
const ROLE_MATRIX = [
  ["ADMIN", true],
  ["CASTING_PLATING_MGMT", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", false],
] as const;

describe.each(ROLE_MATRIX)(
  "createPlatingPayment role access — %s",
  (role, allowed) => {
    it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
      if (allowed) {
        vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
        vi.mocked(prisma.platingEntry.findUnique)
          .mockResolvedValueOnce(makeEntry(200000n))
          .mockResolvedValueOnce({
        ...makeEntry(200000n),
            lineItems: [],
            vendor: null,
            bill: null,
                } as unknown as Awaited<ReturnType<typeof prisma.platingEntry.findUnique>>);
        vi.mocked(prisma.platingPayment.create).mockResolvedValue({
          id: "payment-new",
        } as unknown as PlatingPayment);
        const r = await createPlatingPayment(validPayment());
        expect(r.ok).toBe(true);
      } else {
        vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
        await expect(createPlatingPayment(validPayment())).rejects.toThrow("Forbidden");
        expect(prisma.platingPayment.create).not.toHaveBeenCalled();
      }
    });
  },
);
