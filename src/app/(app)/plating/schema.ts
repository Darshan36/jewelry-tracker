// Zod schema for the Plating entry add/edit form.
//
// Mirrors the Sales schema shape (date + party + lineItems + discount +
// notes) with weight-based line items instead of qty-based. Wire-format
// rules carry over:
//   - `weightKg`, `ratePerKg`, `discount` stay as `number` here. Do NOT
//     transform to Decimal/BigInt in the schema — the client form would
//     emit the wrapped type and the server-action re-parse would reject
//     it ("Expected number, received bigint"). Conversion happens in the
//     action's `buildPlatingEntryData` at the Prisma boundary.
//   - Empty-string-to-null for optional strings (partyPhone, notes).
//   - `date` uses z.coerce.date() for symmetric form-input round-tripping.
//
// `ratePerKg` is in rupees-per-kg on the wire (e.g., 400 = ₹400/kg). The
// action converts to paise-per-kg via × 100 + Math.round.
// `weightKg` is in kg on the wire (e.g., 2.5 = 2.5 kg). The action wraps
// in Decimal for the multiplication step.

import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

export const platingLineItemSchema = z.object({
  materialDescription: z
    .string()
    .trim()
    .min(1, "Material description is required")
    .max(500),
  weightKg: z
    .number()
    .nonnegative("Weight cannot be negative")
    .refine((v) => v > 0, "Weight must be greater than zero"),
  ratePerKg: z.number().nonnegative("Rate cannot be negative"),
});

export const platingEntryInputSchema = z.object({
  date: z.coerce.date({ message: "Date is required" }),

  vendorId: z.string().min(1).nullable(),

  partyName: z
    .string()
    .trim()
    .min(1, "Vendor name is required")
    .max(200),

  partyPhone: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => normalizePhone(v)),

  lineItems: z
    .array(platingLineItemSchema)
    .min(1, "At least one line item is required"),

  discount: z.number().nonnegative("Discount cannot be negative").default(0),

  // Optional attachmentId — when set, links a previously-uploaded Attachment to this
  // entry. Attachment upload happens AFTER entry creation (the bill needs
  // attachedToId = entry.id), so the create flow leaves this null; the
  // form's bill picker runs a follow-up `updatePlatingEntry` to attach.
  // Empty-string-to-null matches the pattern used on other optional
  // fields so a form that submits "" for an unset bill normalises cleanly.
  attachmentId: z
    .string()
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),

  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
});

export type PlatingEntryInput = z.infer<typeof platingEntryInputSchema>;
export type PlatingLineItemInput = z.infer<typeof platingLineItemSchema>;
