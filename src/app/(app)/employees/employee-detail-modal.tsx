"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { LabeledField } from "@/components/labeled-field";
import { formatCurrency, formatDate } from "@/lib/format";
import { getEmployeeHistory } from "@/app/(app)/labour/actions";

import { softDeleteEmployee } from "./actions";
import { TypeChip } from "./type-chip";
import type { EmployeeForClient } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeForClient | null;
  onEdit: () => void;
};

type PieceHistoryRow = {
  id: string;
  date: string;
  count: number;
  ratePerPiece: number;
  totalAmount: number;
  note: string | null;
};

type PaymentHistoryRow = {
  id: string;
  type: "SALARY" | "WAGE";
  paidAt: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  note: string | null;
};

export function EmployeeDetailModal({
  open,
  onOpenChange,
  employee,
  onEdit,
}: Props) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [pieces, setPieces] = useState<PieceHistoryRow[]>([]);
  const [payments, setPayments] = useState<PaymentHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      return;
    }
    if (!employee) return;

    let cancelled = false;
    setHistoryLoading(true);
    setPieces([]);
    setPayments([]);
    getEmployeeHistory(employee.id)
      .then((result) => {
        if (cancelled) return;
        setPieces(result.pieceEntries);
        setPayments(result.payments);
      })
      .catch(() => {
        if (cancelled) return;
        // Swallow — sections render "—" empty state if loading fails.
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, employee?.id, employee]);

  if (!employee) return null;

  const handleDelete = () => {
    startTransition(async () => {
      await softDeleteEmployee(employee.id);
      setConfirmingDelete(false);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[500px] md:p-6"
        mobileClassName="p-4"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            <span className="inline-flex items-center gap-3 flex-wrap">
              <span>{employee.name}</span>
              <TypeChip type={employee.type} />
            </span>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-5">
          <LabeledField label="Phone" value={employee.phone} />
          {/* monthlySalary only shown for FIXED — LABOUR has no salary by design. */}
          {employee.type === "FIXED" && (
            <LabeledField
              label="Monthly salary"
              value={formatCurrency(employee.monthlySalary)}
            />
          )}
          <LabeledField label="Address" value={employee.address} multiline />
          <LabeledField label="Notes" value={employee.notes} multiline />
          <LabeledField label="Created" value={formatDate(employee.createdAt)} />
        </div>

        {/* Phase 18: pieces + payment history. Hidden during initial
            load to avoid flicker; sections render their own empty
            states once loaded. */}
        {employee.type === "LABOUR" && (
          <div className="mt-6" data-testid="pieces-history-section">
            <h3 className="font-display text-xs uppercase tracking-widest text-on-surface-variant mb-2">
              Pieces history
            </h3>
            {historyLoading ? (
              <div className="text-xs text-on-surface-variant py-3">Loading…</div>
            ) : pieces.length === 0 ? (
              <div className="text-xs text-on-surface-variant py-3">
                No piece entries yet.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-outline-variant bg-surface-container-low">
                {pieces.map((p, idx) => (
                  <div
                    key={p.id}
                    className={`px-3 py-1.5 text-xs ${
                      idx % 2 === 0
                        ? "bg-surface-container"
                        : "bg-surface-container-low"
                    }`}
                  >
                    <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center">
                      <span className="text-on-surface">{formatDate(p.date)}</span>
                      <span className="tabular-nums text-on-surface-variant">
                        {p.count} × {formatCurrency(p.ratePerPiece)}
                      </span>
                      <span className="tabular-nums font-mono text-on-surface">
                        {formatCurrency(p.totalAmount)}
                      </span>
                    </div>
                    {p.note && (
                      <div
                        className="mt-0.5 text-on-surface-variant italic truncate"
                        data-testid={`piece-history-note-${p.id}`}
                      >
                        {p.note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-6" data-testid="payment-history-section">
          <h3 className="font-display text-xs uppercase tracking-widest text-on-surface-variant mb-2">
            Payment history
          </h3>
          {historyLoading ? (
            <div className="text-xs text-on-surface-variant py-3">Loading…</div>
          ) : payments.length === 0 ? (
            <div className="text-xs text-on-surface-variant py-3">
              No payments yet.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-outline-variant bg-surface-container-low">
              {payments.map((p, idx) => (
                <div
                  key={p.id}
                  className={`grid grid-cols-[auto_1fr_auto] gap-3 px-3 py-1.5 text-xs items-center ${
                    idx % 2 === 0
                      ? "bg-surface-container"
                      : "bg-surface-container-low"
                  }`}
                >
                  <span className="font-display uppercase tracking-wider text-[10px] text-on-surface-variant">
                    {p.type === "SALARY" ? "Salary" : "Wage"}
                  </span>
                  <span className="text-on-surface-variant">
                    {formatDate(p.paidAt)} ·{" "}
                    <span className="text-on-surface-variant/70">
                      {formatDate(p.periodStart)}–{formatDate(p.periodEnd)}
                    </span>
                  </span>
                  <span className="tabular-nums font-mono text-on-surface">
                    {formatCurrency(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 -mx-4 -mb-4 md:-mx-6 md:-mb-6 px-4 md:px-6 py-4 border-t border-outline-variant">
          {confirmingDelete ? (
            <div className="flex flex-col-reverse md:flex-row md:items-center gap-3">
              <p className="md:flex-1 text-sm text-on-surface">
                Delete employee? This can be undone by an admin.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isPending}
                  className="h-11 md:h-9 px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="min-w-[100px] h-11 md:h-9 px-3 font-display text-sm font-medium uppercase tracking-wider bg-error text-on-error hover:bg-error/90 disabled:opacity-70 transition-colors flex items-center justify-center gap-2"
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="h-11 md:h-9 px-3 py-2 text-sm text-error hover:bg-surface-container transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="h-11 md:h-9 px-4 bg-secondary-container text-on-secondary-container font-display text-sm font-medium uppercase tracking-wider hover:bg-secondary-container/90 transition-colors"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
