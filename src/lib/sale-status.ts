// Derived sale status — TypeScript string-literal union, NOT a Prisma enum.
// (CLAUDE.md §5: status is never stored, always computed on read.)
//
// Phase 3.1: only computes 'pending' (payments and returns don't exist yet).
// Phase 3.2 will add payment-aware logic (partial / completed).
// Phase 3.3 will add return-aware logic (refund_due).
//
// The signature is forward-compatible: callers may pass `paidAmount` and
// `returnTotal` once those entities exist. Until then they default to 0n
// and the function always returns 'pending' for any positive-total sale.

export type SaleStatus = "pending" | "partial" | "completed" | "refund_due";

export function computeSaleStatus(input: {
  total: bigint;
  paidAmount?: bigint;
  returnTotal?: bigint;
}): SaleStatus {
  const paidAmount = input.paidAmount ?? 0n;
  const returnTotal = input.returnTotal ?? 0n;

  const effectiveTotal = input.total - returnTotal;
  const balance = effectiveTotal - paidAmount;

  // Overpaid or paid-then-returned more than was owed → refund owed back.
  if (balance < 0n) return "refund_due";
  // Fully paid against the effective total (excluding the trivial 0/0 case).
  if (balance === 0n && effectiveTotal > 0n) return "completed";
  // Any partial payment in progress.
  if (paidAmount > 0n) return "partial";
  // Default: no money or returns have moved yet.
  return "pending";
}
