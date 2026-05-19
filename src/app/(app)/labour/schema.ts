// Zod schemas for Phase 18 — labour management.
//
// Lives in its own non-'use server' module so both client components
// and server actions can import. See the schema-extraction-pattern
// note in KNOWN_GAPS.md.

import { z } from "zod";

// --- Piece entries ---------------------------------------------------

const pieceEntryItemSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  // Positive integer — zero-count rows get filtered out before
  // validation in the bulk action, so empty rows pass through without
  // creating noise.
  count: z
    .number()
    .int("Count must be a whole number")
    .positive("Count must be greater than zero"),
  // Rate in rupees per piece on the wire; action converts to BigInt
  // paise at the Prisma boundary. Same currency-wire convention as
  // Sale / Purchase line items.
  ratePerPiece: z
    .number()
    .nonnegative("Rate must be zero or greater"),
});

export const bulkPieceEntryInputSchema = z.object({
  // YYYY-MM-DD from the date picker; coerce accepts both string and Date.
  date: z.coerce.date(),
  entries: z.array(pieceEntryItemSchema).min(1, "At least one entry required"),
});

export type BulkPieceEntryInput = z.input<typeof bulkPieceEntryInputSchema>;
export type BulkPieceEntryParsed = z.output<typeof bulkPieceEntryInputSchema>;

// Single piece-entry creation (for ad-hoc entries from the detail modal).
export const pieceEntryInputSchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  date: z.coerce.date(),
  count: z
    .number()
    .int("Count must be a whole number")
    .positive("Count must be greater than zero"),
  ratePerPiece: z
    .number()
    .nonnegative("Rate must be zero or greater"),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) =>
      v === undefined || v === null || v === "" ? null : v,
    ),
});

export type PieceEntryInput = z.input<typeof pieceEntryInputSchema>;

// --- Employee payments ----------------------------------------------

export const employeePaymentInputSchema = z
  .object({
    employeeId: z.string().min(1, "Employee is required"),
    type: z.enum(["SALARY", "WAGE"]),
    paidAt: z.coerce.date(),
    // Amount in rupees on the wire; converted to BigInt paise in action.
    amount: z
      .number()
      .positive("Amount must be greater than zero"),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    note: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) =>
        v === undefined || v === null || v === "" ? null : v,
      ),
  })
  .superRefine((data, ctx) => {
    if (data.periodEnd.getTime() < data.periodStart.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "Period end must be on or after period start.",
      });
    }
  });

export type EmployeePaymentInput = z.input<typeof employeePaymentInputSchema>;
export type EmployeePaymentParsed = z.output<typeof employeePaymentInputSchema>;
