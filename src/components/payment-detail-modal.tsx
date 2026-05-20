"use client";

// Read-only modal for a single EmployeePayment row.
//
// Purpose: surface the full detail of one payroll row (SALARY or WAGE)
// without paying the cost of `EmployeeDetailModal`'s full-history fetch.
// All fields displayed are already loaded on the calling row — the modal
// adds zero server round-trips. Just a richer rendering of the same data.
//
// Phase 19 originally left payroll rows in /completed non-clickable
// because the heavier `EmployeeDetailModal` was the only existing option.
// This lightweight modal closes that gap (see KNOWN_GAPS Phase 19 entry).

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { LabeledField } from "@/components/labeled-field";
import { formatCurrency, formatDate } from "@/lib/format";

import type { EmployeePaymentForCompleted } from "@/lib/completed-queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: EmployeePaymentForCompleted | null;
};

export function PaymentDetailModal({ open, onOpenChange, payment }: Props) {
  if (!payment) return null;

  const isSalary = payment.type === "SALARY";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[520px] md:p-6"
        className="bg-surface-container border-outline-variant p-6 gap-0"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-3 flex-wrap">
            <span>{payment.employeeName}</span>
            <TypeChip type={payment.type} />
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div
          data-testid="payment-detail-modal"
          data-payment-id={payment.id}
          className="space-y-5"
        >
          <div className="grid grid-cols-2 gap-5">
            <LabeledField
              label="Employee type"
              value={payment.employeeType === "FIXED" ? "Fixed salary" : "Labour"}
            />
            <LabeledField label="Paid on" value={formatDate(payment.paidAt)} />
          </div>

          <div className="grid grid-cols-2 gap-5">
            <LabeledField
              label={isSalary ? "Salary month start" : "Period start"}
              value={formatDate(payment.periodStart)}
            />
            <LabeledField
              label={isSalary ? "Salary month end" : "Period end"}
              value={formatDate(payment.periodEnd)}
            />
          </div>

          <div>
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-1">
              Amount
            </p>
            <p className="font-display text-2xl tabular-nums text-on-surface">
              {formatCurrency(payment.amount)}
            </p>
          </div>

          <LabeledField label="Note" value={payment.note} multiline />
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
