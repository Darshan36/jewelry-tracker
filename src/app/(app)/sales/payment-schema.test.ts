import { describe, expect, it } from "vitest";

import { salePaymentInputSchema } from "./payment-schema";

function validInput() {
  return {
    saleId: "cuid-sale-1",
    date: "2026-05-14",
    amount: 500,
    note: "Cash, in person",
  };
}

describe("salePaymentInputSchema", () => {
  describe("happy path", () => {
    it("accepts a valid payment input", () => {
      const result = salePaymentInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
    });

    it("accepts minimal input (saleId + date + amount, no note)", () => {
      const result = salePaymentInputSchema.safeParse({
        saleId: "cuid-sale-1",
        date: "2026-05-14",
        amount: 100,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.note).toBeNull();
    });
  });

  describe("saleId", () => {
    it("rejects empty saleId", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        saleId: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.saleId).toContain(
          "Sale is required",
        );
      }
    });
  });

  describe("date — z.coerce.date()", () => {
    it("coerces YYYY-MM-DD string to a Date instance", () => {
      const result = salePaymentInputSchema.safeParse(validInput());
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.date).toBeInstanceOf(Date);
    });

    it("accepts an existing Date instance (server re-parse path)", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        date: new Date("2026-05-14T00:00:00Z"),
      });
      expect(result.success).toBe(true);
    });

    it("rejects an empty string", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        date: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("amount — kept as number, NOT transformed to BigInt", () => {
    it("rejects zero amount", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        amount: 0,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.amount).toContain(
          "Amount must be greater than zero",
        );
      }
    });

    it("rejects negative amount", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        amount: -1,
      });
      expect(result.success).toBe(false);
    });

    it("accepts a positive amount and preserves it as number", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        amount: 1234.56,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.amount).toBe("number");
        expect(result.data.amount).toBe(1234.56);
      }
    });
  });

  describe("type (Phase 3.3 PaymentType enum)", () => {
    it("defaults to PAYMENT when omitted", () => {
      const input = validInput() as Partial<ReturnType<typeof validInput>>;
      delete (input as { type?: unknown }).type; // simulate form omitting `type`
      const result = salePaymentInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe("PAYMENT");
    });

    it("accepts an explicit REFUND value", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        type: "REFUND",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.type).toBe("REFUND");
    });

    it("rejects unknown type values", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        type: "INVALID",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("note — empty-string-to-null", () => {
    it("transforms empty string to null", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        note: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.note).toBeNull();
    });

    it("transforms whitespace-only note to null (trimmed first)", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        note: "   ",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.note).toBeNull();
    });

    it("preserves a non-empty note", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        note: "Bank transfer ref 12345",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.note).toBe("Bank transfer ref 12345");
      }
    });

    it("rejects note > 500 chars", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        note: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 500-char note (boundary)", () => {
      const result = salePaymentInputSchema.safeParse({
        ...validInput(),
        note: "x".repeat(500),
      });
      expect(result.success).toBe(true);
    });
  });
});
