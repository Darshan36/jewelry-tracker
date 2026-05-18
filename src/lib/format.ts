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
