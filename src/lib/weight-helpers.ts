// Weight × rate → line total arithmetic for the casting / plating
// workflow. The canonical entry point — every line-total computation in
// the app MUST funnel through this module so the rounding rule stays
// consistent.
//
// Shape decisions (locked Phase 9 — see KNOWN_GAPS):
//   - weight is `Decimal(10, 3)` kg (3 decimal places = gram precision)
//   - rate is `BigInt` paise per kg (matches the BigInt currency pattern)
//   - line total is `BigInt` paise, computed as weightKg × ratePerKg
//   - rounding is ROUND_HALF_EVEN (banker's rounding) — fewer cumulative
//     errors across many rounded-to-paise line totals than ROUND_HALF_UP
//
// Why Decimal.js instead of a homegrown integer-grams approach: the
// workflow speaks kg, the UI accepts kg, the DB stores kg. Converting
// to grams in the schema would force an awkward unit translation at
// every read AND lose the natural decimal precision. Decimal.js handles
// the arithmetic exactly, and the gram-precision constraint is enforced
// by the Postgres column type itself.

import { Decimal } from "decimal.js";

// Configure once globally for the module. ROUND_HALF_EVEN is Decimal.js's
// rounding mode 6 — when the discarded fraction is exactly 0.5, round to
// the nearest even digit. Banker's rounding.
Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });

/**
 * Compute a single line-item total in paise.
 *
 * weightKg × ratePerKg, rounded to the nearest paise via ROUND_HALF_EVEN.
 *
 * Example: 1.875 kg × ₹350/kg = 1.875 × 35000 paise = 65625 paise (₹656.25).
 */
export function computeLineTotal(weightKg: Decimal, ratePerKg: bigint): bigint {
  const result = weightKg
    .mul(ratePerKg.toString())
    .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return BigInt(result.toString());
}

/**
 * Parse user input (from a form field or wire string) into a Decimal kg
 * value. Accepts:
 *   - bare numbers ("2.5", "1.875")
 *   - whitespace-trimmed strings
 *   - already-Decimal-shaped objects (passthrough)
 *
 * Throws via Decimal's constructor on unparseable input. Callers should
 * validate at the zod schema layer before calling this — schema's
 * `z.number().nonnegative()` catches negatives, NaN, Infinity.
 */
export function kgFromInput(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") return new Decimal(value);
  return new Decimal(value.trim());
}

/**
 * Format a Decimal kg value for display with 3 decimal places. The DB
 * column is `Decimal(10, 3)` so this never widens; the formatter pads
 * trailing zeros so "2.5" renders as "2.500" for visual consistency
 * with the gram-precision contract.
 */
export function formatKg(value: Decimal | string | number): string {
  const d = value instanceof Decimal ? value : new Decimal(value);
  return d.toFixed(3);
}
