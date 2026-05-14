// Server-safe utilities for the Sales feature.
//
// NOT marked 'use server' — type definitions + pure helpers shared between
// server components (page.tsx) and client components.
//
// BigInt fields on Prisma rows (Sale.rate/discount/total, SalePayment.amount,
// SaleReturn.refundAmount) are converted to `number` (paise) here. JS Number
// is safe to 2^53 — paise can hold ~₹90 quadrillion before precision loss.

import type { Sale, SalePayment, SaleReturn } from "@/generated/prisma";

import {
  computeTransactionStatus,
  type TransactionStatus,
} from "@/lib/transaction-status";

// Re-export under the historical name so consumers that imported
// `SaleStatus` from this module don't have to re-route — the union is
// shared between Sales and Purchases but Sales-side typing keeps the
// familiar name at the call site.
export type SaleStatus = TransactionStatus;

export type SalePaymentForClient = Omit<SalePayment, "amount"> & {
  amount: number;
};

export type SaleReturnForClient = Omit<SaleReturn, "refundAmount"> & {
  refundAmount: number;
};

export type SaleForClient = Omit<Sale, "rate" | "discount" | "total"> & {
  rate: number;
  discount: number;
  total: number;
  // Net paid amount: SUM(PAYMENT.amount) − SUM(REFUND.amount) over non-deleted.
  paidAmount: number;
  // Sum of refundAmount over non-deleted returns.
  returnTotal: number;
  status: SaleStatus;
  payments: SalePaymentForClient[];
  returns: SaleReturnForClient[];
};

export function serializeSalePayment(payment: SalePayment): SalePaymentForClient {
  return {
    ...payment,
    amount: Number(payment.amount),
  };
}

export function serializeSaleReturn(saleReturn: SaleReturn): SaleReturnForClient {
  return {
    ...saleReturn,
    refundAmount: Number(saleReturn.refundAmount),
  };
}

// Sum non-deleted PAYMENT entries minus non-deleted REFUND entries.
// All math in BigInt to avoid float precision loss.
function netPaidAmountBigInt(payments: SalePayment[]): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce((sum, p) => {
      return p.type === "PAYMENT" ? sum + p.amount : sum - p.amount;
    }, 0n);
}

function returnTotalBigInt(returns: SaleReturn[]): bigint {
  return returns
    .filter((r) => r.deletedAt === null)
    .reduce((sum, r) => sum + r.refundAmount, 0n);
}

// `serializeSale` accepts either a plain Sale (action returns immediately
// after create/update — no children needed) OR a Sale joined with payments
// and returns via Prisma `include` (page queries needing live status).
// When children are present, only non-deleted contribute to aggregations;
// the query layer's include filter SHOULD already strip soft-deleted rows,
// but we re-filter here defensively.
export function serializeSale(
  input: Sale & { payments?: SalePayment[]; returns?: SaleReturn[] },
): SaleForClient {
  const { payments: rawPayments, returns: rawReturns, ...sale } = input;
  const payments = rawPayments ?? [];
  const returns = rawReturns ?? [];

  const paidAmountBigInt = netPaidAmountBigInt(payments);
  const returnTotalBigInt_ = returnTotalBigInt(returns);

  const activePayments = payments.filter((p) => p.deletedAt === null);
  const activeReturns = returns.filter((r) => r.deletedAt === null);

  return {
    ...sale,
    rate: Number(sale.rate),
    discount: Number(sale.discount),
    total: Number(sale.total),
    paidAmount: Number(paidAmountBigInt),
    returnTotal: Number(returnTotalBigInt_),
    status: computeTransactionStatus({
      total: sale.total,
      paidAmount: paidAmountBigInt,
      returnTotal: returnTotalBigInt_,
    }),
    payments: activePayments.map(serializeSalePayment),
    returns: activeReturns.map(serializeSaleReturn),
  };
}
