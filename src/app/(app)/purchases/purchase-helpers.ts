// Server-safe utilities for the Purchases feature.
//
// Structural mirror of sales/sale-helpers.ts. Status helper is unified —
// both Sales and Purchases use `computeTransactionStatus` from
// `@/lib/transaction-status` (same four-state math, same edge cases).
// UI label inversions live in the rendering components, not here.

import type {
  Purchase,
  PurchaseLineItem,
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

export type PurchaseLineItemForClient = Omit<PurchaseLineItem, "rate"> & {
  rate: number;
};

export type PurchaseForClient = Omit<Purchase, "discount" | "total"> & {
  discount: number;
  total: number;
  lineItems: PurchaseLineItemForClient[];
  // Net paid (PAYMENT − REFUND) — for Purchases, this is "shop's net cash to
  // supplier." REFUND entries reduce this (supplier credited money back).
  paidAmount: number;
  returnTotal: number;
  status: PurchaseStatus;
  payments: PurchasePaymentForClient[];
  returns: PurchaseReturnForClient[];
  // Phase 12a — count of READY non-deleted photos attached via the
  // PURCHASE_PHOTO discriminator. Drives the row indicator and the
  // detail modal's photos section visibility.
  photoCount: number;
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

export function serializePurchaseLineItem(
  line: PurchaseLineItem,
): PurchaseLineItemForClient {
  return {
    ...line,
    rate: Number(line.rate),
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
    lineItems?: PurchaseLineItem[];
    payments?: PurchasePayment[];
    returns?: PurchaseReturn[];
  },
  options?: { photoCount?: number },
): PurchaseForClient {
  const {
    lineItems: rawLineItems,
    payments: rawPayments,
    returns: rawReturns,
    ...purchase
  } = input;
  const lineItems = rawLineItems ?? [];
  const payments = rawPayments ?? [];
  const returns = rawReturns ?? [];

  // Phase 21a: status loses payment-meaning for party-linked purchases
  // (see sale-helpers.ts for the full rationale). Walk-in purchases
  // (purchase.partyId IS NULL) keep the per-bill *Payment derivation.
  const isWalkIn = purchase.partyId === null;
  const paidAmountBigInt = isWalkIn ? netPaidAmountBigInt(payments) : 0n;
  const returnTotalBigInt_ = returnTotalBigInt(returns);

  const activePayments = payments.filter((p) => p.deletedAt === null);
  const activeReturns = returns.filter((r) => r.deletedAt === null);

  return {
    ...purchase,
    discount: Number(purchase.discount),
    total: Number(purchase.total),
    lineItems: lineItems.map(serializePurchaseLineItem),
    paidAmount: Number(paidAmountBigInt),
    returnTotal: Number(returnTotalBigInt_),
    status: computeTransactionStatus({
      total: purchase.total,
      paidAmount: paidAmountBigInt,
      returnTotal: returnTotalBigInt_,
    }),
    payments: isWalkIn ? activePayments.map(serializePurchasePayment) : [],
    returns: activeReturns.map(serializePurchaseReturn),
    photoCount: options?.photoCount ?? 0,
  };
}
