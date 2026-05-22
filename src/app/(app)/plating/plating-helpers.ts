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
  Attachment,
  PlatingEntry,
  PlatingLineItem,
  PlatingPayment,
  Party,
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
  party: Party | null;
  bill: Attachment | null;
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
    party?: Party | null;
    attachment?: Attachment | null;
  },
): PlatingEntryForClient {
  const {
    lineItems: rawLineItems,
    payments: rawPayments,
    party,
    attachment,
    ...entry
  } = input;
  const lineItems = rawLineItems ?? [];
  const payments = rawPayments ?? [];

  // Phase 21a: status loses payment-meaning for party-linked plating
  // entries. Walk-ins keep the per-bill derivation.
  const isWalkIn = entry.partyId === null;
  const paidAmountBigInt = isWalkIn ? netPaidAmountBigInt(payments) : 0n;
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
    payments: isWalkIn ? activePayments.map(serializePlatingPayment) : [],
    party: party ?? null,
    bill: attachment ?? null,
  };
}
