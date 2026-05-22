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
