// Server-safe utilities for the Sales feature.
//
// NOT marked 'use server' — type definitions + pure helpers shared between
// server components (page.tsx) and client components.
//
// BigInt fields on Prisma rows (Sale.discount/total, SaleLineItem.rate,
// SalePayment.amount, SaleReturn.refundAmount) are converted to `number`
// (paise) here. JS Number is safe to 2^53 — paise can hold ~₹90 quadrillion
// before precision loss.

import type {
  Sale,
  SaleLineItem,
  SalePayment,
  SaleReturn,
} from "@/generated/prisma";

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

export type SaleLineItemForClient = Omit<SaleLineItem, "rate"> & {
  rate: number;
};

export type SaleForClient = Omit<Sale, "discount" | "total"> & {
  discount: number;
  total: number;
  lineItems: SaleLineItemForClient[];
  // Net paid amount: SUM(PAYMENT.amount) − SUM(REFUND.amount) over non-deleted.
  paidAmount: number;
  // Sum of refundAmount over non-deleted returns.
  returnTotal: number;
  status: SaleStatus;
  payments: SalePaymentForClient[];
  returns: SaleReturnForClient[];
  // Phase 12c — count of READY non-deleted photos attached via the
  // SALE_PHOTO discriminator. Drives the row indicator and the detail
  // modal's photos section visibility.
  photoCount: number;
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

export function serializeSaleLineItem(
  line: SaleLineItem,
): SaleLineItemForClient {
  return {
    ...line,
    rate: Number(line.rate),
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

// `serializeSale` accepts a Sale that MUST include its lineItems (the
// page query and the action returns both pass them via Prisma `include`).
// Payments and returns are optional — present on the page query, absent
// on the action's immediately-after-create return.
//
// Phase 21a: status loses payment-meaning for PARTY-LINKED sales.
// `paidAmount` passes 0n to computeTransactionStatus when sale.partyId
// is non-null, so status reflects only returns (effectively 'pending'
// unless fully returned). The party ledger is the source of truth for
// party-linked balances; the per-sale status chip is informational at
// best and will be reworked in 21c.
//
// For walk-in sales (sale.partyId IS NULL), status continues to derive
// from per-bill *Payment + *Return children as in Phase 17b.
export function serializeSale(
  input: Sale & {
    lineItems?: SaleLineItem[];
    payments?: SalePayment[];
    returns?: SaleReturn[];
  },
  options?: { photoCount?: number },
): SaleForClient {
  const {
    lineItems: rawLineItems,
    payments: rawPayments,
    returns: rawReturns,
    ...sale
  } = input;
  const lineItems = rawLineItems ?? [];
  const payments = rawPayments ?? [];
  const returns = rawReturns ?? [];

  const isWalkIn = sale.partyId === null;
  const paidAmountBigInt = isWalkIn ? netPaidAmountBigInt(payments) : 0n;
  const returnTotalBigInt_ = returnTotalBigInt(returns);

  const activePayments = payments.filter((p) => p.deletedAt === null);
  const activeReturns = returns.filter((r) => r.deletedAt === null);

  return {
    ...sale,
    discount: Number(sale.discount),
    total: Number(sale.total),
    lineItems: lineItems.map(serializeSaleLineItem),
    paidAmount: Number(paidAmountBigInt),
    returnTotal: Number(returnTotalBigInt_),
    status: computeTransactionStatus({
      total: sale.total,
      paidAmount: paidAmountBigInt,
      returnTotal: returnTotalBigInt_,
    }),
    payments: isWalkIn ? activePayments.map(serializeSalePayment) : [],
    returns: activeReturns.map(serializeSaleReturn),
    photoCount: options?.photoCount ?? 0,
  };
}
