import { describe, expect, it } from "vitest";

import {
  bulkPieceEntryInputSchema,
  employeePaymentInputSchema,
  pieceEntryInputSchema,
} from "./schema";

describe("bulkPieceEntryInputSchema", () => {
  it("accepts a valid bulk submission", () => {
    const result = bulkPieceEntryInputSchema.safeParse({
      date: "2026-05-19",
      entries: [
        { employeeId: "e1", count: 5, ratePerPiece: 50 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty entries array", () => {
    const result = bulkPieceEntryInputSchema.safeParse({
      date: "2026-05-19",
      entries: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative count", () => {
    const result = bulkPieceEntryInputSchema.safeParse({
      date: "2026-05-19",
      entries: [{ employeeId: "e1", count: -1, ratePerPiece: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero count", () => {
    const result = bulkPieceEntryInputSchema.safeParse({
      date: "2026-05-19",
      entries: [{ employeeId: "e1", count: 0, ratePerPiece: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer count", () => {
    const result = bulkPieceEntryInputSchema.safeParse({
      date: "2026-05-19",
      entries: [{ employeeId: "e1", count: 5.5, ratePerPiece: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts rate of zero (free piece work)", () => {
    const result = bulkPieceEntryInputSchema.safeParse({
      date: "2026-05-19",
      entries: [{ employeeId: "e1", count: 5, ratePerPiece: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative rate", () => {
    const result = bulkPieceEntryInputSchema.safeParse({
      date: "2026-05-19",
      entries: [{ employeeId: "e1", count: 5, ratePerPiece: -1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("pieceEntryInputSchema (single)", () => {
  it("accepts a valid input", () => {
    const result = pieceEntryInputSchema.safeParse({
      employeeId: "e1",
      date: "2026-05-19",
      count: 5,
      ratePerPiece: 50,
      note: "Extra hours",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBe("Extra hours");
  });

  it("transforms empty note to null", () => {
    const result = pieceEntryInputSchema.safeParse({
      employeeId: "e1",
      date: "2026-05-19",
      count: 5,
      ratePerPiece: 50,
      note: "",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.note).toBeNull();
  });
});

describe("employeePaymentInputSchema", () => {
  const valid = {
    employeeId: "e1",
    type: "SALARY" as const,
    paidAt: "2026-05-19",
    amount: 15000,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    note: null,
  };

  it("accepts a valid SALARY input", () => {
    const result = employeePaymentInputSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts a valid WAGE input", () => {
    const result = employeePaymentInputSchema.safeParse({
      ...valid,
      type: "WAGE",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown type", () => {
    const result = employeePaymentInputSchema.safeParse({
      ...valid,
      type: "BONUS",
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero amount", () => {
    const result = employeePaymentInputSchema.safeParse({
      ...valid,
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = employeePaymentInputSchema.safeParse({
      ...valid,
      amount: -100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects periodEnd before periodStart", () => {
    const result = employeePaymentInputSchema.safeParse({
      ...valid,
      periodStart: "2026-05-31",
      periodEnd: "2026-05-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.flatten().fieldErrors;
      expect(flat.periodEnd).toBeDefined();
    }
  });

  it("accepts periodEnd equal to periodStart (single-day pay period)", () => {
    const result = employeePaymentInputSchema.safeParse({
      ...valid,
      periodStart: "2026-05-19",
      periodEnd: "2026-05-19",
    });
    expect(result.success).toBe(true);
  });
});
