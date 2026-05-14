// Zod schema for PurchaseReturn add form — mirror of sales/return-schema.ts.
//
// Semantically: a PurchaseReturn is the SHOP returning items to the
// SUPPLIER. `qtyReturned` = how many items going back; `refundAmount` =
// rupees the supplier is expected to credit back. Same shape as
// SaleReturn; only the parent FK is different.

import { z } from "zod";

export const purchaseReturnInputSchema = z.object({
  purchaseId: z.string().min(1, "Purchase is required"),

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

export type PurchaseReturnInput = z.infer<typeof purchaseReturnInputSchema>;
