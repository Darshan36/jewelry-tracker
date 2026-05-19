// Shared types for the Employee feature.
//
// Lives in its own non-'use server' module so both server actions and
// client components can import these symbols. Exporting a non-function
// value (or a type) from a 'use server' file is forbidden by Next.js —
// the server-actions loader rewrites the module and can throw at runtime
// (`ReferenceError: EmployeeForClient is not defined`). Same lesson as
// the schema-extraction-pattern entry in KNOWN_GAPS.md.

import type { Employee } from "@/generated/prisma";

// Server-side rows have `monthlySalary: bigint | null` and (Phase 18)
// `ratePerPiece: bigint | null`. BigInt isn't reliably JSON-serializable
// across the React Flight boundary — convert both to Number (paise) at
// the page / action boundary; client components consume this uniform
// shape.
export type EmployeeForClient = Omit<
  Employee,
  "monthlySalary" | "ratePerPiece"
> & {
  monthlySalary: number | null;
  ratePerPiece: number | null;
};

export function serializeEmployee(e: Employee): EmployeeForClient {
  return {
    ...e,
    monthlySalary: e.monthlySalary === null ? null : Number(e.monthlySalary),
    ratePerPiece: e.ratePerPiece === null ? null : Number(e.ratePerPiece),
  };
}
