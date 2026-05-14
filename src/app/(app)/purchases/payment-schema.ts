// Zod schema for PurchasePayment add form.
//
// Mirror of sales/payment-schema.ts — same wire-format invariants, same
// PaymentType enum (reused from Phase 3.3, defined once in Prisma schema).
// The only difference: `purchaseId` instead of `saleId` on the FK side.

import { z } from "zod";

export const purchasePaymentInputSchema = z.object({
  purchaseId: z.string().min(1, "Purchase is required"),

  date: z.coerce.date({ message: "Date is required" }),

  amount: z.number().positive("Amount must be greater than zero"),

  type: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT"),

  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),
});

export type PurchasePaymentInput = z.infer<typeof purchasePaymentInputSchema>;
