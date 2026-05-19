// Tests for the canAccessAttachment role matrix + getViewableBillUrl guard.
//
// canAccessAttachment is a pure function (no I/O) so it's tested as such.
// getViewableBillUrl mocks @/lib/prisma (DB lookup) + @/lib/r2 (presign).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Attachment, Role } from "@/generated/prisma";

import { canAccessAttachment, getViewableBillUrl } from "./attachment-access";

vi.mock("@/lib/prisma");
vi.mock("@/lib/r2", () => ({
  generatePresignedGetUrl: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { generatePresignedGetUrl } from "@/lib/r2";

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "bill-1",
    r2Key: "bills/2026/05/key",
    mimeType: "image/png",
    sizeBytes: 70,
    originalFilename: "test.png",
    uploadedById: "user-1",
    attachedToType: null,
    attachedToId: null,
    status: "READY",
    uploadedAt: new Date("2026-05-17T12:00:00Z"),
    confirmedAt: new Date("2026-05-17T12:00:01Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generatePresignedGetUrl).mockResolvedValue(
    "https://signed.example/url",
  );
});

// =====================================================================
// canAccessAttachment — role × attachedToType matrix
// =====================================================================

describe("canAccessBill", () => {
  it("ADMIN always passes regardless of attachedToType (null)", () => {
    expect(canAccessAttachment("ADMIN", makeAttachment({ attachedToType: null }))).toBe(true);
  });

  it("ADMIN passes for every known attachedToType", () => {
    for (const t of [
      "PURCHASE",
      "PURCHASE_PAYMENT",
      "CASTING_ENTRY",
      "PLATING_ENTRY",
      "PURCHASE_PHOTO",
    ] as const) {
      expect(canAccessAttachment("ADMIN", makeAttachment({ attachedToType: t }))).toBe(true);
    }
  });

  it("non-admin denied for attachedToType=null (admin-only standalone bills)", () => {
    const roles: Role[] = ["PURCHASE_DEPT", "LABOUR_MGMT", "CASTING_PLATING_MGMT"];
    for (const role of roles) {
      expect(canAccessAttachment(role, makeAttachment({ attachedToType: null }))).toBe(false);
    }
  });

  it("PURCHASE_DEPT passes for PURCHASE and PURCHASE_PAYMENT", () => {
    expect(canAccessAttachment("PURCHASE_DEPT", makeAttachment({ attachedToType: "PURCHASE" }))).toBe(true);
    expect(canAccessAttachment("PURCHASE_DEPT", makeAttachment({ attachedToType: "PURCHASE_PAYMENT" }))).toBe(true);
  });

  it("PURCHASE_DEPT denied for CASTING_ENTRY and PLATING_ENTRY", () => {
    expect(canAccessAttachment("PURCHASE_DEPT", makeAttachment({ attachedToType: "CASTING_ENTRY" }))).toBe(false);
    expect(canAccessAttachment("PURCHASE_DEPT", makeAttachment({ attachedToType: "PLATING_ENTRY" }))).toBe(false);
  });

  it("CASTING_PLATING_MGMT passes for CASTING_ENTRY and PLATING_ENTRY", () => {
    expect(canAccessAttachment("CASTING_PLATING_MGMT", makeAttachment({ attachedToType: "CASTING_ENTRY" }))).toBe(true);
    expect(canAccessAttachment("CASTING_PLATING_MGMT", makeAttachment({ attachedToType: "PLATING_ENTRY" }))).toBe(true);
  });

  it("CASTING_PLATING_MGMT denied for purchase-type bills", () => {
    expect(canAccessAttachment("CASTING_PLATING_MGMT", makeAttachment({ attachedToType: "PURCHASE" }))).toBe(false);
    expect(canAccessAttachment("CASTING_PLATING_MGMT", makeAttachment({ attachedToType: "PURCHASE_PAYMENT" }))).toBe(false);
  });

  it("LABOUR_MGMT denied for all attachedToTypes (no bill kind belongs to labour yet)", () => {
    const all = [
      null,
      "PURCHASE",
      "PURCHASE_PAYMENT",
      "CASTING_ENTRY",
      "PLATING_ENTRY",
      "PURCHASE_PHOTO",
    ] as const;
    for (const t of all) {
      expect(canAccessAttachment("LABOUR_MGMT", makeAttachment({ attachedToType: t }))).toBe(false);
    }
  });

  // Phase 12a — PURCHASE_PHOTO inherits the PURCHASE matrix.
  it("PURCHASE_DEPT passes for PURCHASE_PHOTO (same matrix as PURCHASE)", () => {
    expect(canAccessAttachment("PURCHASE_DEPT", makeAttachment({ attachedToType: "PURCHASE_PHOTO" }))).toBe(true);
  });

  it("CASTING_PLATING_MGMT denied for PURCHASE_PHOTO", () => {
    expect(canAccessAttachment("CASTING_PLATING_MGMT", makeAttachment({ attachedToType: "PURCHASE_PHOTO" }))).toBe(false);
  });

  it("LABOUR_MGMT denied for PURCHASE_PHOTO", () => {
    expect(canAccessAttachment("LABOUR_MGMT", makeAttachment({ attachedToType: "PURCHASE_PHOTO" }))).toBe(false);
  });

  it("unrecognised attachedToType fails closed for non-admin", () => {
    expect(
      canAccessAttachment(
        "PURCHASE_DEPT",
        makeAttachment({ attachedToType: "UNKNOWN_NEW_KIND" as string }),
      ),
    ).toBe(false);
  });

  it("unrecognised attachedToType still allows ADMIN through (defense-in-depth)", () => {
    expect(
      canAccessAttachment(
        "ADMIN",
        makeAttachment({ attachedToType: "UNKNOWN_NEW_KIND" as string }),
      ),
    ).toBe(true);
  });
});

// =====================================================================
// getViewableBillUrl — combines DB lookup + role guard + presign
// =====================================================================

describe("getViewableBillUrl", () => {
  it("returns null when the bill is not found in the database", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(null);
    const url = await getViewableBillUrl("missing-id", "ADMIN");
    expect(url).toBeNull();
    expect(generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it("returns null when the bill is soft-deleted", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ deletedAt: new Date(), status: "READY" }),
    );
    const url = await getViewableBillUrl("bill-1", "ADMIN");
    expect(url).toBeNull();
    expect(generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it("returns null when the bill is PENDING (no usable R2 object yet)", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ status: "PENDING" }),
    );
    const url = await getViewableBillUrl("bill-1", "ADMIN");
    expect(url).toBeNull();
    expect(generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it("returns null when the bill is FAILED", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ status: "FAILED" }),
    );
    const url = await getViewableBillUrl("bill-1", "ADMIN");
    expect(url).toBeNull();
    expect(generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it("returns null when the caller's role can't access the bill", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ attachedToType: "PURCHASE", status: "READY" }),
    );
    const url = await getViewableBillUrl("bill-1", "LABOUR_MGMT");
    expect(url).toBeNull();
    expect(generatePresignedGetUrl).not.toHaveBeenCalled();
  });

  it("returns a presigned URL when all conditions pass for ADMIN", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(makeAttachment());
    const url = await getViewableBillUrl("bill-1", "ADMIN");
    expect(url).toBe("https://signed.example/url");
    expect(generatePresignedGetUrl).toHaveBeenCalledWith(
      "bills/2026/05/key",
    );
  });

  it("returns a presigned URL when PURCHASE_DEPT views a PURCHASE-attached bill", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ attachedToType: "PURCHASE" }),
    );
    const url = await getViewableBillUrl("bill-1", "PURCHASE_DEPT");
    expect(url).toBe("https://signed.example/url");
  });
});
