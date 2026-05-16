import { describe, expect, it } from "vitest";

import { purchaseInputSchema } from "./schema";

function validLineItem() {
  return {
    itemDescription: "Raw gold-plated wire",
    qty: 10,
    rate: 250,
  };
}

function validWalkInInput() {
  return {
    date: "2026-05-14",
    supplierId: null,
    partyName: "Test Walkin Vendor",
    partyPhone: "9876543210",
    lineItems: [validLineItem()],
    discount: 100,
    notes: "Test purchase",
  };
}

function validLinkedInput() {
  return {
    date: "2026-05-14",
    supplierId: "cuid_supplier_123",
    partyName: "Acme Metals",
    partyPhone: "9876543210",
    lineItems: [validLineItem()],
    discount: 100,
    notes: null,
  };
}

describe("purchaseInputSchema", () => {
  describe("happy path", () => {
    it("accepts a valid walk-in input (supplierId null)", () => {
      const result = purchaseInputSchema.safeParse(validWalkInInput());
      expect(result.success).toBe(true);
    });

    it("accepts a valid linked-supplier input (supplierId provided)", () => {
      const result = purchaseInputSchema.safeParse(validLinkedInput());
      expect(result.success).toBe(true);
    });

    it("accepts the minimal input (discount/notes omitted) and applies defaults", () => {
      const result = purchaseInputSchema.safeParse({
        date: "2026-05-14",
        supplierId: null,
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
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [
          { itemDescription: "Item A", qty: 3, rate: 100 },
          { itemDescription: "Item B", qty: 5, rate: 200 },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lineItems).toHaveLength(2);
      }
    });
  });

  describe("date — z.coerce.date()", () => {
    it("coerces YYYY-MM-DD string to a Date instance", () => {
      const result = purchaseInputSchema.safeParse(validWalkInInput());
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.date).toBeInstanceOf(Date);
    });

    it("accepts an existing Date instance", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        date: new Date("2026-05-14T00:00:00Z"),
      });
      expect(result.success).toBe(true);
    });

    it("rejects an empty string", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        date: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-date string", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        date: "not-a-date-at-all",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("supplierId", () => {
    it("accepts null (walk-in mode)", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        supplierId: null,
      });
      expect(result.success).toBe(true);
    });

    it("accepts a non-empty string id (linked mode)", () => {
      const result = purchaseInputSchema.safeParse({
        ...validLinkedInput(),
        supplierId: "cuid_abc123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an empty string id", () => {
      const result = purchaseInputSchema.safeParse({
        ...validLinkedInput(),
        supplierId: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("partyName", () => {
    it("rejects empty partyName", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects whitespace-only partyName", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "   ",
      });
      expect(result.success).toBe(false);
    });

    it("rejects partyName > 200 chars", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "x".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 200-char partyName (boundary)", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyName: "x".repeat(200),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("partyPhone — empty-string-to-null + normalization", () => {
    it("transforms empty string to null", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.partyPhone).toBeNull();
    });

    it("preserves a non-empty phone, normalised", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "9876543210",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.partyPhone).toBe("9876543210");
    });

    it("normalises dashed phone", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "9876-543-210",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.partyPhone).toBe("9876543210");
    });

    it("rejects phone > 20 chars", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        partyPhone: "1".repeat(21),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("lineItems — array, at least one row required", () => {
    it("rejects empty array", () => {
      const result = purchaseInputSchema.safeParse({
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
      const result = purchaseInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("accepts one line item", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [validLineItem()],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("line item — itemDescription", () => {
    it("rejects empty itemDescription", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), itemDescription: "" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects whitespace-only itemDescription", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), itemDescription: "   " }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects itemDescription > 500 chars", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), itemDescription: "x".repeat(501) }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("line item — qty", () => {
    it("rejects zero", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: 0 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: -1 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer (e.g., 2.5)", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: 2.5 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts positive integer", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), qty: 1 }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("line item — rate (kept as number, NOT transformed to BigInt)", () => {
    it("rejects negative rate", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), rate: -1 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts zero rate", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        lineItems: [{ ...validLineItem(), rate: 0 }],
      });
      expect(result.success).toBe(true);
    });

    it("output rate stays plain number (wire format consistency)", () => {
      const result = purchaseInputSchema.safeParse(validWalkInInput());
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
      const result = purchaseInputSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.discount).toBe(0);
    });

    it("rejects negative discount", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        discount: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("notes — empty-string-to-null", () => {
    it("transforms empty string to null", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        notes: "",
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.notes).toBeNull();
    });

    it("rejects notes > 2000 chars", () => {
      const result = purchaseInputSchema.safeParse({
        ...validWalkInInput(),
        notes: "x".repeat(2001),
      });
      expect(result.success).toBe(false);
    });
  });
});
