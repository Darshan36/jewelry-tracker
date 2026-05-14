import { describe, expect, it } from "vitest";

import { computeSaleStatus } from "./sale-status";

describe("computeSaleStatus", () => {
  it("returns 'pending' when no payments and no returns", () => {
    expect(computeSaleStatus({ total: 2400_00n })).toBe("pending");
  });

  it("returns 'pending' when paidAmount and returnTotal are both explicitly 0n", () => {
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 0n,
        returnTotal: 0n,
      }),
    ).toBe("pending");
  });

  it("returns 'partial' when some payment recorded but balance > 0", () => {
    // total 2400, paid 1000 → balance 1400 → partial
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 1000_00n,
      }),
    ).toBe("partial");
  });

  it("returns 'completed' when paidAmount fully covers effective total", () => {
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 2400_00n,
      }),
    ).toBe("completed");
  });

  it("returns 'refund_due' when balance is negative (overpaid or returns exceed paid)", () => {
    // total 2400, paid 3000 → balance -600 → refund_due
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 3000_00n,
      }),
    ).toBe("refund_due");
  });

  // Phase 3.2: explicit boundary tests for the partial/completed transition.
  // Action layer blocks paidAmount > total, so these cover the realistic
  // operating range exactly: 1 paise short, exact match, very small paid.

  it("returns 'partial' when paidAmount is exactly 1 paise less than total", () => {
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 2400_00n - 1n,
      }),
    ).toBe("partial");
  });

  it("returns 'completed' when paidAmount exactly equals total (exact-equality boundary)", () => {
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 2400_00n,
      }),
    ).toBe("completed");
  });

  it("returns 'partial' for a very small payment (1 paise) against a large total", () => {
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 1n,
      }),
    ).toBe("partial");
  });

  it("returns 'pending' for a zero-total sale (degenerate but defined)", () => {
    expect(computeSaleStatus({ total: 0n })).toBe("pending");
  });

  it("subtracts returnTotal from effective total before computing balance", () => {
    // total 2400, return 400, paid 2000 → effectiveTotal 2000, balance 0 → completed
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 2000_00n,
        returnTotal: 400_00n,
      }),
    ).toBe("completed");
  });

  it("returns 'refund_due' when returns alone make balance negative without payment", () => {
    // Phase 3.3 case: total 2400, return 3000, paid 0 → balance -600 → refund_due
    expect(
      computeSaleStatus({
        total: 2400_00n,
        paidAmount: 0n,
        returnTotal: 3000_00n,
      }),
    ).toBe("refund_due");
  });
});
