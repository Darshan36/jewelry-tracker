// Zod schema for the Purchase add/edit form.
//
// Structural mirror of sales/schema.ts. Only meaningful difference is the
// FK direction: supplierId instead of customerId. Same line-items array
// shape, same wire-format rules.

import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

export const purchaseLineItemSchema = z.object({
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
});

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
    .transform((v) => normalizePhone(v)),

  lineItems: z
    .array(purchaseLineItemSchema)
    .min(1, "At least one line item is required"),

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
export type PurchaseLineItemInput = z.infer<typeof purchaseLineItemSchema>;
