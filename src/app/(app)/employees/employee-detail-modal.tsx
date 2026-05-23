"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { LabeledField } from "@/components/labeled-field";
import { KarigarLedgerEntryModal } from "@/components/action-modals/karigar-ledger-entry-modal";
import { formatCurrency, formatDate } from "@/lib/format";
import { getEmployeeHistory } from "@/app/(app)/labour/actions";
import { softDeleteKarigarLedgerEntry } from "@/app/(app)/labour/karigar-ledger-actions";

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

type LedgerEntryRow = {
  id: string;
  date: string;
  direction: "INCREASE" | "DECREASE";
  amount: number;
  description: string | null;
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
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingLedger, setEditingLedger] = useState<LedgerEntryRow | null>(
    null,
  );
  const [deletingLedgerId, setDeletingLedgerId] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const reloadHistory = (employeeId: string) => {
    setHistoryLoading(true);
    return getEmployeeHistory(employeeId)
      .then((result) => {
        setPieces(result.pieceEntries);
        setPayments(result.payments);
        setLedgerEntries(result.ledgerEntries);
      })
      .catch(() => {
        // Swallow — sections render "—" empty state if loading fails.
      })
      .finally(() => {
        setHistoryLoading(false);
      });
  };

  useEffect(() => {
    if (!open) {
      setConfirmingDelete(false);
      setEditingLedger(null);
      setLedgerError(null);
      return;
    }
    if (!employee) return;

    let cancelled = false;
    setHistoryLoading(true);
    setPieces([]);
    setPayments([]);
    setLedgerEntries([]);
    setLedgerError(null);
    getEmployeeHistory(employee.id)
      .then((result) => {
        if (cancelled) return;
        setPieces(result.pieceEntries);
        setPayments(result.payments);
        setLedgerEntries(result.ledgerEntries);
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

  const handleDeleteLedger = async (entryId: string) => {
    if (!employee) return;
    setDeletingLedgerId(entryId);
    setLedgerError(null);
    const result = await softDeleteKarigarLedgerEntry(entryId);
    setDeletingLedgerId(null);
    if (!result.ok) {
      setLedgerError(result.errors.message ?? "Delete failed");
      return;
    }
    await reloadHistory(employee.id);
    router.refresh();
  };

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

        {/* Phase 21b.1 — karigar ledger entries (MANUAL_PAYMENT only).
            Pieces and wage payments are surfaced via the other two
            sections; this one shows the direct advances / payments /
            adjustments and provides edit/delete on each. */}
        {employee.type === "LABOUR" && (
          <div className="mt-6" data-testid="karigar-ledger-history-section">
            <h3 className="font-display text-xs uppercase tracking-widest text-on-surface-variant mb-2">
              Karigar ledger entries
            </h3>
            {historyLoading ? (
              <div className="text-xs text-on-surface-variant py-3">Loading…</div>
            ) : ledgerEntries.length === 0 ? (
              <div className="text-xs text-on-surface-variant py-3">
                No direct ledger entries yet.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-outline-variant bg-surface-container-low">
                {ledgerEntries.map((entry, idx) => {
                  const isDebit = entry.direction === "DECREASE";
                  const prefix = isDebit ? "−" : "+";
                  const amountClass = isDebit
                    ? "text-secondary"
                    : "text-on-surface";
                  return (
                    <div
                      key={entry.id}
                      data-testid="karigar-ledger-history-row"
                      data-entry-id={entry.id}
                      className={`grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-xs items-start ${
                        idx % 2 === 0
                          ? "bg-surface-container"
                          : "bg-surface-container-low"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-on-surface">
                            {formatDate(entry.date)}
                          </span>
                          <span
                            className={`font-mono tabular-nums ${amountClass}`}
                          >
                            {prefix}
                            {formatCurrency(entry.amount)}
                          </span>
                        </div>
                        {entry.description && (
                          <div className="mt-0.5 text-on-surface-variant truncate">
                            {entry.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingLedger(entry)}
                          aria-label="Edit ledger entry"
                          className="h-8 w-8 inline-flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
                          data-testid="edit-ledger-entry"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLedger(entry.id)}
                          disabled={deletingLedgerId === entry.id}
                          aria-label="Delete ledger entry"
                          className="h-8 w-8 inline-flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors disabled:opacity-50"
                          data-testid="delete-ledger-entry"
                        >
                          {deletingLedgerId === entry.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {ledgerError && (
              <div
                className="mt-2 text-xs text-error"
                data-testid="karigar-ledger-history-error"
              >
                {ledgerError}
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

      {employee.type === "LABOUR" && editingLedger && (
        <KarigarLedgerEntryModal
          open={!!editingLedger}
          onClose={() => setEditingLedger(null)}
          onSaved={() => {
            if (employee) reloadHistory(employee.id);
          }}
          employee={{ id: employee.id, name: employee.name }}
          editEntry={{
            id: editingLedger.id,
            amountPaise: editingLedger.amount,
            date: new Date(editingLedger.date),
            direction: editingLedger.direction,
            description: editingLedger.description ?? "",
          }}
        />
      )}
    </ResponsiveDialog>
  );
}
