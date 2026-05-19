import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewLabour } from "@/lib/role-access";
import {
  listEmployeesMissingSalaryThisMonth,
  listEmployeesWithOutstandingWages,
} from "@/lib/labour-balances";

import { LabourPageClient } from "./labour-page-client";
import type { EmployeeForClient } from "../employees/types";

// Phase 18 — /labour page.
//
// Three sections:
//   1. Pending salaries (FIXED employees missing this month's payment)
//   2. Outstanding wages (LABOUR employees with unpaid piece work)
//   3. Bulk piece entry (all active LABOUR employees, fast daily entry)
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

  const [pendingSalaries, outstandingWages, labourEmployees] = await Promise.all(
    [
      listEmployeesMissingSalaryThisMonth(),
      listEmployeesWithOutstandingWages(),
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
      ratePerPiece: e.ratePerPiece === null ? null : Number(e.ratePerPiece),
    }),
  );

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Payroll
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Daily piece entry · salaries · wages
        </p>
      </header>

      <LabourPageClient
        pendingSalaries={pendingSalaries}
        outstandingWages={outstandingWages}
        labourEmployees={labourEmployeesForClient}
      />
    </div>
  );
}
