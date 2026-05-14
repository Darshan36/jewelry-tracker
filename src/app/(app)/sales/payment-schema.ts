// Zod schema for SalePayment add form.
//
// Follows the Phase 2.3 / 3.1 currency pipeline: schema validates rupees as
// a number (positive — payments must move money), action's helper converts
// to BigInt paise at the Prisma boundary. Do NOT `.transform` to BigInt in
// this schema — see KNOWN_GAPS decision lineage.
//
// `saleId` is part of the input shape because the action needs to know which
// sale the payment attaches to; the form's hidden field carries it.

import { z } from "zod";

export const salePaymentInputSchema = z.object({
  saleId: z.string().min(1, "Sale is required"),

  date: z.coerce.date({ message: "Date is required" }),

  amount: z.number().positive("Amount must be greater than zero"),

  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),
});

export type SalePaymentInput = z.infer<typeof salePaymentInputSchema>;
