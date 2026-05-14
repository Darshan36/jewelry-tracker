// Derived sale status — TypeScript string-literal union, NOT a Prisma enum.
// (CLAUDE.md §5: status is never stored, always computed on read.)
//
// Phase 3.3: refund_due branch now active via returnTotal aggregation.
// Phase 3.2 added the partial/completed/pending branches via paidAmount.
// Phase 3.1 only computed pending (helper signature was forward-compatible).
//
// Logic:
//   effectiveTotal = total - (returnTotal ?? 0n)
//   - paidAmount > effectiveTotal     → refund_due  (overpaid for what's owed)
//   - paidAmount === effectiveTotal   → completed   (matched, with caveats)
//   - 0n < paidAmount < effectiveTotal → partial    (some payment, not enough)
//   - paidAmount === 0n               → pending
//
// EDGE: effectiveTotal === 0n (e.g. full return) with paidAmount === 0n
// AND returnTotal > 0n → "completed" (sale is closed, nothing owed back).
// The `returnTotal > 0n` guard preserves a degenerate zero-total sale's
// natural "pending" state (Phase 3.1 test #6) — only flips to "completed"
// when the zero is *caused by returns*, not by a zero original sale.

export type SaleStatus = "pending" | "partial" | "completed" | "refund_due";

export function computeSaleStatus(input: {
  total: bigint;
  paidAmount?: bigint;
  returnTotal?: bigint;
}): SaleStatus {
  const paidAmount = input.paidAmount ?? 0n;
  const returnTotal = input.returnTotal ?? 0n;
  const effectiveTotal = input.total - returnTotal;

  // Edge: full return with zero payment → closed, nothing owed.
  // The `returnTotal > 0n` guard distinguishes "fully returned" from a
  // degenerate ₹0 sale with no return (the latter stays 'pending').
  if (effectiveTotal <= 0n && paidAmount === 0n && returnTotal > 0n) {
    return "completed";
  }

  // Customer paid more than what's still owed → refund owed.
  if (paidAmount > effectiveTotal) return "refund_due";

  // Exact match against a positive effective total → completed.
  if (paidAmount === effectiveTotal && effectiveTotal > 0n) return "completed";

  // Some payment recorded but not enough → partial.
  if (paidAmount > 0n) return "partial";

  // Default: no payment moved, balance positive (or degenerate zero).
  return "pending";
}
