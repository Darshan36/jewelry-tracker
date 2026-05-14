// Server-safe utilities for the Purchases feature.
//
// Structural mirror of sales/sale-helpers.ts. Status helper is unified —
// both Sales and Purchases use `computeTransactionStatus` from
// `@/lib/transaction-status` (same four-state math, same edge cases).
// UI label inversions live in the rendering components, not here.

import type {
  Purchase,
  PurchasePayment,
  PurchaseReturn,
} from "@/generated/prisma";

import {
  computeTransactionStatus,
  type TransactionStatus,
} from "@/lib/transaction-status";

export type PurchaseStatus = TransactionStatus;

export type PurchasePaymentForClient = Omit<PurchasePayment, "amount"> & {
  amount: number;
};

export type PurchaseReturnForClient = Omit<PurchaseReturn, "refundAmount"> & {
  refundAmount: number;
};

export type PurchaseForClient = Omit<
  Purchase,
  "rate" | "discount" | "total"
> & {
  rate: number;
  discount: number;
  total: number;
  // Net paid (PAYMENT − REFUND) — for Purchases, this is "shop's net cash to
  // supplier." REFUND entries reduce this (supplier credited money back).
  paidAmount: number;
  returnTotal: number;
  status: PurchaseStatus;
  payments: PurchasePaymentForClient[];
  returns: PurchaseReturnForClient[];
};

export function serializePurchasePayment(
  payment: PurchasePayment,
): PurchasePaymentForClient {
  return {
    ...payment,
    amount: Number(payment.amount),
  };
}

export function serializePurchaseReturn(
  purchaseReturn: PurchaseReturn,
): PurchaseReturnForClient {
  return {
    ...purchaseReturn,
    refundAmount: Number(purchaseReturn.refundAmount),
  };
}

function netPaidAmountBigInt(payments: PurchasePayment[]): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce((sum, p) => {
      return p.type === "PAYMENT" ? sum + p.amount : sum - p.amount;
    }, 0n);
}

function returnTotalBigInt(returns: PurchaseReturn[]): bigint {
  return returns
    .filter((r) => r.deletedAt === null)
    .reduce((sum, r) => sum + r.refundAmount, 0n);
}

export function serializePurchase(
  input: Purchase & {
    payments?: PurchasePayment[];
    returns?: PurchaseReturn[];
  },
): PurchaseForClient {
  const { payments: rawPayments, returns: rawReturns, ...purchase } = input;
  const payments = rawPayments ?? [];
  const returns = rawReturns ?? [];

  const paidAmountBigInt = netPaidAmountBigInt(payments);
  const returnTotalBigInt_ = returnTotalBigInt(returns);

  const activePayments = payments.filter((p) => p.deletedAt === null);
  const activeReturns = returns.filter((r) => r.deletedAt === null);

  return {
    ...purchase,
    rate: Number(purchase.rate),
    discount: Number(purchase.discount),
    total: Number(purchase.total),
    paidAmount: Number(paidAmountBigInt),
    returnTotal: Number(returnTotalBigInt_),
    status: computeTransactionStatus({
      total: purchase.total,
      paidAmount: paidAmountBigInt,
      returnTotal: returnTotalBigInt_,
    }),
    payments: activePayments.map(serializePurchasePayment),
    returns: activeReturns.map(serializePurchaseReturn),
  };
}
