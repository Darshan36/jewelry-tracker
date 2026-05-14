// Shared zod schema for the Customer add/edit form.
//
// Lives in its own (non-'use server') module so the client form modal can
// import it directly. Exporting a non-function value from a 'use server'
// file replaces it with a serialized client-reference at the boundary —
// the client sees a stub, not the actual Zod schema (which fails the
// resolver's `isZod4Schema` check with "Invalid input: not a Zod schema").
//
// Empty-string → null (NOT undefined). This is the critical edit-semantics
// guarantee: when a user clears a previously-populated optional field via
// the edit form and saves, the DB MUST actually clear the column to NULL.
// Prisma treats `undefined` in `update.data` as "don't change this field";
// `null` explicitly sets the column to NULL. Output for each optional
// field is `string | null`, never `string | undefined`.
//
// For email, `.pipe()` runs format validation AFTER the empty-string
// normalization so "" doesn't trip "Invalid email" — only non-empty values
// are checked for email shape.

import { z } from "zod";

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v))
    .pipe(z.union([z.null(), z.string().email("Invalid email")])),
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

export type CustomerInput = z.infer<typeof customerInputSchema>;
