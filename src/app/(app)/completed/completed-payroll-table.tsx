"use client";

// Phase 19 — read-only completed-payroll table.
//
// Each row is one EmployeePayment (SALARY or WAGE — both inherently
// completed events; the discriminator is purely informational on this
// surface). Row click opens the lightweight `PaymentDetailModal`
// (polish session follow-up to Phase 19) with the same already-loaded
// data rendered in a fuller layout — no server round-trip.

import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";
import { formatCurrency, formatDate } from "@/lib/format";

import type { EmployeePaymentForCompleted } from "@/lib/completed-queries";

type Props = {
  payments: EmployeePaymentForCompleted[];
  onRowClick?: (id: string) => void;
};

export function CompletedPayrollTable({ payments, onRowClick }: Props) {
  return (
    <ResponsiveTable
      desktopTable={
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high sticky top-0">
              <tr>
                <Th>Paid on</Th>
                <Th>Employee</Th>
                <Th>Type</Th>
                <Th>Period</Th>
                <Th className="text-right">Amount</Th>
                <Th>Note</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr
                  key={p.id}
                  data-testid={`completed-payroll-row-${p.id}`}
                  onClick={onRowClick ? () => onRowClick(p.id) : undefined}
                  className={`odd:bg-surface-container-low even:bg-surface-container border-b border-outline-variant last:border-b-0 ${
                    onRowClick ? "cursor-pointer hover:bg-surface-container-high transition-colors" : ""
                  }`}
                >
                  <Td>
                    <span className="text-on-surface-variant tabular-nums">
                      {formatDate(p.paidAt)}
                    </span>
                  </Td>
                  <Td>
                    <div className="text-on-surface truncate">
                      {p.employeeName}
                    </div>
                    <div className="text-on-surface-variant text-xs uppercase tracking-wider">
                      {p.employeeType === "FIXED" ? "Fixed" : "Labour"}
                    </div>
                  </Td>
                  <Td>
                    <TypeChip type={p.type} />
                  </Td>
                  <Td>
                    <span className="text-on-surface-variant tabular-nums text-xs">
                      {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <span className="text-on-surface tabular-nums font-mono">
                      {formatCurrency(p.amount)}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-on-surface-variant text-xs">
                      {p.note ?? "—"}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      mobileCards={
        <>
          {payments.map((p) => (
            <MobileCard
              key={p.id}
              data-testid={`completed-payroll-card-${p.id}`}
              onClick={onRowClick ? () => onRowClick(p.id) : undefined}
              clickable={Boolean(onRowClick)}
            >
              <MobileCardHeader>
                <MobileCardTitle>
                  <span className="truncate">{p.employeeName}</span>
                  <div className="text-xs text-on-surface-variant uppercase tracking-wider mt-0.5">
                    {p.employeeType === "FIXED" ? "Fixed salary" : "Labour"}
                  </div>
                </MobileCardTitle>
                <TypeChip type={p.type} />
              </MobileCardHeader>
              <div className="text-xs text-on-surface-variant">
                Period: {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
              </div>
              {p.note && (
                <div className="text-xs text-on-surface-variant italic">
                  {p.note}
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-on-surface-variant tabular-nums">
                  {formatDate(p.paidAt)}
                </span>
                <span className="text-lg font-display tabular-nums text-on-surface">
                  {formatCurrency(p.amount)}
                </span>
              </div>
            </MobileCard>
          ))}
        </>
      }
    />
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 align-middle ${className ?? ""}`}>{children}</td>
  );
}

function TypeChip({ type }: { type: "SALARY" | "WAGE" }) {
  const isSalary = type === "SALARY";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider border whitespace-nowrap ${
        isSalary
          ? "bg-secondary/10 border-secondary/30 text-secondary"
          : "bg-tertiary/10 border-tertiary/30 text-on-surface-variant"
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${isSalary ? "bg-secondary" : "bg-tertiary"}`}
        aria-hidden
      />
      {isSalary ? "Salary" : "Wage"}
    </span>
  );
}
