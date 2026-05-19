// Server-safe types + serialisers for the Casting feature.
//
// NOT 'use server' — used by both server components (page.tsx) and
// client components (table, modals). Bigint paise fields become
// `number`; the `Decimal(10,3)` `weightKg` becomes a string ("2.500")
// for safe JSON serialisation across the Server/Client boundary.
//
// Why string for weightKg and not number: a JS Number can represent
// 2.500 exactly, but the moment you round-trip through `.toString()` you
// get "2.5" — losing the gram-precision contract that the DB enforces
// via `Decimal(10, 3)`. Strings preserve the exact digit shape; the
// client formats for display via `formatKg(string)`.

import { Decimal } from "decimal.js";

import type {
  Attachment,
  CastingEntry,
  CastingLineItem,
  CastingPayment,
  Party,
} from "@/generated/prisma";

import {
  computeTransactionStatus,
  type TransactionStatus,
} from "@/lib/transaction-status";

export type CastingStatus = TransactionStatus;

export type CastingPaymentForClient = Omit<CastingPayment, "amount"> & {
  amount: number;
};

export type CastingLineItemForClient = Omit<
  CastingLineItem,
  "weightKg" | "ratePerKg" | "lineTotal"
> & {
  weightKg: string; // exact "2.500" form preserved across the wire
  ratePerKg: number; // paise per kg
  lineTotal: number; // paise
};

export type CastingEntryForClient = Omit<CastingEntry, "discount" | "total"> & {
  discount: number;
  total: number;
  lineItems: CastingLineItemForClient[];
  paidAmount: number;
  status: CastingStatus;
  payments: CastingPaymentForClient[];
  party: Party | null;
  bill: Attachment | null;
};

export function serializeCastingPayment(
  payment: CastingPayment,
): CastingPaymentForClient {
  return { ...payment, amount: Number(payment.amount) };
}

export function serializeCastingLineItem(
  line: CastingLineItem,
): CastingLineItemForClient {
  // Prisma returns weightKg as a Decimal-like object. `.toString()` yields
  // a canonical exponential-free representation; we then format to fixed
  // 3 decimals to match the column's `(10, 3)` storage contract.
  const weightStr = new Decimal(line.weightKg.toString()).toFixed(3);
  return {
    ...line,
    weightKg: weightStr,
    ratePerKg: Number(line.ratePerKg),
    lineTotal: Number(line.lineTotal),
  };
}

function netPaidAmountBigInt(payments: CastingPayment[]): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce(
      (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
      0n,
    );
}

export function serializeCastingEntry(
  input: CastingEntry & {
    lineItems?: CastingLineItem[];
    payments?: CastingPayment[];
    party?: Party | null;
    attachment?: Attachment | null;
  },
): CastingEntryForClient {
  const {
    lineItems: rawLineItems,
    payments: rawPayments,
    party,
    attachment,
    ...entry
  } = input;
  const lineItems = rawLineItems ?? [];
  const payments = rawPayments ?? [];

  const paidAmountBigInt = netPaidAmountBigInt(payments);
  const activePayments = payments.filter((p) => p.deletedAt === null);

  return {
    ...entry,
    discount: Number(entry.discount),
    total: Number(entry.total),
    lineItems: lineItems.map(serializeCastingLineItem),
    paidAmount: Number(paidAmountBigInt),
    status: computeTransactionStatus({
      total: entry.total,
      paidAmount: paidAmountBigInt,
    }),
    payments: activePayments.map(serializeCastingPayment),
    party: party ?? null,
    bill: attachment ?? null,
  };
}
