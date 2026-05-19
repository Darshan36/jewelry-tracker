// Action tests for the Attachment upload flow. Mocks Prisma, the R2 wrapper,
// the auth-guards, next/cache, and the read-side access helper so each
// action's DB / R2 / auth interactions can be asserted in isolation.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — must be declared before any imports of the modules
// they replace. `vi.mock("@/lib/prisma")` resolves to the shared deep
// mock in `src/lib/__mocks__/prisma.ts`.
vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi.fn(),
  requireSession: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  generatePresignedPutUrl: vi.fn(),
  generatePresignedGetUrl: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
}));
vi.mock("@/lib/attachment-access", () => ({
  canAccessAttachment: vi.fn(() => true),
  getViewableBillUrl: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { requireRole, requireSession } from "@/lib/auth-guards";
import { deleteObject, generatePresignedPutUrl, headObject } from "@/lib/r2";
import { canAccessAttachment, getViewableBillUrl } from "@/lib/attachment-access";
import { revalidatePath } from "next/cache";

import {
  confirmUpload,
  getAttachmentViewUrl,
  getPhotosForEntity,
  prepareUpload,
  softDeleteAttachment,
} from "./actions";
import type { Attachment, Role } from "@/generated/prisma";

// ---------- helpers ----------

function sessionFor(role: Role) {
  return {
    user: { id: "user-1", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: "bill-1",
    r2Key: "bills/2026/05/uuid-receipt.pdf",
    mimeType: "application/pdf",
    sizeBytes: 4096,
    originalFilename: "receipt.pdf",
    uploadedById: "user-1",
    attachedToType: null,
    attachedToId: null,
    status: "PENDING",
    uploadedAt: new Date("2026-05-17T12:00:00Z"),
    confirmedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function validPrepare(overrides = {}) {
  return {
    originalFilename: "receipt.pdf",
    mimeType: "application/pdf" as const,
    sizeBytes: 4096,
    attachedToType: null,
    attachedToId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireSession).mockReset();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(generatePresignedPutUrl).mockReset();
  vi.mocked(headObject).mockReset();
  vi.mocked(deleteObject).mockReset();
  vi.mocked(canAccessAttachment).mockReset();
  vi.mocked(canAccessAttachment).mockReturnValue(true);
  vi.mocked(getViewableBillUrl).mockReset();

  // Defaults — most tests want a passing role guard and a presign URL.
  vi.mocked(requireRole).mockResolvedValue(sessionFor("ADMIN"));
  vi.mocked(requireSession).mockResolvedValue(sessionFor("ADMIN"));
  vi.mocked(generatePresignedPutUrl).mockResolvedValue(
    "https://signed.example/put",
  );
});

// =====================================================================
// prepareUpload
// =====================================================================

describe("prepareUpload", () => {
  it("happy path — ADMIN + null attachedToType creates a PENDING row and returns the presigned URL", async () => {
    vi.mocked(prisma.attachment.create).mockResolvedValue(makeAttachment());

    const result = await prepareUpload(validPrepare());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attachmentId).toBe("bill-1");
      expect(result.presignedUrl).toBe("https://signed.example/put");
    }
    // requireRole was called with admin-only for null attachedToType
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);

    // prisma.attachment.create receives a status:PENDING row with a generated r2Key
    const call = vi.mocked(prisma.attachment.create).mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    expect(call.data.uploadedById).toBe("user-1");
    expect(call.data.mimeType).toBe("application/pdf");
    expect(call.data.sizeBytes).toBe(4096);
    expect(call.data.attachedToType).toBeNull();
    expect(call.data.attachedToId).toBeNull();

    // Generated r2Key has the expected shape: bills/YYYY/MM/<uuid>-<filename>
    expect(call.data.r2Key).toMatch(
      /^bills\/\d{4}\/\d{2}\/[0-9a-f-]{36}-receipt\.pdf/,
    );

    // The same r2Key was passed to presigner with declared mime + size
    expect(generatePresignedPutUrl).toHaveBeenCalledWith(
      call.data.r2Key,
      "application/pdf",
      4096,
    );
  });

  it("happy path — PURCHASE_DEPT can attach a bill to a PURCHASE", async () => {
    vi.mocked(requireRole).mockResolvedValueOnce(sessionFor("PURCHASE_DEPT"));
    vi.mocked(prisma.attachment.create).mockResolvedValue(
      makeAttachment({
        attachedToType: "PURCHASE",
        attachedToId: "purchase-1",
        uploadedById: "user-1",
      }),
    );

    const result = await prepareUpload(
      validPrepare({ attachedToType: "PURCHASE", attachedToId: "purchase-1" }),
    );

    expect(result.ok).toBe(true);
    expect(requireRole).toHaveBeenCalledWith(["ADMIN", "PURCHASE_DEPT"]);
  });

  it("rejects an unsupported MIME at the schema layer — DB not touched", async () => {
    const result = await prepareUpload({
      ...validPrepare(),
      mimeType: "text/plain" as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.mimeType).toBeDefined();
    }
    expect(prisma.attachment.create).not.toHaveBeenCalled();
    expect(generatePresignedPutUrl).not.toHaveBeenCalled();
  });

  it("rejects an oversized file at the schema layer — DB not touched", async () => {
    const result = await prepareUpload({
      ...validPrepare(),
      sizeBytes: 11 * 1024 * 1024, // 11 MB > 10 MB cap
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.sizeBytes).toBeDefined();
    expect(prisma.attachment.create).not.toHaveBeenCalled();
  });

  it("propagates Forbidden when requireRole rejects (non-admin tries null attachedToType)", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));

    await expect(prepareUpload(validPrepare())).rejects.toThrow("Forbidden");
    expect(prisma.attachment.create).not.toHaveBeenCalled();
    expect(generatePresignedPutUrl).not.toHaveBeenCalled();
  });

  it("r2Key is unique per call (uuid component changes across invocations)", async () => {
    vi.mocked(prisma.attachment.create).mockResolvedValue(makeAttachment());

    await prepareUpload(validPrepare());
    await prepareUpload(validPrepare());

    const k1 = vi.mocked(prisma.attachment.create).mock.calls[0][0].data.r2Key;
    const k2 = vi.mocked(prisma.attachment.create).mock.calls[1][0].data.r2Key;
    expect(k1).not.toBe(k2);
  });
});

// =====================================================================
// confirmUpload
// =====================================================================

describe("confirmUpload", () => {
  it("happy path — HEAD matches → status READY + confirmedAt set + revalidate", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(makeAttachment());
    vi.mocked(headObject).mockResolvedValue({
      contentType: "application/pdf",
      contentLength: 4096,
    });
    vi.mocked(prisma.attachment.update).mockResolvedValue(
      makeAttachment({ status: "READY", confirmedAt: new Date() }),
    );

    const result = await confirmUpload({ attachmentId: "bill-1" });

    expect(result.ok).toBe(true);
    const updateCall = vi.mocked(prisma.attachment.update).mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: "bill-1" });
    expect(updateCall.data.status).toBe("READY");
    expect(updateCall.data.confirmedAt).toBeInstanceOf(Date);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/bills-test");
  });

  it("returns ok=false when the bill does not exist", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(null);

    const result = await confirmUpload({ attachmentId: "missing" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.attachmentId).toContain("Bill not found");
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  it("returns ok=false when the bill is already READY (idempotent guard)", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ status: "READY" }),
    );

    const result = await confirmUpload({ attachmentId: "bill-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.attachmentId?.[0]).toMatch(/already ready/i);
    }
    expect(prisma.attachment.update).not.toHaveBeenCalled();
    expect(headObject).not.toHaveBeenCalled();
  });

  it("marks bill FAILED + does NOT delete R2 when headObject returns null (missing object)", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(makeAttachment());
    vi.mocked(headObject).mockResolvedValue(null);
    vi.mocked(prisma.attachment.update).mockResolvedValue(
      makeAttachment({ status: "FAILED" }),
    );

    const result = await confirmUpload({ attachmentId: "bill-1" });

    expect(result.ok).toBe(false);
    const updateCall = vi.mocked(prisma.attachment.update).mock.calls[0][0];
    expect(updateCall.data.status).toBe("FAILED");
    // No R2 object to delete; deleteObject not called
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("marks bill FAILED + DELETES R2 object when MIME type does not match the registered value", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(makeAttachment());
    vi.mocked(headObject).mockResolvedValue({
      contentType: "image/png", // mismatch — bill registered as application/pdf
      contentLength: 4096,
    });
    vi.mocked(prisma.attachment.update).mockResolvedValue(
      makeAttachment({ status: "FAILED" }),
    );
    vi.mocked(deleteObject).mockResolvedValue(undefined);

    const result = await confirmUpload({ attachmentId: "bill-1" });

    expect(result.ok).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith("bills/2026/05/uuid-receipt.pdf");
    expect(vi.mocked(prisma.attachment.update).mock.calls[0][0].data.status).toBe(
      "FAILED",
    );
  });

  it("marks bill FAILED + DELETES R2 object when size does not match", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(makeAttachment());
    vi.mocked(headObject).mockResolvedValue({
      contentType: "application/pdf",
      contentLength: 1, // mismatch — bill registered 4096
    });
    vi.mocked(prisma.attachment.update).mockResolvedValue(makeAttachment({ status: "FAILED" }));

    const result = await confirmUpload({ attachmentId: "bill-1" });

    expect(result.ok).toBe(false);
    expect(deleteObject).toHaveBeenCalled();
  });

  it("propagates Forbidden when requireRole rejects", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(makeAttachment());
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));

    await expect(confirmUpload({ attachmentId: "bill-1" })).rejects.toThrow(
      "Forbidden",
    );
    expect(headObject).not.toHaveBeenCalled();
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// softDeleteAttachment
// =====================================================================

describe("softDeleteBill", () => {
  it("happy path — deletes R2 object first, then tombstones the DB row", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ status: "READY" }),
    );
    vi.mocked(deleteObject).mockResolvedValue(undefined);
    vi.mocked(prisma.attachment.update).mockResolvedValue(
      makeAttachment({ deletedAt: new Date() }),
    );

    const result = await softDeleteAttachment({ attachmentId: "bill-1" });

    expect(result.ok).toBe(true);
    // R2 delete happened
    expect(deleteObject).toHaveBeenCalledWith(
      "bills/2026/05/uuid-receipt.pdf",
    );
    // DB tombstone happened
    const call = vi.mocked(prisma.attachment.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/bills-test");
  });

  it("still tombstones the DB row if R2 deleteObject throws (orphan cleanup deferred)", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ status: "READY" }),
    );
    vi.mocked(deleteObject).mockRejectedValue(new Error("AccessDenied"));
    vi.mocked(prisma.attachment.update).mockResolvedValue(
      makeAttachment({ deletedAt: new Date() }),
    );

    const result = await softDeleteAttachment({ attachmentId: "bill-1" });

    expect(result.ok).toBe(true);
    expect(prisma.attachment.update).toHaveBeenCalledOnce();
  });

  it("returns ok=false when the bill does not exist", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(null);

    const result = await softDeleteAttachment({ attachmentId: "missing" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.attachmentId).toContain("Bill not found");
    expect(deleteObject).not.toHaveBeenCalled();
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  it("returns ok=false when the bill is already soft-deleted (idempotency)", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ deletedAt: new Date() }),
    );

    const result = await softDeleteAttachment({ attachmentId: "bill-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.attachmentId?.[0]).toMatch(/already deleted/i);
    }
    expect(deleteObject).not.toHaveBeenCalled();
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  it("propagates Forbidden when requireRole rejects on the bill's attachedToType", async () => {
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ attachedToType: "PURCHASE", status: "READY" }),
    );
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));

    await expect(softDeleteAttachment({ attachmentId: "bill-1" })).rejects.toThrow(
      "Forbidden",
    );
    expect(deleteObject).not.toHaveBeenCalled();
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });

  it("throws Forbidden via canAccessBill drift check when role write/read matrices diverge", async () => {
    // The action calls requireRole (write matrix) AND canAccessAttachment (read
    // matrix) as defense in depth — a misconfiguration that lets the
    // write through but is denied on read is caught here.
    vi.mocked(prisma.attachment.findUnique).mockResolvedValue(
      makeAttachment({ status: "READY" }),
    );
    vi.mocked(canAccessAttachment).mockReturnValue(false);

    await expect(softDeleteAttachment({ attachmentId: "bill-1" })).rejects.toThrow(
      "Forbidden",
    );
    expect(deleteObject).not.toHaveBeenCalled();
    expect(prisma.attachment.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// getAttachmentViewUrl
// =====================================================================

describe("getBillViewUrl", () => {
  it("happy path — returns the URL when getViewableBillUrl resolves to one", async () => {
    vi.mocked(getViewableBillUrl).mockResolvedValue(
      "https://signed.example/view",
    );

    const result = await getAttachmentViewUrl("bill-1");

    expect(result).toEqual({ ok: true, url: "https://signed.example/view" });
    expect(requireSession).toHaveBeenCalledOnce();
    expect(getViewableBillUrl).toHaveBeenCalledWith("bill-1", "ADMIN");
  });

  it("returns ok=false when the helper denies the view (role mismatch, deleted, non-ready, or missing)", async () => {
    vi.mocked(getViewableBillUrl).mockResolvedValue(null);

    const result = await getAttachmentViewUrl("bill-1");

    expect(result).toEqual({ ok: false, error: "Not available" });
  });
});

// =====================================================================
// Role matrix sanity — prepareUpload × four roles × two attachedToTypes
// =====================================================================

const ROLE_MATRIX: ReadonlyArray<[Role, "null" | "PURCHASE", boolean]> = [
  ["ADMIN", "null", true],
  ["ADMIN", "PURCHASE", true],
  ["PURCHASE_DEPT", "null", false],
  ["PURCHASE_DEPT", "PURCHASE", true],
  ["LABOUR_MGMT", "null", false],
  ["LABOUR_MGMT", "PURCHASE", false],
  ["CASTING_PLATING_MGMT", "null", false],
  ["CASTING_PLATING_MGMT", "PURCHASE", false],
];

describe.each(ROLE_MATRIX)(
  "prepareUpload role matrix — role=%s attachedToType=%s",
  (role, attachKind, allowed) => {
    it(allowed ? "allows" : "denies (Forbidden)", async () => {
      const attachedToType = attachKind === "null" ? null : "PURCHASE";
      if (allowed) {
        vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
        vi.mocked(prisma.attachment.create).mockResolvedValue(makeAttachment());
        const result = await prepareUpload(
          validPrepare({ attachedToType, attachedToId: null }),
        );
        expect(result.ok).toBe(true);
        expect(prisma.attachment.create).toHaveBeenCalledOnce();
      } else {
        vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
        await expect(
          prepareUpload(
            validPrepare({ attachedToType, attachedToId: null }),
          ),
        ).rejects.toThrow("Forbidden");
        expect(prisma.attachment.create).not.toHaveBeenCalled();
      }
    });
  },
);

// =====================================================================
// getPhotosForEntity (Phase 12a)
// =====================================================================

describe("getPhotosForEntity", () => {
  it("happy path — returns READY photos for the discriminator pair, oldest first", async () => {
    const photos = [
      makeAttachment({
        id: "p-1",
        originalFilename: "red.png",
        mimeType: "image/png",
        sizeBytes: 100,
        attachedToType: "PURCHASE_PHOTO",
        attachedToId: "purchase-X",
        status: "READY",
        uploadedAt: new Date("2026-05-17T10:00:00Z"),
      }),
      makeAttachment({
        id: "p-2",
        originalFilename: "green.png",
        mimeType: "image/png",
        sizeBytes: 110,
        attachedToType: "PURCHASE_PHOTO",
        attachedToId: "purchase-X",
        status: "READY",
        uploadedAt: new Date("2026-05-17T10:01:00Z"),
      }),
    ];
    vi.mocked(prisma.attachment.findMany).mockResolvedValue(photos);

    const res = await getPhotosForEntity("PURCHASE_PHOTO", "purchase-X");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.photos).toHaveLength(2);
      expect(res.photos[0].id).toBe("p-1");
      expect(res.photos[0].originalFilename).toBe("red.png");
      expect(res.photos[1].id).toBe("p-2");
    }

    // Query filters: attachedToType + attachedToId + READY + not deleted,
    // sorted asc by uploadedAt.
    const call = vi.mocked(prisma.attachment.findMany).mock.calls[0][0];
    expect(call?.where).toMatchObject({
      attachedToType: "PURCHASE_PHOTO",
      attachedToId: "purchase-X",
      status: "READY",
      deletedAt: null,
    });
    expect(call?.orderBy).toEqual({ uploadedAt: "asc" });
  });

  it("returns an empty array (ok=true) when no photos exist", async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);

    const res = await getPhotosForEntity("PURCHASE_PHOTO", "purchase-X");

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.photos).toHaveLength(0);
  });

  it("filters out photos the role can't access (defense in depth)", async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([
      makeAttachment({ id: "p-1", attachedToType: "PURCHASE_PHOTO" }),
      makeAttachment({ id: "p-2", attachedToType: "PURCHASE_PHOTO" }),
    ]);
    // First photo passes the check, second is denied.
    vi.mocked(canAccessAttachment)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const res = await getPhotosForEntity("PURCHASE_PHOTO", "purchase-X");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.photos).toHaveLength(1);
      expect(res.photos[0].id).toBe("p-1");
    }
  });

  it("requires a session (calls requireSession)", async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);
    await getPhotosForEntity("PURCHASE_PHOTO", "purchase-X");
    expect(requireSession).toHaveBeenCalledOnce();
  });

  it("returns serialized fields only (no internal columns like r2Key)", async () => {
    vi.mocked(prisma.attachment.findMany).mockResolvedValue([
      makeAttachment({
        id: "p-1",
        attachedToType: "PURCHASE_PHOTO",
        r2Key: "bills/2026/05/private-key",
      }),
    ]);

    const res = await getPhotosForEntity("PURCHASE_PHOTO", "purchase-X");

    expect(res.ok).toBe(true);
    if (res.ok) {
      const photo = res.photos[0] as unknown as Record<string, unknown>;
      expect(Object.keys(photo).sort()).toEqual(
        ["id", "mimeType", "originalFilename", "sizeBytes", "uploadedAt"].sort(),
      );
      // r2Key must not leak to the client.
      expect(photo.r2Key).toBeUndefined();
    }
  });
});
