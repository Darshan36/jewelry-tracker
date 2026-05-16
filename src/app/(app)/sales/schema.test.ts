import { describe, expect, it } from "vitest";

import { saleInputSchema } from "./schema";

function validLineItem() {
  return {
    itemDescription: "Gold-plated chain",
    qty: 10,
    rate: 250,
  };
}

function validWalkInInput() {
  return {
    date: "2026-05-14",
    customerId: null,
    partyName: "Test Walkin",
    partyPhone: "9876543210",
    lineItems: [validLineItem()],
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
    lineItems: [validLineItem()],
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
        lineItems: [{ itemDescription: "x", qty: 1, rate: 100 }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discount).toBe(0);
        expect(result.data.notes).toBeNull();
        expect(result.data.partyPhone).toBeNull();
      }
    });

    it("accepts multiple line items", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [
          { itemDescription: "Item A", qty: 3, rate: 100 },
          { itemDescription: "Item B", qty: 5, rate: 200 },
          { itemDescription: "Item C", qty: 1, rate: 50 },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lineItems).toHaveLength(3);
        expect(result.data.lineItems[1].itemDescription).toBe("Item B");
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

  describe("partyPhone — empty-string-to-null + normalization", () => {
    it("transforms empty string to null", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.partyPhone).toBeNull();
    });

    it("preserves a non-empty phone, normalised (Phase 6)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "9876543210",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.partyPhone).toBe("9876543210");
    });

    it("normalises dashed phone (Phase 6)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "9876-543-210",
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

  // ===================================================================
  // Phase 7 — line items array replaces single-item top-level fields.
  // ===================================================================

  describe("lineItems — array, at least one row required", () => {
    it("rejects empty array", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const flat = result.error.flatten();
        expect(flat.fieldErrors.lineItems?.[0]).toMatch(/at least one/i);
      }
    });

    it("rejects missing lineItems field", () => {
      const input = validWalkInInput() as Partial<
        ReturnType<typeof validWalkInInput>
      >;
      delete input.lineItems;
      const result = saleInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts one line item", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [validLineItem()],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("line item — itemDescription", () => {
    it("rejects empty itemDescription", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), itemDescription: "" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects whitespace-only itemDescription (trimmed before length check)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), itemDescription: "   " }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects itemDescription > 500 chars", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), itemDescription: "x".repeat(501) }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("line item — qty", () => {
    it("rejects zero", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: 0 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: -1 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer (e.g., 2.5)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: 2.5 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts positive integer", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: 1 }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("line item — rate (kept as number, NOT transformed to BigInt)", () => {
    it("rejects negative rate", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), rate: -1 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts zero rate (promotional / free items)", () => {
      const result = saleInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), rate: 0 }],
      });
      expect(result.success).toBe(true);
    });

    it("output rate stays plain number (wire format consistency)", () => {
      const result = saleInputSchema.safeParse(validWalkInInput());
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.lineItems[0].rate).toBe("number");
        expect(result.data.lineItems[0].rate).toBe(250);
      }
    });
  });

  describe("discount", () => {
    it("defaults to 0 when omitted", () => {
      const input = validWalkInInput() as Partial<
        ReturnType<typeof validWalkInInput>
      >;
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
