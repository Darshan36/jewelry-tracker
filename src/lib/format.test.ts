import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  currentIstYearMonth,
  endOfCurrentMonthIST,
  endOfMonthIST,
  formatCurrency,
  formatDate,
  formatMonthIST,
  monthIsoIST,
  startOfCurrentMonthIST,
  startOfMonthIST,
  todayIsoIST,
} from "./format";

// Pure / non-time-pinned tests — these don't need fake timers.

describe("formatCurrency", () => {
  it("renders 0 paise as ₹0.00", () => {
    expect(formatCurrency(0)).toMatch(/0\.00/);
  });

  it("renders null as em-dash", () => {
    expect(formatCurrency(null)).toBe("—");
  });

  it("renders Indian comma grouping", () => {
    // 1,23,456.78 — paise = 12345678
    const out = formatCurrency(12345678);
    expect(out).toMatch(/1,23,456\.78/);
  });
});

describe("formatDate", () => {
  it("renders null as em-dash", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("renders a date in IST", () => {
    const out = formatDate(new Date("2026-05-19T00:00:00Z"));
    expect(out).toMatch(/19 May 2026/);
  });
});

// Tests below are time-pinned (we control "now" via vi.useFakeTimers).

describe("IST month helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-05-19 10:00 UTC = 2026-05-19 15:30 IST.
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("todayIsoIST returns the IST calendar day", () => {
    expect(todayIsoIST()).toBe("2026-05-19");
  });

  it("currentIstYearMonth returns 1-indexed month", () => {
    expect(currentIstYearMonth()).toEqual({ year: 2026, month: 5 });
  });

  it("startOfMonthIST returns midnight-UTC on day 1 of that month", () => {
    expect(startOfMonthIST(2026, 5)).toEqual(new Date("2026-05-01T00:00:00Z"));
  });

  it("endOfMonthIST returns midnight-UTC on day 1 of the NEXT month (exclusive)", () => {
    expect(endOfMonthIST(2026, 5)).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("endOfMonthIST handles December → next-year January", () => {
    expect(endOfMonthIST(2026, 12)).toEqual(new Date("2027-01-01T00:00:00Z"));
  });

  it("startOfCurrentMonthIST uses the IST-resolved current month", () => {
    expect(startOfCurrentMonthIST()).toEqual(
      new Date("2026-05-01T00:00:00Z"),
    );
  });

  it("endOfCurrentMonthIST uses the IST-resolved current month", () => {
    expect(endOfCurrentMonthIST()).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("formatMonthIST returns 'MonthName YYYY' label for a midnight-UTC date", () => {
    expect(formatMonthIST(new Date("2026-05-01T00:00:00Z"))).toBe("May 2026");
  });

  it("formatMonthIST reflects the IST calendar day for moments near UTC midnight", () => {
    // 2026-05-31 19:30 UTC = 2026-06-01 01:00 IST. The label should be "June".
    expect(formatMonthIST(new Date("2026-05-31T19:30:00Z"))).toBe("June 2026");
  });

  it("monthIsoIST returns YYYY-MM string", () => {
    expect(monthIsoIST(new Date("2026-05-19T00:00:00Z"))).toBe("2026-05");
  });

  it("monthIsoIST returns current month when value is null/undefined", () => {
    expect(monthIsoIST(null)).toBe("2026-05");
    expect(monthIsoIST(undefined)).toBe("2026-05");
  });
});

// Date-line crossing — IST is UTC+5:30, so a UTC midnight on May 19 is
// May 19 at 05:30 IST. A UTC time of 18:30 on May 18 is also May 19 in
// IST. This test verifies the helper resolves the IST calendar day
// correctly across the IST-midnight boundary.
describe("IST helpers across the date-line", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("18:30 UTC on May 18 ≡ 00:00 IST on May 19", () => {
    vi.setSystemTime(new Date("2026-05-18T18:30:00Z"));
    expect(todayIsoIST()).toBe("2026-05-19");
  });

  it("18:29 UTC on May 18 ≡ 23:59 IST on May 18 (still May 18)", () => {
    vi.setSystemTime(new Date("2026-05-18T18:29:00Z"));
    expect(todayIsoIST()).toBe("2026-05-18");
  });
});
