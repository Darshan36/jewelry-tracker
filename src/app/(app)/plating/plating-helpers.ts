// Server-safe types + serialisers for the Plating feature.
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
  Bill,
  PlatingEntry,
  PlatingLineItem,
  PlatingPayment,
  CastingPlatingVendor,
} from "@/generated/prisma";

import {
  computeTransactionStatus,
  type TransactionStatus,
} from "@/lib/transaction-status";

export type PlatingStatus = TransactionStatus;

export type PlatingPaymentForClient = Omit<PlatingPayment, "amount"> & {
  amount: number;
};

export type PlatingLineItemForClient = Omit<
  PlatingLineItem,
  "weightKg" | "ratePerKg" | "lineTotal"
> & {
  weightKg: string; // exact "2.500" form preserved across the wire
  ratePerKg: number; // paise per kg
  lineTotal: number; // paise
};

export type PlatingEntryForClient = Omit<PlatingEntry, "discount" | "total"> & {
  discount: number;
  total: number;
  lineItems: PlatingLineItemForClient[];
  paidAmount: number;
  status: PlatingStatus;
  payments: PlatingPaymentForClient[];
  vendor: CastingPlatingVendor | null;
  bill: Bill | null;
};

export function serializePlatingPayment(
  payment: PlatingPayment,
): PlatingPaymentForClient {
  return { ...payment, amount: Number(payment.amount) };
}

export function serializePlatingLineItem(
  line: PlatingLineItem,
): PlatingLineItemForClient {
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

function netPaidAmountBigInt(payments: PlatingPayment[]): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce(
      (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
      0n,
    );
}

export function serializePlatingEntry(
  input: PlatingEntry & {
    lineItems?: PlatingLineItem[];
    payments?: PlatingPayment[];
    vendor?: CastingPlatingVendor | null;
    bill?: Bill | null;
  },
): PlatingEntryForClient {
  const {
    lineItems: rawLineItems,
    payments: rawPayments,
    vendor,
    bill,
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
    lineItems: lineItems.map(serializePlatingLineItem),
    paidAmount: Number(paidAmountBigInt),
    status: computeTransactionStatus({
      total: entry.total,
      paidAmount: paidAmountBigInt,
    }),
    payments: activePayments.map(serializePlatingPayment),
    vendor: vendor ?? null,
    bill: bill ?? null,
  };
}
