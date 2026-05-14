// Server-safe utilities for the Sales feature.
//
// NOT marked 'use server' — this file contains type definitions and pure
// helpers that may be imported by both server components (page.tsx) and
// client components. Keeping the helpers separate from actions.ts avoids the
// Phase 2.3 trap where Next.js's actions loader compiled non-function exports
// into client-reference stubs.
//
// BigInt fields on Prisma rows (Sale.rate/discount/total, SalePayment.amount)
// are converted to `number` (paise) here. JS Number is safe to 2^53 — paise
// can hold ~₹90 quadrillion before precision loss, well past any plausible
// single sale or payment.

import type { Sale, SalePayment } from "@/generated/prisma";

import { computeSaleStatus, type SaleStatus } from "@/lib/sale-status";

export type SalePaymentForClient = Omit<SalePayment, "amount"> & {
  amount: number;
};

export type SaleForClient = Omit<Sale, "rate" | "discount" | "total"> & {
  rate: number;
  discount: number;
  total: number;
  paidAmount: number;
  status: SaleStatus;
  payments: SalePaymentForClient[];
};

export function serializeSalePayment(payment: SalePayment): SalePaymentForClient {
  return {
    ...payment,
    amount: Number(payment.amount),
  };
}

// `serializeSale` accepts either a plain Sale (for action returns immediately
// after a create/update — no payments yet relevant) OR a Sale joined with its
// payments via Prisma `include` (for page queries that need live status).
// When payments are present, only the non-deleted ones contribute to
// paidAmount; the include filter at the query layer SHOULD already strip
// soft-deleted rows, but we re-filter here defensively.
export function serializeSale(
  input: Sale & { payments?: SalePayment[] },
): SaleForClient {
  const { payments: rawPayments, ...sale } = input;
  const activePayments = (rawPayments ?? []).filter(
    (p) => p.deletedAt === null,
  );
  const paidAmountBigInt = activePayments.reduce(
    (sum, p) => sum + p.amount,
    0n,
  );

  return {
    ...sale,
    rate: Number(sale.rate),
    discount: Number(sale.discount),
    total: Number(sale.total),
    paidAmount: Number(paidAmountBigInt),
    status: computeSaleStatus({
      total: sale.total,
      paidAmount: paidAmountBigInt,
    }),
    payments: activePayments.map(serializeSalePayment),
  };
}
