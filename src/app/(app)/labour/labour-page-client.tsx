"use client";

// Phase 18 — /labour interactive shell.
// Phase 21b.1 — replaced OutstandingWagesSection with KarigarLedgerSection
//   and added KarigarLedgerEntryModal for direct ledger entries
//   (advances / payments / adjustments). The Pay button still routes to
//   the WAGE EmployeePaymentModal (settlement against work done).
//
// Composes four sections (PendingSalariesSection, KarigarLedgerSection,
// BulkPieceEntrySection — historically three; the karigar-ledger row
// list replaces the outstanding-wages list). Two modals share state at
// the shell level so a single instance of each is reused.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { EmployeePaymentModal } from "@/components/action-modals/employee-payment-modal";
import { KarigarLedgerEntryModal } from "@/components/action-modals/karigar-ledger-entry-modal";

import { PendingSalariesSection } from "./pending-salaries-section";
import { KarigarLedgerSection } from "./karigar-ledger-section";
import { BulkPieceEntrySection } from "./bulk-piece-entry-section";
import type {
  MissingSalaryEmployee,
  KarigarBalanceRow,
} from "@/lib/labour-balances";
import type { EmployeeForClient } from "../employees/types";

type PaymentModalState =
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

type KarigarLedgerModalState =
  | { open: false }
  | {
      open: true;
      employee: { id: string; name: string };
    };

type Props = {
  pendingSalaries: MissingSalaryEmployee[];
  karigarBalances: KarigarBalanceRow[];
  labourEmployees: EmployeeForClient[];
};

export function LabourPageClient({
  pendingSalaries,
  karigarBalances,
  labourEmployees,
}: Props) {
  const router = useRouter();
  const [paymentModal, setPaymentModal] = useState<PaymentModalState>({
    open: false,
  });
  const [ledgerModal, setLedgerModal] = useState<KarigarLedgerModalState>({
    open: false,
  });

  function openSalaryModal(row: MissingSalaryEmployee) {
    // periodStart stored as midnight-UTC of the IST month's first day;
    // periodEnd stored as midnight-UTC of the last IST day (matches the
    // monthly-reminder model).
    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const periodStart = new Date(Date.UTC(year, month, 1));
    const periodEnd = new Date(Date.UTC(year, month + 1, 0));
    setPaymentModal({
      open: true,
      employee: { ...row.employee, type: "FIXED" },
      paymentType: "SALARY",
      defaultAmount: row.monthlySalary,
      defaultPeriodStart: periodStart,
      defaultPeriodEnd: periodEnd,
      contextLabel: row.currentMonth,
    });
  }

  function openWageModal(row: KarigarBalanceRow) {
    // Wages: period defaults to "this month so far" — the workshop owner
    // can override on the modal. Phase 21b moved coverage from period-
    // overlap to ledger-derived; the period is now purely informational
    // (audit trail, no longer drives outstanding calculation).
    const now = new Date();
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const periodStart = new Date(Date.UTC(year, month, 1));
    const periodEnd = now;
    setPaymentModal({
      open: true,
      employee: { ...row.employee, type: "LABOUR" },
      paymentType: "WAGE",
      defaultAmount: row.balance > 0 ? row.balance : 0,
      defaultPeriodStart: periodStart,
      defaultPeriodEnd: periodEnd,
      contextLabel: `Outstanding ${row.balance > 0 ? "" : "₹0"}`.trim(),
    });
  }

  function openLedgerModal(row: KarigarBalanceRow) {
    setLedgerModal({
      open: true,
      employee: { id: row.employee.id, name: row.employee.name },
    });
  }

  return (
    <div className="space-y-10">
      <PendingSalariesSection
        rows={pendingSalaries}
        onPayClick={openSalaryModal}
      />
      <KarigarLedgerSection
        rows={karigarBalances}
        onPayClick={openWageModal}
        onRecordEntryClick={openLedgerModal}
      />
      <BulkPieceEntrySection
        employees={labourEmployees}
        onSaved={() => router.refresh()}
      />

      {paymentModal.open && (
        <EmployeePaymentModal
          open={paymentModal.open}
          onClose={() => setPaymentModal({ open: false })}
          onSaved={() => router.refresh()}
          employee={paymentModal.employee}
          paymentType={paymentModal.paymentType}
          defaultAmount={paymentModal.defaultAmount}
          defaultPeriodStart={paymentModal.defaultPeriodStart}
          defaultPeriodEnd={paymentModal.defaultPeriodEnd}
          contextLabel={paymentModal.contextLabel}
        />
      )}

      {ledgerModal.open && (
        <KarigarLedgerEntryModal
          open={ledgerModal.open}
          onClose={() => setLedgerModal({ open: false })}
          onSaved={() => router.refresh()}
          employee={ledgerModal.employee}
        />
      )}
    </div>
  );
}
