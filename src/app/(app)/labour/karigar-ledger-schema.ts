// Phase 21b.1 — schemas for direct karigar ledger entries.
//
// Mirrors `parties/ledger-schema.ts` but for employee-owned MANUAL_PAYMENT
// entries. Differences from the party-side:
//   - Owner is employeeId, not partyId.
//   - Direction is user-picked: DECREASE for advances/payments (the
//     common case — shop gives karigar cash), INCREASE for adjustments
//     (e.g. opening balance, correction in the karigar's favor).
//   - Description is REQUIRED (and non-empty after trim). Party-side
//     `description` is optional; karigar-side advances need legibility
//     so a future reader can tell "advance for next week" from "opening
//     balance — prior work".
//
// NOT 'use server' — client components import these types.

import { z } from "zod";

const trimmedNonEmpty = z
  .string()
  .trim()
  .min(1, "Description is required")
  .max(2000);

export const createKarigarLedgerEntrySchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  date: z.coerce.date({ message: "Date is required" }),
  /** Amount in rupees (form wire format). Converted to BigInt paise at the action. */
  amount: z.number().positive("Amount must be greater than zero"),
  /**
   * INCREASE = shop owes karigar more (adjustment / opening balance in
   * karigar's favor). DECREASE = shop pays karigar / advance against
   * future work (the common case). The user explicitly picks; no
   * default at the schema layer — the modal defaults to DECREASE.
   */
  direction: z.enum(["INCREASE", "DECREASE"]),
  description: trimmedNonEmpty,
});

export type CreateKarigarLedgerEntryInput = z.input<
  typeof createKarigarLedgerEntrySchema
>;

export const updateKarigarLedgerEntrySchema = z.object({
  id: z.string().min(1, "Entry id is required"),
  date: z.coerce.date({ message: "Date is required" }),
  amount: z.number().positive("Amount must be greater than zero"),
  direction: z.enum(["INCREASE", "DECREASE"]),
  description: trimmedNonEmpty,
});

export type UpdateKarigarLedgerEntryInput = z.input<
  typeof updateKarigarLedgerEntrySchema
>;
