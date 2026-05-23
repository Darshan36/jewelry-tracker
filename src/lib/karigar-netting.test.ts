// Phase 21b.1 — explicit netting test exercising the scenario the user
// originally tried (the bug that motivated this phase). Verifies that a
// direct karigar ledger entry (DECREASE — advance) nets against
// subsequent piece work (INCREASE) via the pure `computeOwnerBalance`
// helper. No allocation logic is needed — the running balance is the
// netting.
//
// The scenario:
//   1. Advance ₹6,000 via the direct ledger action → balance −6000_00p
//   2. Piece work 120 × ₹50 = ₹6,000 → balance 0p   (consumed)
//   3. Piece work 60 × ₹50 = ₹3,000 → balance +3000_00p
//   4. Opening-balance correction +₹2,000 → balance +5000_00p
//   5. Edit advance ₹6,000 → ₹4,000 → balance +7000_00p
//   6. Soft-delete advance → balance +11000_00p

import { describe, expect, it } from "vitest";

import { computeOwnerBalance } from "./ledger";

type LedgerSlice = {
  direction: "INCREASE" | "DECREASE";
  amount: bigint;
  deletedAt: Date | null;
};

describe("Karigar advance + work netting (computeOwnerBalance)", () => {
  it("advance DECREASE then matching INCREASE piece work nets to zero", () => {
    const entries: LedgerSlice[] = [
      // (1) Direct advance ₹6,000 → DECREASE
      {
        direction: "DECREASE",
        amount: 600000n,
        deletedAt: null,
      },
      // (2) Piece work 120 × ₹50 = ₹6,000 → INCREASE
      {
        direction: "INCREASE",
        amount: 600000n,
        deletedAt: null,
      },
    ];
    expect(computeOwnerBalance(entries)).toBe(0n);
  });

  it("advance then over-work leaves the karigar owed the excess", () => {
    const entries: LedgerSlice[] = [
      { direction: "DECREASE", amount: 600000n, deletedAt: null }, // advance 6000
      { direction: "INCREASE", amount: 600000n, deletedAt: null }, // work 6000
      { direction: "INCREASE", amount: 300000n, deletedAt: null }, // work 3000
    ];
    expect(computeOwnerBalance(entries)).toBe(300000n);
  });

  it("advance with no work yet shows credit (negative) balance", () => {
    const entries: LedgerSlice[] = [
      { direction: "DECREASE", amount: 600000n, deletedAt: null },
    ];
    expect(computeOwnerBalance(entries)).toBe(-600000n);
  });

  it("opening-balance INCREASE adds on top of existing net", () => {
    const entries: LedgerSlice[] = [
      { direction: "DECREASE", amount: 600000n, deletedAt: null }, // advance 6000
      { direction: "INCREASE", amount: 600000n, deletedAt: null }, // work 6000
      { direction: "INCREASE", amount: 300000n, deletedAt: null }, // work 3000
      { direction: "INCREASE", amount: 200000n, deletedAt: null }, // opening 2000
    ];
    expect(computeOwnerBalance(entries)).toBe(500000n);
  });

  it("soft-deleted advance no longer counts (delete restores work-only balance)", () => {
    const entries: LedgerSlice[] = [
      { direction: "DECREASE", amount: 600000n, deletedAt: new Date() }, // deleted advance
      { direction: "INCREASE", amount: 600000n, deletedAt: null }, // work 6000
      { direction: "INCREASE", amount: 300000n, deletedAt: null }, // work 3000
    ];
    expect(computeOwnerBalance(entries)).toBe(900000n);
  });

  it("the original user scenario reproduces correctly", () => {
    // What the user TRIED (broken — workaround as fake pieces):
    //   advance entered as INCREASE ₹6,000 → balance +6,000 (wrong direction)
    //   piece work +₹6,000 → balance +12,000 (advance never net against work)
    const buggy: LedgerSlice[] = [
      { direction: "INCREASE", amount: 600000n, deletedAt: null }, // fake piece "advance"
      { direction: "INCREASE", amount: 600000n, deletedAt: null }, // real work
    ];
    expect(computeOwnerBalance(buggy)).toBe(1200000n);

    // What the user EXPECTED (corrected — advance via direct ledger):
    //   advance DECREASE ₹6,000 → balance −6,000 (credit)
    //   piece work INCREASE ₹6,000 → balance 0 (advance consumed)
    const correct: LedgerSlice[] = [
      { direction: "DECREASE", amount: 600000n, deletedAt: null }, // advance
      { direction: "INCREASE", amount: 600000n, deletedAt: null }, // real work
    ];
    expect(computeOwnerBalance(correct)).toBe(0n);

    // The difference between buggy and correct is exactly 2 × the advance.
    // That was the user's visible bug.
    expect(computeOwnerBalance(buggy) - computeOwnerBalance(correct)).toBe(
      1200000n,
    );
  });
});
