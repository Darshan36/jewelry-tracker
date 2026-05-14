// Shared zod schema for the Employee add/edit form.
//
// Diverges from Customer/Supplier in three ways:
//   1. NO email field
//   2. Required `type` enum (FIXED | LABOUR)
//   3. Conditional `monthlySalary`:
//      - Form input is a rupees number; schema transforms to bigint paise
//      - LABOUR employees must have monthlySalary = null; superRefine enforces
//
// Same empty-string-to-null transform for phone/address/notes as the other
// entities — cleared form fields must become NULL in the DB, not undefined.
//
// monthlySalary BigInt rationale: paise can theoretically exceed 32-bit
// (₹21,474,836+) for very large salaries. For a small jewelry workshop the
// actual range is ~₹1,000 to ~₹50,000/month, but BigInt keeps us safe and
// matches the Prisma column type.

// IMPORTANT: do NOT `import { EmployeeType } from "@/generated/prisma"` here
// as a value. It's a runtime const object in Prisma 7's client, and importing
// it forces the entire Prisma client runtime (`@prisma/client/runtime/client`,
// which uses `node:module`) into the client bundle when this schema is
// reached via the form modal. The schema only needs the string literals
// "FIXED" | "LABOUR" — z.enum handles that without the Prisma import.
//
// Components that want the type alias can `import type { EmployeeType }
// from "@/generated/prisma"` — type-only imports are stripped at compile
// time, so they don't trigger the bundle issue.

import { z } from "zod";

export const employeeInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    phone: z
      .string()
      .trim()
      .max(20)
      .nullish()
      .transform((v) =>
        v === undefined || v === null || v === "" ? null : v,
      ),
    type: z.enum(["FIXED", "LABOUR"]),
    // Schema validates the user-facing shape: rupees as a number (or null).
    // Conversion to BigInt paise happens in actions.ts before Prisma writes.
    // Keeping the schema's input AND output shapes as plain number prevents
    // wire-format mismatches: the client form passes rupees to the server
    // action, the server re-parses the SAME shape, then the action converts
    // to BigInt at the DB boundary. If the schema's output were BigInt, the
    // client's post-transform value would be BigInt and the server's
    // re-parse would fail z.number() validation.
    monthlySalary: z
      .number()
      .int("Salary must be a whole number")
      .positive("Salary must be greater than zero")
      .nullish()
      .transform((v) => (v === undefined || v === null ? null : v)),
    address: z
      .string()
      .trim()
      .max(1000)
      .nullish()
      .transform((v) =>
        v === undefined || v === null || v === "" ? null : v,
      ),
    notes: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((v) =>
        v === undefined || v === null || v === "" ? null : v,
      ),
  })
  .superRefine((data, ctx) => {
    if (data.type === "LABOUR" && data.monthlySalary !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monthlySalary"],
        message: "Monthly salary applies only to fixed-salary employees.",
      });
    }
  });

export type EmployeeInput = z.infer<typeof employeeInputSchema>;
