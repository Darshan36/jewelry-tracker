// Action tests for the Plating entry flow. Mocks Prisma, the auth
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
  attachAttachmentToPlatingEntry,
  createPlatingEntry,
  detachAttachmentFromPlatingEntry,
  softDeletePlatingEntry,
  updatePlatingEntry,
} from "./actions";

// ---------- helpers ----------

function sessionFor(role: Role) {
  return {
    user: { id: "user-1", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

function makeVendor(
  overrides: Partial<{
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "vendor-1",
    name: "Mahesh Plating Works",
    phone: "9876543210",
    address: null,
    notes: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<{
    id: string;
    vendorId: string | null;
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
    vendorId: "vendor-1",
    partyName: "Mahesh Plating Works",
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
    vendor: null,
    bill: null,
    ...overrides,
  };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    date: new Date("2026-05-17T00:00:00Z"),
    vendorId: "vendor-1",
    partyName: "Mahesh Plating Works",
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
});

// =====================================================================
// createPlatingEntry — happy paths + Decimal math
// =====================================================================

describe("createPlatingEntry — happy path with vendor link", () => {
  it("creates an entry with the linked vendor's canonical name/phone (override typed input)", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(
      makeVendor({ id: "vendor-1", name: "Canonical Vendor Name", phone: "9000000001" }),
    );
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(
      makeEntry({ id: "new-entry" }),
    );

    const result = await createPlatingEntry(
      validInput({
        partyName: "TYPED Name — should be overridden",
        partyPhone: "1234567890",
      }),
    );

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.platingEntry.create).mock.calls[0][0];
    // Canonical snapshot used, typed input NOT used.
    expect(call.data.partyName).toBe("Canonical Vendor Name");
    expect(call.data.partyName).not.toBe("TYPED Name — should be overridden");
    expect(call.data.partyPhone).toBe("9000000001");
    expect(revalidatePath).toHaveBeenCalledWith("/plating");
    expect(revalidatePath).toHaveBeenCalledWith("/vendors");
  });

  it("stores discount and total in BigInt paise (₹100 discount → 10000n)", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(makeEntry());

    await createPlatingEntry(validInput({ discount: 100 }));

    const call = vi.mocked(prisma.platingEntry.create).mock.calls[0][0];
    expect(call.data.discount).toBe(10000n);
    // Total = 100000 (brass 2.5kg×₹400) − 10000 (discount) = 90000
    expect(call.data.total).toBe(90000n);
  });

  it("CRITICAL: computes line totals via computeLineTotal — 1.875 × ₹350 = 65625 paise", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(makeEntry());

    await createPlatingEntry(
      validInput({
        lineItems: [
          { materialDescription: "Aluminium", weightKg: 1.875, ratePerKg: 350 },
        ],
      }),
    );

    const call = vi.mocked(prisma.platingEntry.create).mock.calls[0][0];
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
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(makeEntry());

    await createPlatingEntry(
      validInput({
        discount: 100,
        lineItems: [
          { materialDescription: "Brass", weightKg: 2.5, ratePerKg: 400 },
          { materialDescription: "Aluminium", weightKg: 1.875, ratePerKg: 350 },
        ],
      }),
    );

    const call = vi.mocked(prisma.platingEntry.create).mock.calls[0][0];
    // Line 1 total = 100000, Line 2 total = 65625. Subtotal = 165625.
    // Discount 100 = 10000 paise. Final = 155625.
    expect(call.data.total).toBe(155625n);
  });

  it("rejects when discount exceeds subtotal", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());

    const result = await createPlatingEntry(
      validInput({ discount: 5000 }), // line subtotal is ₹1,000
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.discount).toBeDefined();
    expect(prisma.platingEntry.create).not.toHaveBeenCalled();
  });
});

describe("createPlatingEntry — vendor auto-promotion (Phase 6 pattern)", () => {
  it("walk-in WITH phone matching an existing vendor → links to that vendor", async () => {
    vi.mocked(prisma.castingPlatingVendor.findFirst).mockResolvedValue(
      makeVendor({ id: "vendor-existing", name: "Canonical", phone: "9876511002" }),
    );
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(
      makeEntry({ vendorId: "vendor-existing" }),
    );

    await createPlatingEntry(
      validInput({
        vendorId: null,
        partyName: "Typed name — overridden",
        partyPhone: "9876511002",
      }),
    );

    expect(prisma.castingPlatingVendor.create).not.toHaveBeenCalled();
    const call = vi.mocked(prisma.platingEntry.create).mock.calls[0][0];
    expect(call.data.vendorId).toBe("vendor-existing");
    expect(call.data.partyName).toBe("Canonical");
    expect(call.data.partyName).not.toBe("Typed name — overridden");
  });

  it("walk-in WITH phone not matching any vendor → auto-creates a new vendor", async () => {
    vi.mocked(prisma.castingPlatingVendor.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.castingPlatingVendor.create).mockResolvedValue(
      makeVendor({ id: "vendor-new", name: "Fresh Walk-in", phone: "9876511003" }),
    );
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(
      makeEntry({ vendorId: "vendor-new" }),
    );

    await createPlatingEntry(
      validInput({
        vendorId: null,
        partyName: "Fresh Walk-in",
        partyPhone: "9876511003",
      }),
    );

    expect(prisma.castingPlatingVendor.create).toHaveBeenCalledOnce();
    const vendorCreateCall = vi.mocked(prisma.castingPlatingVendor.create).mock.calls[0][0];
    expect(vendorCreateCall.data.name).toBe("Fresh Walk-in");
    expect(vendorCreateCall.data.phone).toBe("9876511003");
  });

  it("walk-in WITHOUT phone → stays snapshot-only (no vendor lookup/create)", async () => {
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(
      makeEntry({ vendorId: null }),
    );

    await createPlatingEntry(
      validInput({
        vendorId: null,
        partyName: "One-time walk-in",
        partyPhone: "",
      }),
    );

    expect(prisma.castingPlatingVendor.findFirst).not.toHaveBeenCalled();
    expect(prisma.castingPlatingVendor.create).not.toHaveBeenCalled();
    const call = vi.mocked(prisma.platingEntry.create).mock.calls[0][0];
    expect(call.data.vendorId).toBeNull();
    expect(call.data.partyName).toBe("One-time walk-in");
  });

  it("vendor-id supplied but row is missing/soft-deleted → returns ok=false", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(null);

    const result = await createPlatingEntry(validInput());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.vendorId).toBeDefined();
    expect(prisma.platingEntry.create).not.toHaveBeenCalled();
  });
});

describe("createPlatingEntry — billId validation", () => {
  it("rejects when billId references a non-existent / non-READY / soft-deleted bill", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(null);

    const result = await createPlatingEntry(validInput({ attachmentId: "missing-bill" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.attachmentId).toBeDefined();
    expect(prisma.platingEntry.create).not.toHaveBeenCalled();
  });

  it("rejects a billId pointing at a FAILED bill", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue({
      id: "bill-1",
      r2Key: "bills/2026/05/x",
      mimeType: "image/png",
      sizeBytes: 70,
      originalFilename: "x.png",
      uploadedById: "user-1",
      attachedToType: "PLATING_ENTRY",
      attachedToId: null,
      status: "FAILED",
      uploadedAt: new Date(),
      confirmedAt: null,
      deletedAt: null,
    });

    const result = await createPlatingEntry(validInput({ attachmentId: "bill-1" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.attachmentId).toBeDefined();
  });

  it("accepts a billId pointing at a READY non-deleted bill", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue({
      id: "bill-1",
      r2Key: "bills/2026/05/x",
      mimeType: "image/png",
      sizeBytes: 70,
      originalFilename: "x.png",
      uploadedById: "user-1",
      attachedToType: "PLATING_ENTRY",
      attachedToId: null,
      status: "READY",
      uploadedAt: new Date(),
      confirmedAt: new Date(),
      deletedAt: null,
    });
    vi.mocked(prisma.platingEntry.create).mockResolvedValue(makeEntry({ attachmentId: "bill-1" }));

    const result = await createPlatingEntry(validInput({ attachmentId: "bill-1" }));

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.platingEntry.create).mock.calls[0][0];
    expect(call.data.attachmentId).toBe("bill-1");
  });
});

// =====================================================================
// updatePlatingEntry — replace-all line items + recompute total
// =====================================================================

describe("updatePlatingEntry", () => {
  it("happy path — deleteMany line items then recreate, then update entry", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.platingLineItem.deleteMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.platingEntry.update).mockResolvedValue(makeEntry({ id: "abc" }));

    const result = await updatePlatingEntry("abc", validInput());

    expect(result.ok).toBe(true);
    expect(prisma.platingLineItem.deleteMany).toHaveBeenCalledWith({
      where: { platingEntryId: "abc" },
    });
    expect(prisma.platingEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/plating");
  });

  it("recomputes total after line items change", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
    vi.mocked(prisma.platingLineItem.deleteMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.platingEntry.update).mockResolvedValue(makeEntry({ id: "abc" }));

    await updatePlatingEntry(
      "abc",
      validInput({
        lineItems: [
          { materialDescription: "Brass", weightKg: 5, ratePerKg: 400 },
        ],
      }),
    );

    const call = vi.mocked(prisma.platingEntry.update).mock.calls[0][0];
    expect(call.data.total).toBe(200000n); // 5 kg × ₹400 = ₹2000
  });

  it("rejects when discount exceeds subtotal", async () => {
    vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());

    const result = await updatePlatingEntry(
      "abc",
      validInput({ discount: 99999 }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.discount).toBeDefined();
    expect(prisma.platingEntry.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// softDeletePlatingEntry
// =====================================================================

describe("softDeletePlatingEntry", () => {
  it("sets deletedAt and revalidates", async () => {
    vi.mocked(prisma.platingEntry.update).mockResolvedValue(
      makeEntry({ deletedAt: new Date() }),
    );

    const result = await softDeletePlatingEntry("abc");

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.platingEntry.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "abc", deletedAt: null });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/plating");
  });
});

// =====================================================================
// attachAttachmentToPlatingEntry / detachAttachmentFromPlatingEntry
// =====================================================================

describe("attachBillToPlatingEntry", () => {
  it("sets billId on the entry", async () => {
    vi.mocked(prisma.platingEntry.update).mockResolvedValue(makeEntry({ attachmentId: "bill-x" }));

    const result = await attachAttachmentToPlatingEntry("entry-1", "bill-x");

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.platingEntry.update).mock.calls[0][0];
    expect(call.data.attachmentId).toBe("bill-x");
    expect(revalidatePath).toHaveBeenCalledWith("/plating");
  });
});

describe("detachBillFromPlatingEntry", () => {
  it("clears billId on the entry", async () => {
    vi.mocked(prisma.platingEntry.update).mockResolvedValue(makeEntry({ attachmentId: null }));

    const result = await detachAttachmentFromPlatingEntry("entry-1");

    expect(result.ok).toBe(true);
    const call = vi.mocked(prisma.platingEntry.update).mock.calls[0][0];
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

describe.each(ROLE_MATRIX)("createPlatingEntry role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
      vi.mocked(prisma.platingEntry.create).mockResolvedValue(makeEntry());
      const r = await createPlatingEntry(validInput());
      expect(r.ok).toBe(true);
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createPlatingEntry(validInput())).rejects.toThrow("Forbidden");
      expect(prisma.platingEntry.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("updatePlatingEntry role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.castingPlatingVendor.findUnique).mockResolvedValue(makeVendor());
      vi.mocked(prisma.platingLineItem.deleteMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.platingEntry.update).mockResolvedValue(makeEntry());
      const r = await updatePlatingEntry("abc", validInput());
      expect(r.ok).toBe(true);
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(updatePlatingEntry("abc", validInput())).rejects.toThrow("Forbidden");
      expect(prisma.platingEntry.update).not.toHaveBeenCalled();
    }
  });
});

describe.each(ROLE_MATRIX)("softDeletePlatingEntry role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.platingEntry.update).mockResolvedValue(makeEntry());
      const r = await softDeletePlatingEntry("abc");
      expect(r.ok).toBe(true);
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeletePlatingEntry("abc")).rejects.toThrow("Forbidden");
      expect(prisma.platingEntry.update).not.toHaveBeenCalled();
    }
  });
});
