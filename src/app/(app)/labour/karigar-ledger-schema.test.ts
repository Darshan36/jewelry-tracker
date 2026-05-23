import { describe, expect, it } from "vitest";

import {
  createKarigarLedgerEntrySchema,
  updateKarigarLedgerEntrySchema,
} from "./karigar-ledger-schema";

describe("createKarigarLedgerEntrySchema", () => {
  function validInput() {
    return {
      employeeId: "lab1",
      date: new Date("2026-05-23T00:00:00Z"),
      amount: 6000,
      direction: "DECREASE" as const,
      description: "advance for next week",
    };
  }

  it("accepts valid DECREASE input", () => {
    const result = createKarigarLedgerEntrySchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it("accepts valid INCREASE input", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      direction: "INCREASE",
      description: "opening balance — prior work",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty description (required for legibility)", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only description", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      description: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("trims surrounding whitespace from the description", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      description: "  advance  ",
    });
    if (!result.success) throw new Error("expected success");
    expect(result.data.description).toBe("advance");
  });

  it("rejects amount = 0", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      amount: -500,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid direction value", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      direction: "BOTH" as any,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty employeeId", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      employeeId: "",
    });
    expect(result.success).toBe(false);
  });

  it("coerces ISO date string to Date", () => {
    const result = createKarigarLedgerEntrySchema.safeParse({
      ...validInput(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      date: "2026-05-23" as any,
    });
    if (!result.success) throw new Error("expected success");
    expect(result.data.date).toBeInstanceOf(Date);
  });
});

describe("updateKarigarLedgerEntrySchema", () => {
  it("accepts valid update payload", () => {
    const result = updateKarigarLedgerEntrySchema.safeParse({
      id: "le-1",
      date: new Date("2026-05-23T00:00:00Z"),
      amount: 4000,
      direction: "DECREASE",
      description: "advance — reduced",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = updateKarigarLedgerEntrySchema.safeParse({
      id: "",
      date: new Date(),
      amount: 100,
      direction: "DECREASE",
      description: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty description on update too", () => {
    const result = updateKarigarLedgerEntrySchema.safeParse({
      id: "le-1",
      date: new Date(),
      amount: 100,
      direction: "DECREASE",
      description: "",
    });
    expect(result.success).toBe(false);
  });
});
