// Derived transaction status — TypeScript string-literal union, NOT a Prisma
// enum. Shared between Sales and Purchases since the math is identical.
// (CLAUDE.md §5: status is never stored, always computed on read.)
//
// Phase 3.3 made all four branches live for Sales. Phase 4 extends the same
// helper to Purchases (renamed from sale-status.ts → transaction-status.ts
// at Phase 4 build to make the cross-entity reuse explicit).
//
// Logic:
//   effectiveTotal = total - (returnTotal ?? 0n)
//   - paidAmount > effectiveTotal     → refund_due  (overpaid for what's owed)
//   - paidAmount === effectiveTotal   → completed   (matched, with caveats)
//   - 0n < paidAmount < effectiveTotal → partial    (some payment, not enough)
//   - paidAmount === 0n               → pending
//
// EDGE: effectiveTotal === 0n (e.g. full return) with paidAmount === 0n
// AND returnTotal > 0n → "completed" (transaction is closed, nothing owed).
// The `returnTotal > 0n` guard preserves a degenerate zero-total transaction's
// natural "pending" state — only flips to "completed" when the zero is
// *caused by returns*, not by a zero original transaction.
//
// Semantic note for Purchases: the same `refund_due` state means the SHOP
// is owed money back from the SUPPLIER (because shop paid more than the
// return-reduced effective total). UI labels invert per entity — see
// purchases/payment-panel.tsx for "Refund expected" + supplier-direction
// terminology — but the underlying math is the same.

export type TransactionStatus =
  | "pending"
  | "partial"
  | "completed"
  | "refund_due";

export function computeTransactionStatus(input: {
  total: bigint;
  paidAmount?: bigint;
  returnTotal?: bigint;
}): TransactionStatus {
  const paidAmount = input.paidAmount ?? 0n;
  const returnTotal = input.returnTotal ?? 0n;
  const effectiveTotal = input.total - returnTotal;

  // Edge: full return with zero payment → closed, nothing owed.
  // The `returnTotal > 0n` guard distinguishes "fully returned" from a
  // degenerate ₹0 transaction with no return (the latter stays 'pending').
  if (effectiveTotal <= 0n && paidAmount === 0n && returnTotal > 0n) {
    return "completed";
  }

  // Customer/supplier paid more than what's still owed → refund owed.
  if (paidAmount > effectiveTotal) return "refund_due";

  // Exact match against a positive effective total → completed.
  if (paidAmount === effectiveTotal && effectiveTotal > 0n) return "completed";

  // Some payment recorded but not enough → partial.
  if (paidAmount > 0n) return "partial";

  // Default: no payment moved, balance positive (or degenerate zero).
  return "pending";
}
