// Zod schema for the Sale add/edit form.
//
// Wire-format rules (carried from Phase 2.3, see KNOWN_GAPS decision lineage):
//   - Currency fields (line rate, discount) stay as `number` rupees here. Do
//     NOT `.transform(v => BigInt(...))` — the client form would emit BigInt
//     and the server-action re-parse would reject it ("Expected number,
//     received bigint"). Conversion to BigInt paise happens in actions.ts at
//     the Prisma boundary.
//   - Empty-string-to-null transform on optional strings (partyPhone, notes)
//     so cleared form fields become DB NULLs, not `undefined` (which Prisma
//     would silently skip during an update).
//   - `date` uses z.coerce.date(): the date input emits "YYYY-MM-DD" strings;
//     z.coerce.date() accepts both strings AND Date instances, so the client→
//     server re-parse roundtrip is symmetric.
//
// Phase 7: single qty/rate/itemDescription replaced by a `lineItems` array.
// Each line item has its own description + qty + rate. Discount stays on
// the parent sale and applies to the line-item subtotal.

import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

export const saleLineItemSchema = z.object({
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

export const saleInputSchema = z.object({
  date: z.coerce.date({ message: "Date is required" }),

  partyId: z.string().min(1).nullable(),

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
    .array(saleLineItemSchema)
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

export type SaleInput = z.infer<typeof saleInputSchema>;
export type SaleLineItemInput = z.infer<typeof saleLineItemSchema>;
