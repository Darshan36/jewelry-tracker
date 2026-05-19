import { prisma } from "@/lib/prisma";

import { EmployeesTable } from "./employees-table";
import type { EmployeeForClient } from "./types";

export default async function EmployeesPage() {
  const rows = await prisma.employee.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  // BigInt isn't reliably JSON-serializable across the server→client component
  // boundary in all React Flight scenarios. Convert monthlySalary (bigint) to
  // a plain Number (paise) before passing as a prop. JS Number is safe to
  // 2^53; paise can hold ~₹90 quadrillion before precision loss — well past
  // any plausible salary. Same conversion happens in actions.ts on the
  // returned row, so the client-side `EmployeeForClient` shape is uniform.
  const employees: EmployeeForClient[] = rows.map((r) => ({
    ...r,
    monthlySalary: r.monthlySalary === null ? null : Number(r.monthlySalary),
    ratePerPiece: r.ratePerPiece === null ? null : Number(r.ratePerPiece),
  }));

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Employees
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Fixed staff and karigars
        </p>
      </header>

      <EmployeesTable employees={employees} />
    </div>
  );
}
