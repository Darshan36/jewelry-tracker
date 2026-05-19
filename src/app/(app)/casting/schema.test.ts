import { describe, expect, it } from "vitest";

import {
  castingEntryInputSchema,
  castingLineItemSchema,
} from "./schema";

function validLine() {
  return {
    materialDescription: "Brass",
    weightKg: 2.5,
    ratePerKg: 400,
  };
}

function validInput() {
  return {
    date: new Date("2026-05-17T00:00:00Z"),
    vendorId: null as string | null,
    partyName: "Mahesh Casting Works",
    partyPhone: "9876543210",
    lineItems: [validLine()],
    discount: 0,
    attachmentId: null as string | null,
    notes: "",
  };
}

describe("castingLineItemSchema", () => {
  it("accepts a valid line item", () => {
    const result = castingLineItemSchema.safeParse(validLine());
    expect(result.success).toBe(true);
  });

  it("rejects empty materialDescription", () => {
    const result = castingLineItemSchema.safeParse({
      ...validLine(),
      materialDescription: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative weight", () => {
    const result = castingLineItemSchema.safeParse({
      ...validLine(),
      weightKg: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero weight (must be > 0)", () => {
    const result = castingLineItemSchema.safeParse({
      ...validLine(),
      weightKg: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative rate", () => {
    const result = castingLineItemSchema.safeParse({
      ...validLine(),
      ratePerKg: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts zero rate (free outsourcing edge case)", () => {
    const result = castingLineItemSchema.safeParse({
      ...validLine(),
      ratePerKg: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts 3-decimal gram-precision weight", () => {
    const result = castingLineItemSchema.safeParse({
      ...validLine(),
      weightKg: 1.875,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.weightKg).toBe(1.875);
  });
});

describe("castingEntryInputSchema — top level", () => {
  it("accepts a valid input with one line item", () => {
    const result = castingEntryInputSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it("rejects an empty lineItems array (min 1)", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      lineItems: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts multiple line items", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      lineItems: [
        validLine(),
        { materialDescription: "Aluminium", weightKg: 1.875, ratePerKg: 350 },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.lineItems).toHaveLength(2);
  });

  it("rejects missing partyName", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      partyName: "",
    });
    expect(result.success).toBe(false);
  });

  it("normalises partyPhone via normalizePhone", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      partyPhone: "(987) 654-3210",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.partyPhone).toBe("9876543210");
  });

  it("transforms empty partyPhone to null", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      partyPhone: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.partyPhone).toBeNull();
  });

  it("rejects negative discount", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      discount: -1,
    });
    expect(result.success).toBe(false);
  });

  it("defaults discount to 0 when omitted", () => {
    const { discount: _omit, ...rest } = validInput();
    const result = castingEntryInputSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.discount).toBe(0);
  });

  it("coerces date from YYYY-MM-DD string", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      date: "2026-05-17",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.date).toBeInstanceOf(Date);
  });

  it("transforms empty billId to null", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      attachmentId: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attachmentId).toBeNull();
  });

  it("preserves a valid billId string", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      attachmentId: "bill-cuid-123",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attachmentId).toBe("bill-cuid-123");
  });

  it("transforms empty notes to null", () => {
    const result = castingEntryInputSchema.safeParse({
      ...validInput(),
      notes: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notes).toBeNull();
  });
});
