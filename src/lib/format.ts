// Display formatters — keep formatting decisions out of components and pages.
//
// Currency: store as integer paise (1 ₹ = 100 paise); render with Indian
// comma grouping via Intl.NumberFormat('en-IN', { style: 'currency', ... }).
// Date: store UTC `timestamp(3)` in DB; render in Asia/Kolkata via
// `Intl.DateTimeFormat` with an explicit `timeZone` so the output is
// deterministic on both server (UTC) and client (IST). Without the pin,
// `date-fns format` rendered in the local TZ — producing "19 May" on the
// server and "20 May" on the client for dates that crossed the IST date
// boundary, which tripped React hydration mismatches (see KNOWN_GAPS).
//
// Display formatters return "—" for null/undefined so callers can pass
// straight-through without null-handling at each call site.

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// "YYYY-MM-DD" for the calendar day at the given moment in Asia/Kolkata.
// Reads the wall-clock day in IST regardless of where the code runs — server
// (UTC) and client (IST) produce the same string for the same moment, so
// using this for an `<input type="date">` defaultValue won't trigger a
// hydration mismatch the way `new Date().getDate()` does near UTC midnight.
const ISO_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function todayIsoIST(): string {
  return ISO_DAY_FORMATTER.format(new Date());
}

export function dateToIsoIST(
  value: Date | string | null | undefined,
): string {
  if (!value) return todayIsoIST();
  const date = typeof value === "string" ? new Date(value) : value;
  if (isNaN(date.getTime())) return todayIsoIST();
  return ISO_DAY_FORMATTER.format(date);
}

// Phase 18 — IST month helpers for the labour pages.
//
// Convention: a "calendar month in IST" is represented as a half-open
// UTC range [startUTC, endUTC) where startUTC is midnight UTC on the
// 1st of that month (matching how Sale/Purchase store their `date`
// field — see CLAUDE.md §4). This keeps the existing dashboard's
// currentMonthRange() compatible with PieceEntry/EmployeePayment
// queries: SELECT WHERE date >= startUTC AND date < endUTC gives every
// row whose IST-calendar-day falls in the named month.
//
// "1-indexed" month input matches the way humans speak (May = 5).

/** Returns { year: 2026, month: 5 } for the current IST date. */
export function currentIstYearMonth(): { year: number; month: number } {
  const iso = todayIsoIST(); // "2026-05-19"
  const [y, m] = iso.split("-");
  return { year: Number(y), month: Number(m) };
}

/** Midnight UTC on day 1 of the given (year, month-1-indexed). */
export function startOfMonthIST(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Midnight UTC on day 1 of the *next* month — exclusive upper bound. */
export function endOfMonthIST(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 1));
}

export function startOfCurrentMonthIST(): Date {
  const { year, month } = currentIstYearMonth();
  return startOfMonthIST(year, month);
}

export function endOfCurrentMonthIST(): Date {
  const { year, month } = currentIstYearMonth();
  return endOfMonthIST(year, month);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "May 2026" — derives the month label from the *IST* calendar day. */
export function formatMonthIST(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const iso = ISO_DAY_FORMATTER.format(date); // "2026-05-19"
  const [y, m] = iso.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/** "YYYY-MM" for the IST calendar month of the given moment. */
export function monthIsoIST(value: Date | string | null | undefined): string {
  if (!value) {
    const { year, month } = currentIstYearMonth();
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (isNaN(date.getTime())) {
    const { year, month } = currentIstYearMonth();
    return `${year}-${String(month).padStart(2, "0")}`;
  }
  const iso = ISO_DAY_FORMATTER.format(date); // "2026-05-19"
  return iso.slice(0, 7);
}

export function formatDate(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return DATE_FORMATTER.format(date);
}

export function formatDateTime(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  // "1:30 pm" (lowercase) to match the prior date-fns output. Intl's
  // dayPeriod renders as "am"/"pm" already lowercase in en-GB.
  return `${DATE_FORMATTER.format(date)}, ${TIME_FORMATTER.format(date)}`;
}

// paise (integer) → ₹ with Indian comma grouping. Used from Phase 3 onward
// where Sale/Purchase rows track money. Phase 2.1 doesn't render currency.
export function formatCurrency(
  paise: number | null | undefined,
): string {
  if (paise == null) return "—";
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(rupees);
}
