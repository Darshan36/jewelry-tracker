// Zod schemas for the Phase 21a party-ledger actions.
//
// NOT 'use server' — kept as plain TS so client components can import
// the types without triggering Next.js's actions-loader pulling Prisma
// or other server-only deps into the client bundle.

import { z } from "zod";

export const createLedgerPaymentSchema = z.object({
  partyId: z.string().min(1, "Party is required"),
  date: z.coerce.date({ message: "Date is required" }),
  /** Amount in rupees (form wire format). Converted to BigInt paise at the action. */
  amount: z.number().positive("Amount must be greater than zero"),
  /**
   * Optional description shown on the party-ledger statement view.
   * Empty / whitespace-only → null.
   */
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),
  /**
   * Sign convention for /receivables — the customer is paying the
   * shop, so the entry is direction='DECREASE' relative to their
   * balance-they-owe. The action defaults to DECREASE because
   * "Add payment" in both /payables and /receivables means money
   * moving in the direction that REDUCES the party's outstanding.
   */
});

export type CreateLedgerPaymentInput = z.input<typeof createLedgerPaymentSchema>;

// Phase 21a.1 — edit an existing MANUAL_PAYMENT ledger entry.
//
// Fields mirror createLedgerPaymentSchema; the action enforces the
// TRANSACTION_LINKED rejection (only MANUAL_PAYMENT entries are
// editable from the ledger UI). The entry's `id` identifies the row;
// `partyId` is not editable — moving a payment between parties is a
// soft-delete + new-create operation, not an in-place edit.
export const updateLedgerPaymentSchema = z.object({
  id: z.string().min(1, "Entry id is required"),
  date: z.coerce.date({ message: "Date is required" }),
  amount: z.number().positive("Amount must be greater than zero"),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),
});

export type UpdateLedgerPaymentInput = z.input<typeof updateLedgerPaymentSchema>;
