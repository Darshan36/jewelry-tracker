// Shared zod schema for the CastingPlatingVendor add/edit form.
//
// Pattern matches the Customer / Supplier schemas: empty-string → null
// for every optional field so cleared values land as NULL in the DB
// rather than `undefined` (which Prisma treats as "don't touch this
// column"). Phone is normalized via normalizePhone — the Phase 6
// identity-anchor pattern. Same applies at every lookup boundary.

import { z } from "zod";

import { normalizePhone } from "@/lib/phone";

export const vendorInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => normalizePhone(v)),
  address: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
});

export type VendorInput = z.infer<typeof vendorInputSchema>;
