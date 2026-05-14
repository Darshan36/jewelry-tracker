import { describe, expect, it } from "vitest";

import { saleInputSchema } from "./schema";

function validWalkInInput() {
  return {
    date: "2026-05-14",
    customerId: null,
    partyName: "Test Walkin",
    partyPhone: "9876543210",
    itemDescription: "Gold-plated chain",
    qty: 10,
    rate: 250,
    discount: 100,
    notes: "Test sale",
  };
}

function validLinkedInput() {
  return {
    date: "2026-05-14",
    customerId: "cuid_customer_123",
    partyName: "Priya Shah",
    partyPhone: "9876543210",
    itemDescription: "Gold-plated chain",
    qty: 10,
    rate: 250,
    discount: 100,
    notes: null,
  };
}

describe("saleInputSchema", () => {
  describe("happy path", () => {
    it("accepts a valid walk-in input (customerId null)", () => {
      const result = saleInputSchema.safeParse(validWalkInInput());
      expect(result.success).toBe(true);
    });

    it("accepts a valid linked-customer input (customerId provided)", () => {
      const result = saleInputSchema.safeParse(validLinkedInput());
      expect(result.success).toBe(true);
    });

    it("accepts the minimal input (discount/notes omitted) and applies defaults", () => {
      const result = saleInputSchema.safeParse({
        date: "2026-05-14",
        customerId: null,
        partyName: "Test",
        itemDescription: "x",
        qty: 1,
        rate: 100,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discount).toBe(0);
        expect(result.data.notes).toBeNull();
        expect(result.data.partyPhone).toBeNull();
      }
    });
  });

  describe("date — z.coerce.date()", () => {
    it("coerces YYYY-MM-DD string to a Date instance", () => {
      const result = saleInputSchema.safeParse(validWalkInInput());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.date).toBeInstanceOf(Date);
      }
    });

    it("accepts an existing Date instance (server re-parse path)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        date: new Date("2026-05-14T00:00:00Z"),
      });
      expect(result.success).toBe(true);
    });

    it("rejects an empty string", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        date: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-date string", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        date: "not-a-date-at-all",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("customerId", () => {
    it("accepts null (walk-in mode)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        customerId: null,
      });
      expect(result.success).toBe(true);
    });

    it("accepts a non-empty string id (linked mode)", () => {
      const result = saleInputSchema.safeParse({
        ...validLinkedInput(),
        customerId: "cuid_abc123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an empty string id (refinement: must be non-empty when present)", () => {
      const result = saleInputSchema.safeParse({
        ...validLinkedInput(),
        customerId: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("partyName", () => {
    it("rejects empty partyName", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.partyName).toContain(
          "Party name is required",
        );
      }
    });

    it("rejects whitespace-only partyName (trimmed before length check)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("rejects partyName > 200 chars", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "x".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 200-char partyName (boundary)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "x".repeat(200),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("partyPhone — empty-string-to-null", () => {
    it("transforms empty string to null", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.partyPhone).toBeNull();
    });

    it("preserves a non-empty phone", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "9876543210",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.partyPhone).toBe("9876543210");
    });

    it("rejects phone > 20 chars", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "1".repeat(21),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("itemDescription", () => {
    it("rejects empty", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        itemDescription: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects > 500 chars", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        itemDescription: "x".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("qty", () => {
    it("rejects zero", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        qty: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        qty: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer (e.g., 2.5)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        qty: 2.5,
      });
      expect(result.success).toBe(false);
    });

    it("accepts positive integer", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        qty: 1,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("rate — kept as number, NOT transformed to BigInt", () => {
    it("rejects negative rate", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        rate: -1,
      });
      expect(result.success).toBe(false);
    });

    it("accepts zero rate (promotional / free items)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        rate: 0,
      });
      expect(result.success).toBe(true);
    });

    it("output rate is plain number, NOT BigInt (wire format consistency)", () => {
      const result = saleInputSchema.safeParse(validWalkInInput());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.rate).toBe("number");
        expect(result.data.rate).toBe(250);
      }
    });
  });

  describe("discount", () => {
    it("defaults to 0 when omitted", () => {
      const input = validWalkInInput() as Partial<ReturnType<typeof validWalkInInput>>;
      delete input.discount;
      const result = saleInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.discount).toBe(0);
    });

    it("rejects negative discount", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        discount: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("notes — empty-string-to-null", () => {
    it("transforms empty string to null", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        notes: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBeNull();
    });

    it("rejects notes > 2000 chars", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        notes: "x".repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });
});
