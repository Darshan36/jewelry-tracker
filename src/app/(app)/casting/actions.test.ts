// Action tests for the Casting entry flow. Mocks Prisma, the auth
// guards, and next/cache. Verifies the Decimal × BigInt math via the
// real weight-helpers module (pure function, no need to mock).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guards";
import { revalidatePath } from "next/cache";
import type { Role } from "@/generated/prisma";

import {
  attachAttachmentToCastingEntry,
  createCastingEntry,
  detachAttachmentFromCastingEntry,
  softDeleteCastingEntry,
  updateCastingEntry,
} from "./actions";

// ---------- helpers ----------

function sessionFor(role: Role) {
  return {
    user: { id: "user-1", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
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
    id: "vendor-1",
    name: "Mahesh Casting Works",
    phone: "9876543210",
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
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

function makeEntry(
  overrides: Partial<{
    id: string;
    partyId: string | null;
    partyName: string;
    partyPhone: string | null;
    total: bigint;
    discount: bigint;
    attachmentId: string | null;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "entry-1",
    date: new Date("2026-05-17T00:00:00Z"),
    partyId: "vendor-1",
    partyName: "Mahesh Casting Works",
    partyPhone: "9876543210",
    discount: 10000n, // ₹100
    total: 155625n, // ₹1,556.25
    notes: null,
    attachmentId: null,
    createdAt: new Date("2026-05-17T00:00:00Z"),
    updatedAt: new Date("2026-05-17T00:00:00Z"),
    deletedAt: null,
    lineItems: [],
    payments: [],
    party: null,
    bill: null,
    ...overrides,
  };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    date: new Date("2026-05-17T00:00:00Z"),
    partyId: "vendor-1",
    partyName: "Mahesh Casting Works",
    partyPhone: "9876543210",
    lineItems: [
      { materialDescription: "Brass", weightKg: 2.5, ratePerKg: 400 },
    ],
    discount: 0,
    attachmentId: null,
    notes: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(sessionFor("ADMIN"));
  vi.mocked(revalidatePath).mockClear();
  // Phase 21a: updateX/softDeleteX pre-fetch existing.partyId — default
  // walk-in so existing tests pass.
  vi.mocked(prisma.castingEntry.findUnique).mockResolvedValue({
    partyId: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  vi.mocked(prisma.castingPayment.findMany).mockResolvedValue([]);
});

// =====================================================================
// createCastingEntry — happy paths + Decimal math
// =====================================================================

describe("createCastingEntry — happy path with vendor link", () => {
  it("creates an entry with the linked vendor's canonical name/phone (override typed input)", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(
      makeParty({ id: "vendor-1", name: "Canonical Vendor Name", phone: "9000000001" }),
    );
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(
      makeEntry({ id: "new-entry" }),
    );

    const result = await createCastingEntry(
      validInput({
        partyName: "TYPED Name — should be overridden",
        partyPhone: "1234567890",
      }),
    );

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.castingEntry.create).mock.calls[0][0];
    // Canonical snapshot used, typed input NOT used.
    expect(call.data.partyName).toBe("Canonical Vendor Name");
    expect(call.data.partyName).not.toBe("TYPED Name — should be overridden");
    expect(call.data.partyPhone).toBe("9000000001");
    expect(revalidatePath).toHaveBeenCalledWith("/casting");
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("stores discount and total in BigInt paise (₹100 discount → 10000n)", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(makeEntry());

    await createCastingEntry(validInput({ discount: 100 }));

    const call = vi.mocked(prisma.castingEntry.create).mock.calls[0][0];
    expect(call.data.discount).toBe(10000n);
    // Total = 100000 (brass 2.5kg×₹400) − 10000 (discount) = 90000
    expect(call.data.total).toBe(90000n);
  });

  it("CRITICAL: computes line totals via computeLineTotal — 1.875 × ₹350 = 65625 paise", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(makeEntry());

    await createCastingEntry(
      validInput({
        lineItems: [
          { materialDescription: "Aluminium", weightKg: 1.875, ratePerKg: 350 },
        ],
      }),
    );

    const call = vi.mocked(prisma.castingEntry.create).mock.calls[0][0];
    // `lineItems.create` is typed as a union (single-or-array) — narrow
    // via an explicit array cast for indexing.
    const lineCreates = (
      call.data.lineItems as {
        create: Array<{ weightKg: string; ratePerKg: bigint; lineTotal: bigint }>;
      }
    ).create;
    expect(lineCreates[0].lineTotal).toBe(65625n);
    expect(lineCreates[0].ratePerKg).toBe(35000n);
    expect(lineCreates[0].weightKg).toBe("1.875");
  });

  it("sums line totals across multi-line entries before applying discount", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(makeEntry());

    await createCastingEntry(
      validInput({
        discount: 100,
        lineItems: [
          { materialDescription: "Brass", weightKg: 2.5, ratePerKg: 400 },
          { materialDescription: "Aluminium", weightKg: 1.875, ratePerKg: 350 },
        ],
      }),
    );

    const call = vi.mocked(prisma.castingEntry.create).mock.calls[0][0];
    // Line 1 total = 100000, Line 2 total = 65625. Subtotal = 165625.
    // Discount 100 = 10000 paise. Final = 155625.
    expect(call.data.total).toBe(155625n);
  });

  it("rejects when discount exceeds subtotal", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());

    const result = await createCastingEntry(
      validInput({ discount: 5000 }), // line subtotal is ₹1,000
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.discount).toBeDefined();
    expect(prisma.castingEntry.create).not.toHaveBeenCalled();
  });
});

describe("createCastingEntry — vendor auto-promotion (Phase 6 pattern)", () => {
  it("walk-in WITH phone matching an existing vendor → links to that vendor", async () => {
    vi.mocked(prisma.party.findFirst).mockResolvedValue(
      makeParty({ id: "vendor-existing", name: "Canonical", phone: "9876511002" }),
    );
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(
      makeEntry({ partyId: "vendor-existing" }),
    );

    await createCastingEntry(
      validInput({
        partyId: null,
        partyName: "Typed name — overridden",
        partyPhone: "9876511002",
      }),
    );

    expect(prisma.party.create).not.toHaveBeenCalled();
    const call = vi.mocked(prisma.castingEntry.create).mock.calls[0][0];
    expect(call.data.partyId).toBe("vendor-existing");
    expect(call.data.partyName).toBe("Canonical");
    expect(call.data.partyName).not.toBe("Typed name — overridden");
  });

  it("walk-in WITH phone not matching any vendor → auto-creates a new vendor", async () => {
    vi.mocked(prisma.party.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.party.create).mockResolvedValue(
      makeParty({ id: "vendor-new", name: "Fresh Walk-in", phone: "9876511003" }),
    );
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(
      makeEntry({ partyId: "vendor-new" }),
    );

    await createCastingEntry(
      validInput({
        partyId: null,
        partyName: "Fresh Walk-in",
        partyPhone: "9876511003",
      }),
    );

    expect(prisma.party.create).toHaveBeenCalledOnce();
    const vendorCreateCall = vi.mocked(prisma.party.create).mock.calls[0][0];
    expect(vendorCreateCall.data.name).toBe("Fresh Walk-in");
    expect(vendorCreateCall.data.phone).toBe("9876511003");
  });

  it("walk-in WITHOUT phone → stays snapshot-only (no vendor lookup/create)", async () => {
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(
      makeEntry({ partyId: null }),
    );

    await createCastingEntry(
      validInput({
        partyId: null,
        partyName: "One-time walk-in",
        partyPhone: "",
      }),
    );

    expect(prisma.party.findFirst).not.toHaveBeenCalled();
    expect(prisma.party.create).not.toHaveBeenCalled();
    const call = vi.mocked(prisma.castingEntry.create).mock.calls[0][0];
    expect(call.data.partyId).toBeNull();
    expect(call.data.partyName).toBe("One-time walk-in");
  });

  it("vendor-id supplied but row is missing/soft-deleted → returns ok=false", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(null);

    const result = await createCastingEntry(validInput());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.partyId).toBeDefined();
    expect(prisma.castingEntry.create).not.toHaveBeenCalled();
  });
});

describe("createCastingEntry — billId validation", () => {
  it("rejects when billId references a non-existent / non-READY / soft-deleted bill", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(null);

    const result = await createCastingEntry(validInput({ attachmentId: "missing-bill" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.attachmentId).toBeDefined();
    expect(prisma.castingEntry.create).not.toHaveBeenCalled();
  });

  it("rejects a billId pointing at a FAILED bill", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue({
      id: "bill-1",
      r2Key: "bills/2026/05/x",
      mimeType: "image/png",
      sizeBytes: 70,
      originalFilename: "x.png",
      uploadedById: "user-1",
      attachedToType: "CASTING_ENTRY",
      attachedToId: null,
      status: "FAILED",
      uploadedAt: new Date(),
      confirmedAt: null,
      deletedAt: null,
    });

    const result = await createCastingEntry(validInput({ attachmentId: "bill-1" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.attachmentId).toBeDefined();
  });

  it("accepts a billId pointing at a READY non-deleted bill", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue({
      id: "bill-1",
      r2Key: "bills/2026/05/x",
      mimeType: "image/png",
      sizeBytes: 70,
      originalFilename: "x.png",
      uploadedById: "user-1",
      attachedToType: "CASTING_ENTRY",
      attachedToId: null,
      status: "READY",
      uploadedAt: new Date(),
      confirmedAt: new Date(),
      deletedAt: null,
    });
    vi.mocked(prisma.castingEntry.create).mockResolvedValue(makeEntry({ attachmentId: "bill-1" }));

    const result = await createCastingEntry(validInput({ attachmentId: "bill-1" }));

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.castingEntry.create).mock.calls[0][0];
    expect(call.data.attachmentId).toBe("bill-1");
  });
});

// =====================================================================
// updateCastingEntry — replace-all line items + recompute total
// =====================================================================

describe("updateCastingEntry", () => {
  it("happy path — deleteMany line items then recreate, then update entry", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.castingLineItem.deleteMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.castingEntry.update).mockResolvedValue(makeEntry({ id: "abc" }));

    const result = await updateCastingEntry("abc", validInput());

    expect(result.ok).toBe(true);
    expect(prisma.castingLineItem.deleteMany).toHaveBeenCalledWith({
      where: { castingEntryId: "abc" },
    });
    expect(prisma.castingEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/casting");
  });

  it("recomputes total after line items change", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
    vi.mocked(prisma.castingLineItem.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.castingEntry.update).mockResolvedValue(makeEntry({ id: "abc" }));

    await updateCastingEntry(
      "abc",
      validInput({
        lineItems: [
          { materialDescription: "Brass", weightKg: 5, ratePerKg: 400 },
        ],
      }),
    );

    const call = vi.mocked(prisma.castingEntry.update).mock.calls[0][0];
    expect(call.data.total).toBe(200000n); // 5 kg × ₹400 = ₹2000
  });

  it("rejects when discount exceeds subtotal", async () => {
    vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());

    const result = await updateCastingEntry(
      "abc",
      validInput({ discount: 99999 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.discount).toBeDefined();
    expect(prisma.castingEntry.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// softDeleteCastingEntry
// =====================================================================

describe("softDeleteCastingEntry", () => {
  it("sets deletedAt and revalidates", async () => {
    vi.mocked(prisma.castingEntry.update).mockResolvedValue(
      makeEntry({ deletedAt: new Date() }),
    );

    const result = await softDeleteCastingEntry("abc");

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.castingEntry.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "abc", deletedAt: null });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/casting");
  });

  // Phase 21a cascade fix — Casting has no *Return table, only
  // *Payment children to cascade.
  it("CASCADE — walk-in soft-delete propagates to active CastingPayment children", async () => {
    vi.mocked(prisma.castingEntry.update).mockResolvedValue(
      makeEntry({ deletedAt: new Date() }),
    );

    await softDeleteCastingEntry("walk-ce-1");

    expect(prisma.castingPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { castingEntryId: "walk-ce-1", deletedAt: null },
      }),
    );
    expect(
      vi.mocked(prisma.castingPayment.updateMany).mock.calls[0][0].data.deletedAt,
    ).toBeInstanceOf(Date);
  });
});

// =====================================================================
// attachAttachmentToCastingEntry / detachAttachmentFromCastingEntry
// =====================================================================

describe("attachBillToCastingEntry", () => {
  it("sets billId on the entry", async () => {
    vi.mocked(prisma.castingEntry.update).mockResolvedValue(makeEntry({ attachmentId: "bill-x" }));

    const result = await attachAttachmentToCastingEntry("entry-1", "bill-x");

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.castingEntry.update).mock.calls[0][0];
    expect(call.data.attachmentId).toBe("bill-x");
    expect(revalidatePath).toHaveBeenCalledWith("/casting");
  });
});

describe("detachBillFromCastingEntry", () => {
  it("clears billId on the entry", async () => {
    vi.mocked(prisma.castingEntry.update).mockResolvedValue(makeEntry({ attachmentId: null }));

    const result = await detachAttachmentFromCastingEntry("entry-1");

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.castingEntry.update).mock.calls[0][0];
    expect(call.data.attachmentId).toBeNull();
  });
});

// =====================================================================
// Role matrix
// =====================================================================

const ROLE_MATRIX = [
  ["ADMIN", true],
  ["CASTING_PLATING_MGMT", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", false],
] as const;

describe.each(ROLE_MATRIX)("createCastingEntry role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
      vi.mocked(prisma.castingEntry.create).mockResolvedValue(makeEntry());
      const r = await createCastingEntry(validInput());
      expect(r.ok).toBe(true);
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createCastingEntry(validInput())).rejects.toThrow("Forbidden");
      expect(prisma.castingEntry.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("updateCastingEntry role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.party.findUnique).mockResolvedValue(makeParty());
      vi.mocked(prisma.castingLineItem.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.castingEntry.update).mockResolvedValue(makeEntry());
      const r = await updateCastingEntry("abc", validInput());
      expect(r.ok).toBe(true);
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(updateCastingEntry("abc", validInput())).rejects.toThrow("Forbidden");
      expect(prisma.castingEntry.update).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("softDeleteCastingEntry role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.castingEntry.update).mockResolvedValue(makeEntry());
      const r = await softDeleteCastingEntry("abc");
      expect(r.ok).toBe(true);
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeleteCastingEntry("abc")).rejects.toThrow("Forbidden");
      expect(prisma.castingEntry.update).not.toHaveBeenCalled();
    }
  });
});
