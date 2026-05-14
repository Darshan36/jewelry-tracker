// Server-safe utilities for the Sales feature.
//
// NOT marked 'use server' — this file contains type definitions and pure
// helpers that may be imported by both server components (page.tsx) and
// client components. Keeping the helpers separate from actions.ts avoids the
// Phase 2.3 trap where Next.js's actions loader compiled non-function exports
// into client-reference stubs.
//
// BigInt fields on the Prisma row (rate, discount, total) are converted to
// `number` (paise) here. JS Number is safe to 2^53 — paise can hold ~₹90
// quadrillion before precision loss, well past any plausible single sale.

import type { Sale } from "@/generated/prisma";

import { computeSaleStatus, type SaleStatus } from "@/lib/sale-status";

export type SaleForClient = Omit<Sale, "rate" | "discount" | "total"> & {
  rate: number;
  discount: number;
  total: number;
  status: SaleStatus;
};

export function serializeSale(sale: Sale): SaleForClient {
  return {
    ...sale,
    rate: Number(sale.rate),
    discount: Number(sale.discount),
    total: Number(sale.total),
    status: computeSaleStatus({ total: sale.total }),
  };
}
