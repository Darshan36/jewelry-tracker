// Phase 21a + 21a.1 — schema tests for the party-ledger payment actions.

import { describe, expect, it } from "vitest";

import {
  createLedgerPaymentSchema,
  updateLedgerPaymentSchema,
} from "./ledger-schema";

describe("createLedgerPaymentSchema", () => {
  const validBase = {
    partyId: "party-1",
    date: new Date("2026-05-22T00:00:00Z"),
    amount: 100,
    description: "UPI",
  };

  it("accepts a valid input", () => {
    const result = createLedgerPaymentSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it("rejects empty partyId", () => {
    const r = createLedgerPaymentSchema.safeParse({ ...validBase, partyId: "" });
    expect(r.success).toBe(false);
  });

  it("rejects amount <= 0", () => {
    expect(
      createLedgerPaymentSchema.safeParse({ ...validBase, amount: 0 }).success,
    ).toBe(false);
    expect(
      createLedgerPaymentSchema.safeParse({ ...validBase, amount: -10 }).success,
    ).toBe(false);
  });

  it("normalizes empty/whitespace description → null", () => {
    const empty = createLedgerPaymentSchema.safeParse({
      ...validBase,
      description: "",
    });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.description).toBeNull();

    const ws = createLedgerPaymentSchema.safeParse({
      ...validBase,
      description: "   ",
    });
    expect(ws.success).toBe(true);
    if (ws.success) expect(ws.data.description).toBeNull();
  });
});

describe("updateLedgerPaymentSchema (Phase 21a.1)", () => {
  const validBase = {
    id: "entry-1",
    date: new Date("2026-05-22T00:00:00Z"),
    amount: 200,
    description: "Adjusted",
  };

  it("accepts a valid input", () => {
    expect(updateLedgerPaymentSchema.safeParse(validBase).success).toBe(true);
  });

  it("requires id", () => {
    expect(
      updateLedgerPaymentSchema.safeParse({ ...validBase, id: "" }).success,
    ).toBe(false);
  });

  it("rejects amount <= 0", () => {
    expect(
      updateLedgerPaymentSchema.safeParse({ ...validBase, amount: 0 }).success,
    ).toBe(false);
    expect(
      updateLedgerPaymentSchema.safeParse({ ...validBase, amount: -1 }).success,
    ).toBe(false);
  });

  it("normalizes empty description → null", () => {
    const r = updateLedgerPaymentSchema.safeParse({
      ...validBase,
      description: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeNull();
  });

  it("coerces ISO-string date to Date", () => {
    const r = updateLedgerPaymentSchema.safeParse({
      ...validBase,
      date: "2026-06-01",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date).toBeInstanceOf(Date);
  });
});
