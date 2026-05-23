import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewLabour } from "@/lib/role-access";
import {
  listEmployeesMissingSalaryThisMonth,
  listKarigarBalances,
} from "@/lib/labour-balances";

import { LabourPageClient } from "./labour-page-client";
import type { EmployeeForClient } from "../employees/types";

// Phase 18 — /labour page.
// Phase 21b.1 — Section 2 ("Outstanding wages") replaced by the unified
// "Karigar ledger" surface that lists every active LABOUR karigar with
// their signed balance + "Record entry" button for direct ledger
// entries (advances / payments / adjustments).
//
// Three sections:
//   1. Pending salaries (FIXED employees missing this month's payment)
//   2. Karigar ledger (all active LABOUR with signed balance + buttons)
//   3. Daily piece entry (all active LABOUR, fast bulk entry)
//
// Server component fetches all the data; the interactive bits live in
// labour-page-client.tsx.

export default async function LabourPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  // Defense in depth — proxy already gates the route, but the page
  // server-component re-checks so a misconfigured proxy or directly-
  // imported component can't bypass.
  if (!canViewLabour(session.user.role)) {
    redirect("/dashboard");
  }

  const [pendingSalaries, karigarBalances, labourEmployees] = await Promise.all(
    [
      listEmployeesMissingSalaryThisMonth(),
      listKarigarBalances(),
      prisma.employee.findMany({
        where: { deletedAt: null, type: "LABOUR" },
        orderBy: { name: "asc" },
      }),
    ],
  );

  // Serialize labour employees for client (BigInt → Number).
  const labourEmployeesForClient: EmployeeForClient[] = labourEmployees.map(
    (e) => ({
      ...e,
      monthlySalary: e.monthlySalary === null ? null : Number(e.monthlySalary),
    }),
  );

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Payroll
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Daily piece entry · salaries · wages · karigar ledger
        </p>
      </header>

      <LabourPageClient
        pendingSalaries={pendingSalaries}
        karigarBalances={karigarBalances}
        labourEmployees={labourEmployeesForClient}
      />
    </div>
  );
}
