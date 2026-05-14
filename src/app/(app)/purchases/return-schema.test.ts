import { describe, expect, it } from "vitest";

import { purchaseReturnInputSchema } from "./return-schema";

function validInput() {
  return {
    purchaseId: "cuid-purchase-1",
    date: "2026-05-14",
    qtyReturned: 2,
    refundAmount: 400,
    note: "Defective batch",
  };
}

describe("purchaseReturnInputSchema", () => {
  describe("happy path", () => {
    it("accepts a valid return input", () => {
      const result = purchaseReturnInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
    });

    it("accepts minimal input (purchaseId + date + qty + refund, no note)", () => {
      const result = purchaseReturnInputSchema.safeParse({
        purchaseId: "cuid-purchase-1",
        date: "2026-05-14",
        qtyReturned: 1,
        refundAmount: 100,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.note).toBeNull();
    });
  });

  describe("purchaseId", () => {
    it("rejects empty purchaseId", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        purchaseId: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.purchaseId).toContain(
          "Purchase is required",
        );
      }
    });
  });

  describe("date — z.coerce.date()", () => {
    it("coerces YYYY-MM-DD string to a Date instance", () => {
      const result = purchaseReturnInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.date).toBeInstanceOf(Date);
    });

    it("rejects an empty string", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        date: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("qtyReturned", () => {
    it("rejects zero", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        qtyReturned: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.qtyReturned).toContain(
          "Quantity must be greater than zero",
        );
      }
    });

    it("rejects negative", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        qtyReturned: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer (e.g., 2.5)", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        qtyReturned: 2.5,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.qtyReturned).toContain(
          "Quantity must be a whole number",
        );
      }
    });

    it("accepts positive integer", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        qtyReturned: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("refundAmount", () => {
    it("accepts zero refund (return without monetary refund)", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        refundAmount: 0,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.refundAmount).toBe(0);
    });

    it("rejects negative refund", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        refundAmount: -1,
      });
      expect(result.success).toBe(false);
    });

    it("output refundAmount is plain number (NOT BigInt — wire format)", () => {
      const result = purchaseReturnInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.refundAmount).toBe("number");
        expect(result.data.refundAmount).toBe(400);
      }
    });
  });

  describe("note — empty-string-to-null", () => {
    it("transforms empty string to null", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        note: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.note).toBeNull();
    });

    it("rejects note > 500 chars", () => {
      const result = purchaseReturnInputSchema.safeParse({
        ...validInput(),
        note: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });
});
