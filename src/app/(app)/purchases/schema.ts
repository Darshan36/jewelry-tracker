// Zod schema for the Purchase add/edit form.
//
// Structural mirror of sales/schema.ts. Only meaningful difference is the
// FK direction: supplierId instead of customerId (Purchases attach to
// suppliers, the supplier-direction equivalent of customers).
//
// Same wire-format rules — rate/discount stay `number` rupees here,
// converted to BigInt paise inside actions.ts at the Prisma boundary.

import { z } from "zod";

export const purchaseInputSchema = z.object({
  date: z.coerce.date({ message: "Date is required" }),

  supplierId: z.string().min(1).nullable(),

  partyName: z
    .string()
    .trim()
    .min(1, "Party name is required")
    .max(200),

  partyPhone: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),

  itemDescription: z
    .string()
    .trim()
    .min(1, "Item description is required")
    .max(500),

  qty: z
    .number()
    .int("Qty must be a whole number")
    .positive("Qty must be greater than zero"),

  rate: z.number().nonnegative("Rate cannot be negative"),

  discount: z
    .number()
    .nonnegative("Discount cannot be negative")
    .default(0),

  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),
});

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;
