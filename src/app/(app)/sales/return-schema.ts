// Zod schema for SaleReturn add form.
//
// Same currency pipeline as Phase 3.2 payments: schema validates rupees as
// number (refundAmount), action converts to BigInt paise at the Prisma
// boundary. Do NOT `.transform` to BigInt here — see KNOWN_GAPS lineage on
// the wire-format invariant.

import { z } from "zod";

export const saleReturnInputSchema = z.object({
  saleId: z.string().min(1, "Sale is required"),

  date: z.coerce.date({ message: "Date is required" }),

  qtyReturned: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than zero"),

  refundAmount: z
    .number()
    .nonnegative("Refund amount cannot be negative"),

  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),
});

export type SaleReturnInput = z.infer<typeof saleReturnInputSchema>;
