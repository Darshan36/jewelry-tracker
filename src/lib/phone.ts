// Phone normalization for storage and lookup.
//
// Strips whitespace, dashes, and parentheses. Returns null for empty input.
// Idempotent — running normalization on an already-clean phone is a no-op.
// Does NOT validate format (Indian vs international) — the schema's max-length
// (20) is the only gate. Treats "9876543210", "9876-543-210", "9876 543 210",
// and "(987) 654-3210" as equivalent.
//
// Used at two layers:
//   1. Schema transform — every phone column (Sale.partyPhone, Purchase.partyPhone,
//      Customer.phone, Supplier.phone) is normalized at write time so the DB
//      stores a clean version.
//   2. Auto-promotion lookup — when a walk-in transaction is saved with a phone,
//      the server normalizes the typed value before `findFirst({ where: { phone } })`
//      so "9876-543-210" matches a stored "9876543210".
//
// The two together guarantee that any two phone strings differing only in
// whitespace/dashes/parens are treated as the same identity.

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const stripped = input.replace(/[\s\-()]/g, "");
  return stripped === "" ? null : stripped;
}
