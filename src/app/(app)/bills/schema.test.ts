// Tests for the bill upload schemas — pure zod, no React, no DB.

import { describe, expect, it } from "vitest";

import {
  ALLOWED_MIME_TYPES,
  ATTACHED_TO_TYPES,
  MAX_FILE_SIZE_BYTES,
  confirmUploadInputSchema,
  prepareUploadInputSchema,
  sanitizeFilename,
  softDeleteBillInputSchema,
} from "./schema";

function validPrepare() {
  return {
    originalFilename: "receipt.pdf",
    mimeType: "application/pdf" as const,
    sizeBytes: 4096,
    attachedToType: null,
    attachedToId: null,
  };
}

// =====================================================================
// prepareUploadInputSchema — mimeType allowlist
// =====================================================================

describe("prepareUploadInputSchema — mimeType", () => {
  it("accepts each MIME type in the allowlist", () => {
    for (const m of ALLOWED_MIME_TYPES) {
      const result = prepareUploadInputSchema.safeParse({
        ...validPrepare(),
        mimeType: m,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects 'text/plain' (not in allowlist)", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      mimeType: "text/plain",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.mimeType?.[0]).toMatch(
        /Unsupported file type/,
      );
    }
  });

  it("rejects 'application/octet-stream' (browser fallback for unknown types)", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      mimeType: "application/octet-stream",
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================================
// sizeBytes
// =====================================================================

describe("prepareUploadInputSchema — sizeBytes", () => {
  it("accepts size of exactly MAX_FILE_SIZE_BYTES (boundary)", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      sizeBytes: MAX_FILE_SIZE_BYTES,
    });
    expect(result.success).toBe(true);
  });

  it("rejects size > MAX_FILE_SIZE_BYTES", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      sizeBytes: MAX_FILE_SIZE_BYTES + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.sizeBytes?.[0]).toMatch(
        /File too large/,
      );
    }
  });

  it("rejects zero size", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      sizeBytes: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative size", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      sizeBytes: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer size", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      sizeBytes: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

// =====================================================================
// originalFilename sanitisation
// =====================================================================

describe("sanitizeFilename helper", () => {
  it("strips forward slashes", () => {
    expect(sanitizeFilename("foo/bar.pdf")).toBe("foobar.pdf");
  });

  it("strips backslashes (Windows path separators)", () => {
    expect(sanitizeFilename("foo\\bar.pdf")).toBe("foobar.pdf");
  });

  it("strips control characters", () => {
    expect(sanitizeFilename("foobar.pdf")).toBe("foobar.pdf");
  });

  it("clamps to 255 characters after stripping", () => {
    const long = "a".repeat(300) + ".pdf";
    expect(sanitizeFilename(long).length).toBe(255);
  });

  it("preserves normal filenames including dots, dashes, and spaces", () => {
    expect(sanitizeFilename("My Receipt - 2026.05.17.pdf")).toBe(
      "My Receipt - 2026.05.17.pdf",
    );
  });
});

describe("prepareUploadInputSchema — originalFilename", () => {
  it("rejects empty filename", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      originalFilename: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a filename consisting only of path separators (empty after sanitisation)", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      originalFilename: "////\\\\",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.originalFilename?.[0]).toMatch(
        /empty after sanitisation/,
      );
    }
  });

  it("rejects a filename over 500 characters (pre-sanitisation)", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      originalFilename: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("applies sanitisation transform to the parsed output", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      originalFilename: "evil/../../etc/passwd",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.originalFilename).toBe("evil....etcpasswd");
      expect(result.data.originalFilename).not.toContain("/");
    }
  });
});

// =====================================================================
// attachedToType + attachedToId
// =====================================================================

describe("prepareUploadInputSchema — attachedToType", () => {
  it("accepts every value in the ATTACHED_TO_TYPES allowlist", () => {
    for (const t of ATTACHED_TO_TYPES) {
      const result = prepareUploadInputSchema.safeParse({
        ...validPrepare(),
        attachedToType: t,
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts null (standalone bills)", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      attachedToType: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attachedToType).toBeFalsy();
  });

  it("accepts omitted attachedToType (treated as null)", () => {
    const { attachedToType: _omit, ...rest } = validPrepare();
    const result = prepareUploadInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown attachedToType", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      attachedToType: "WAREHOUSE_RECEIVAL" as unknown as null,
    });
    expect(result.success).toBe(false);
  });
});

describe("prepareUploadInputSchema — attachedToId", () => {
  it("transforms empty-string attachedToId to null", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      attachedToId: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attachedToId).toBeNull();
  });

  it("preserves a non-empty attachedToId", () => {
    const result = prepareUploadInputSchema.safeParse({
      ...validPrepare(),
      attachedToType: "PURCHASE",
      attachedToId: "cuid-1234",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attachedToId).toBe("cuid-1234");
  });
});

// =====================================================================
// confirmUploadInputSchema + softDeleteBillInputSchema
// =====================================================================

describe("confirmUploadInputSchema", () => {
  it("accepts a non-empty billId", () => {
    const result = confirmUploadInputSchema.safeParse({ billId: "cuid-1" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty billId", () => {
    const result = confirmUploadInputSchema.safeParse({ billId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing billId", () => {
    const result = confirmUploadInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("softDeleteBillInputSchema", () => {
  it("accepts a non-empty billId", () => {
    const result = softDeleteBillInputSchema.safeParse({ billId: "cuid-1" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty billId", () => {
    const result = softDeleteBillInputSchema.safeParse({ billId: "" });
    expect(result.success).toBe(false);
  });
});
