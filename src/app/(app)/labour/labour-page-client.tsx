"use client";

// Phase 18 — /labour interactive shell.
//
// Composes three sections (PendingSalariesSection, OutstandingWagesSection,
// BulkPieceEntrySection) plus the EmployeePaymentModal that's pulled
// open by Pay buttons in sections 1 + 2.
//
// Modal state lives at the shell level so a single modal instance is
// shared across both sections — only one Pay flow is open at a time.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmployeePaymentModal } from "@/components/action-modals/employee-payment-modal";
import {
  endOfCurrentMonthIST,
  startOfCurrentMonthIST,
} from "@/lib/format";

import { PendingSalariesSection } from "./pending-salaries-section";
import { OutstandingWagesSection } from "./outstanding-wages-section";
import { BulkPieceEntrySection } from "./bulk-piece-entry-section";
import type {
  MissingSalaryEmployee,
  EmployeeWagesRollup,
} from "@/lib/labour-balances";
import type { EmployeeForClient } from "../employees/types";

type ModalState =
  | { open: false }
  | {
      open: true;
      employee: { id: string; name: string; type: "FIXED" | "LABOUR" };
      paymentType: "SALARY" | "WAGE";
      defaultAmount: number;
      defaultPeriodStart: Date;
      defaultPeriodEnd: Date;
      contextLabel: string;
    };

type Props = {
  pendingSalaries: MissingSalaryEmployee[];
  outstandingWages: EmployeeWagesRollup[];
  labourEmployees: EmployeeForClient[];
};

export function LabourPageClient({
  pendingSalaries,
  outstandingWages,
  labourEmployees,
}: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>({ open: false });

  function openSalaryModal(row: MissingSalaryEmployee) {
    setModal({
      open: true,
      employee: { ...row.employee, type: "FIXED" },
      paymentType: "SALARY",
      defaultAmount: row.monthlySalary,
      defaultPeriodStart: startOfCurrentMonthIST(),
      // periodEnd stored as the day before next month's start so the
      // half-open [start, end+1) range matches the inclusive period
      // semantics labour-balances uses.
      defaultPeriodEnd: new Date(endOfCurrentMonthIST().getTime() - 24 * 60 * 60 * 1000),
      contextLabel: row.currentMonth,
    });
  }

  function openWageModal(row: EmployeeWagesRollup) {
    const start = row.earliestUnpaidDate ?? new Date();
    const end = new Date();
    setModal({
      open: true,
      employee: { ...row.employee, type: "LABOUR" },
      paymentType: "WAGE",
      defaultAmount: row.totalAmount,
      defaultPeriodStart: start,
      defaultPeriodEnd: end,
      contextLabel: `${row.totalPieces} pieces · earliest unpaid ${start.toISOString().slice(0, 10)}`,
    });
  }

  return (
    <div className="space-y-10">
      <PendingSalariesSection
        rows={pendingSalaries}
        onPayClick={openSalaryModal}
      />
      <OutstandingWagesSection
        rows={outstandingWages}
        onPayClick={openWageModal}
      />
      <BulkPieceEntrySection
        employees={labourEmployees}
        onSaved={() => router.refresh()}
      />

      {modal.open && (
        <EmployeePaymentModal
          open={modal.open}
          onClose={() => setModal({ open: false })}
          onSaved={() => router.refresh()}
          employee={modal.employee}
          paymentType={modal.paymentType}
          defaultAmount={modal.defaultAmount}
          defaultPeriodStart={modal.defaultPeriodStart}
          defaultPeriodEnd={modal.defaultPeriodEnd}
          contextLabel={modal.contextLabel}
        />
      )}
    </div>
  );
}
