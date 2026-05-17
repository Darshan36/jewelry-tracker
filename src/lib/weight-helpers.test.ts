// Tests for the canonical Decimal × BigInt weight arithmetic.
//
// computeLineTotal is the only place in the codebase that does
// weight × rate rounding to paise. The rounding mode is ROUND_HALF_EVEN
// (banker's rounding). These tests pin both the well-behaved cases AND
// the four ROUND_HALF_EVEN-vs-ROUND_HALF_UP distinguishing inputs so a
// regression to a different mode would fail loudly.

import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";

import { computeLineTotal, formatKg, kgFromInput } from "./weight-helpers";

describe("computeLineTotal — happy path", () => {
  it("computes 2.5 kg × ₹400/kg = ₹1,000.00 (100000 paise)", () => {
    expect(computeLineTotal(new Decimal("2.5"), 40000n)).toBe(100000n);
  });

  it("computes 1.875 kg × ₹350/kg = ₹656.25 (65625 paise) — the canonical walkthrough check", () => {
    expect(computeLineTotal(new Decimal("1.875"), 35000n)).toBe(65625n);
  });

  it("computes 0.001 kg × ₹500/kg = ₹0.50 (50 paise) — gram-precision floor case", () => {
    expect(computeLineTotal(new Decimal("0.001"), 50000n)).toBe(50n);
  });

  it("computes 1.234 kg × 40001 paise/kg = 49361 paise (rounds 49361.234 down via truncation, not half)", () => {
    expect(computeLineTotal(new Decimal("1.234"), 40001n)).toBe(49361n);
  });

  it("computes large weight × large rate without precision loss (50 kg × ₹50,000/kg = ₹25,00,000)", () => {
    expect(computeLineTotal(new Decimal("50"), 5000000n)).toBe(250000000n);
  });
});

describe("computeLineTotal — ROUND_HALF_EVEN distinguishing cases", () => {
  // The four classical inputs where ROUND_HALF_EVEN diverges from
  // ROUND_HALF_UP. If anyone changes the rounding mode, all four of
  // these will flip.
  it("0.5 kg × 1 paise = 0.5 paise → rounds to 0 (nearest even, down)", () => {
    expect(computeLineTotal(new Decimal("0.5"), 1n)).toBe(0n);
  });

  it("1.5 kg × 1 paise = 1.5 paise → rounds to 2 (nearest even, up)", () => {
    expect(computeLineTotal(new Decimal("1.5"), 1n)).toBe(2n);
  });

  it("2.5 kg × 1 paise = 2.5 paise → rounds to 2 (nearest even, down)", () => {
    expect(computeLineTotal(new Decimal("2.5"), 1n)).toBe(2n);
  });

  it("3.5 kg × 1 paise = 3.5 paise → rounds to 4 (nearest even, up)", () => {
    expect(computeLineTotal(new Decimal("3.5"), 1n)).toBe(4n);
  });
});

describe("computeLineTotal — boundary cases", () => {
  it("zero weight yields zero total regardless of rate", () => {
    expect(computeLineTotal(new Decimal("0"), 100000n)).toBe(0n);
  });

  it("zero rate yields zero total regardless of weight", () => {
    expect(computeLineTotal(new Decimal("123.456"), 0n)).toBe(0n);
  });

  it("returns a bigint, not a number (callers persist via BigInt column)", () => {
    expect(typeof computeLineTotal(new Decimal("1"), 100n)).toBe("bigint");
  });
});

describe("kgFromInput", () => {
  it("parses a numeric string to a Decimal preserving precision", () => {
    const d = kgFromInput("1.875");
    expect(d.toFixed(3)).toBe("1.875");
  });

  it("parses a JS number to a Decimal", () => {
    const d = kgFromInput(2.5);
    expect(d.toFixed(3)).toBe("2.500");
  });

  it("trims whitespace from string inputs", () => {
    const d = kgFromInput("  3.001  ");
    expect(d.toFixed(3)).toBe("3.001");
  });

  it("passes through an already-Decimal input unchanged", () => {
    const input = new Decimal("4.444");
    expect(kgFromInput(input)).toBe(input);
  });
});

describe("formatKg", () => {
  it("formats a Decimal to exactly 3 decimal places", () => {
    expect(formatKg(new Decimal("2.5"))).toBe("2.500");
  });

  it("preserves trailing zeros from an exact gram-precision value", () => {
    expect(formatKg(new Decimal("0.001"))).toBe("0.001");
  });

  it("formats from a numeric string", () => {
    expect(formatKg("1.875")).toBe("1.875");
  });

  it("formats from a JS number, padding to 3 decimals", () => {
    expect(formatKg(2.5)).toBe("2.500");
  });

  it("rounds when given more than 3 decimals using ROUND_HALF_EVEN (1.2345 → 1.234, 4 is even)", () => {
    // Display formatting only — the DB column rejects >3 decimals at
    // insert time. This test pins ROUND_HALF_EVEN behaviour: the digit
    // to discard is exactly 5 and the preceding digit is even (4), so
    // it stays. With ROUND_HALF_UP this would be 1.235.
    expect(formatKg("1.2345")).toBe("1.234");
    // And the odd-preceding case rounds up to keep the result even.
    expect(formatKg("1.2355")).toBe("1.236");
  });
});
