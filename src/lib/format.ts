// Display formatters — keep formatting decisions out of components and pages.
//
// Currency: store as integer paise (1 ₹ = 100 paise); render with Indian
// comma grouping via Intl.NumberFormat('en-IN', { style: 'currency', ... }).
// Date: store UTC `timestamp(3)` in DB; render in the locale-default
// medium-precision format. Asia/Kolkata conversion happens naturally because
// the user's browser is in IST — `new Date(utcString)` parses the UTC value
// and `date-fns format` renders in the local time zone.
//
// Display formatters return "—" for null/undefined so callers can pass
// straight-through without null-handling at each call site.

import { format } from "date-fns";

export function formatDate(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "d MMM yyyy");
}

export function formatDateTime(
  value: Date | string | null | undefined,
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "d MMM yyyy, h:mm a");
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
