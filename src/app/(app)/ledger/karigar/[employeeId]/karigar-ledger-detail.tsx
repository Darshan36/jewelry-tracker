"use client";

// Phase 21c.1 — Per-karigar khata view. NEW surface that completes
// Phase 21b's deferred view layer. Mirrors party-ledger-detail.tsx
// shape but for the employee owner.
//
// Three actions surfaced in the header:
//   1. "Record entry" — ALWAYS visible. Opens KarigarLedgerEntryModal
//      to post a direct MANUAL_PAYMENT (advance / payment / opening /
//      adjustment). This is the always-available-surface pattern from
//      Phase 21b.1: the action makes sense regardless of balance state.
//   2. "Settle wages" — visible only when balance > 0 (shop owes
//      wages). Opens EmployeePaymentModal in WAGE mode with the
//      outstanding amount prefilled. Settles wages against work done.
//   3. Per-row edit / delete on MANUAL_PAYMENT entries. PIECE_ENTRY
//      and WAGE_PAYMENT (TRANSACTION_LINKED) rows show the "via source"
//      hint — they're corrected at their source PieceEntry /
//      EmployeePayment record (the same pattern party-ledger-detail
//      uses for its TRANSACTION_LINKED Sale/Purchase entries).
//
// Balance label is sign-aware:
//   - > 0 → "Owed wages" (shop owes karigar)
//   - = 0 → "Caught up"
//   - < 0 → "Advance held" (karigar holds an advance; credit balance)

import { useState, useTransition } from "react";
import { DollarSign, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { formatCurrency, formatDate } from "@/lib/format";
import type { LedgerEntryForClient } from "@/lib/ledger";

import {
  KarigarLedgerEntryModal,
  type KarigarLedgerEditTarget,
} from "@/components/action-modals/karigar-ledger-entry-modal";
import { EmployeePaymentModal } from "@/components/action-modals/employee-payment-modal";
import { softDeleteKarigarLedgerEntry } from "@/app/(app)/labour/karigar-ledger-actions";

type Props = {
  employee: { id: string; name: string };
  balance: number;
  entries: LedgerEntryForClient[];
};

function startOfCurrentIstMonth(): Date {
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1));
}

export function KarigarLedgerDetail({ employee, balance, entries }: Props) {
  const router = useRouter();
  const [recording, setRecording] = useState(false);
  const [settlingWages, setSettlingWages] = useState(false);
  const [editing, setEditing] = useState<KarigarLedgerEditTarget | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleDelete(id: string) {
    setDeleteError(null);
    startTransition(async () => {
      const result = await softDeleteKarigarLedgerEntry(id);
      if (!result.ok) {
        setDeleteError(result.errors.message ?? "Failed to delete entry.");
        return;
      }
      setDeletingId(null);
      router.refresh();
    });
  }

  // Balance label + tone
  let balanceLabel: string;
  let balanceTone: "neutral" | "owed" | "credit";
  if (balance > 0) {
    balanceLabel = "Owed wages";
    balanceTone = "owed";
  } else if (balance < 0) {
    balanceLabel = "Advance held";
    balanceTone = "credit";
  } else {
    balanceLabel = "Caught up";
    balanceTone = "neutral";
  }
  const display = formatCurrency(Math.abs(balance));
  const balanceAmountClass =
    balanceTone === "credit"
      ? "text-secondary"
      : balanceTone === "neutral"
        ? "text-on-surface-variant"
        : "text-on-surface";

  return (
    <>
      <div className="border border-outline-variant bg-surface-container-low p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">
            {balanceLabel}
          </div>
          <div
            className={`text-2xl md:text-3xl font-display tabular-nums ${balanceAmountClass}`}
            data-testid="karigar-balance"
            data-signed={balance}
          >
            {balance < 0 ? "−" : ""}
            {display}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRecording(true)}
            data-testid="record-entry-button"
            className="h-11 px-4 border border-outline-variant bg-surface-container-low text-on-surface font-display text-sm font-medium uppercase tracking-wider hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2"
          >
            <NotebookPen className="size-4" />
            <span>Record entry</span>
          </button>
          {balance > 0 && (
            <button
              type="button"
              onClick={() => setSettlingWages(true)}
              data-testid="settle-wages-button"
              className="h-11 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <DollarSign className="size-4" />
              <span>Settle wages</span>
            </button>
          )}
        </div>
      </div>

      {deleteError && (
        <div
          role="alert"
          className="mb-3 px-3 py-2 border border-error/30 bg-error/10 text-error text-xs"
          data-testid="ledger-delete-error"
        >
          {deleteError}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No ledger activity for this karigar yet. Tap{" "}
            <span className="font-medium">Record entry</span> to log an
            advance, payment, or opening balance.
          </p>
        </div>
      ) : (
        <KarigarStatement
          entries={entries}
          confirmDeleteId={deletingId}
          onRequestEdit={(entry) =>
            setEditing({
              id: entry.id,
              amountPaise: entry.amount,
              date: entry.date,
              direction: entry.direction,
              description: entry.description ?? "",
            })
          }
          onRequestDelete={(id) => {
            setDeleteError(null);
            setDeletingId(id);
          }}
          onCancelDelete={() => setDeletingId(null)}
          onConfirmDelete={handleDelete}
        />
      )}

      {recording && (
        <KarigarLedgerEntryModal
          open={recording}
          onClose={() => setRecording(false)}
          onSaved={() => setRecording(false)}
          employee={employee}
        />
      )}

      {editing && (
        <KarigarLedgerEntryModal
          open={editing !== null}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          employee={employee}
          editEntry={editing}
        />
      )}

      {settlingWages && (
        <EmployeePaymentModal
          open={settlingWages}
          onClose={() => setSettlingWages(false)}
          onSaved={() => setSettlingWages(false)}
          employee={{ ...employee, type: "LABOUR" }}
          paymentType="WAGE"
          defaultAmount={balance > 0 ? balance : 0}
          defaultPeriodStart={startOfCurrentIstMonth()}
          defaultPeriodEnd={new Date()}
          contextLabel={balance > 0 ? `Outstanding ${formatCurrency(balance)}` : ""}
        />
      )}
    </>
  );
}

function KarigarStatement({
  entries,
  confirmDeleteId,
  onRequestEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  entries: LedgerEntryForClient[];
  confirmDeleteId: string | null;
  onRequestEdit: (entry: LedgerEntryForClient) => void;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
}) {
  return (
    <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-container-high">
          <tr>
            <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-32">
              Date
            </th>
            <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
              Description
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-28">
              Work / Adj
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-28">
              Paid / Adv
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-32">
              Balance
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-36">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, idx) => {
            const editable = e.entryType === "MANUAL_PAYMENT";
            const isConfirming = confirmDeleteId === e.id;
            const sourceChipLabel = sourceTypeChip(e.sourceType);
            return (
              <tr
                key={e.id}
                data-testid="ledger-entry-row"
                data-entry-type={e.entryType}
                data-source-type={e.sourceType ?? ""}
                className={`${
                  idx % 2 === 0
                    ? "bg-surface-container-low"
                    : "bg-surface-container"
                } border-b border-outline-variant last:border-b-0`}
              >
                <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                  {formatDate(e.date)}
                </td>
                <td className="px-4 py-3 text-on-surface">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{e.description ?? "—"}</span>
                    {e.entryType === "MANUAL_PAYMENT" && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-secondary-container text-on-secondary-container border border-secondary/30"
                        data-testid="manual-payment-tag"
                      >
                        Direct
                      </span>
                    )}
                    {sourceChipLabel && (
                      <span
                        data-testid="source-chip"
                        className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-primary/10 text-primary border border-primary/30"
                      >
                        {sourceChipLabel}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                  {e.direction === "INCREASE" ? formatCurrency(e.amount) : ""}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                  {e.direction === "DECREASE" ? formatCurrency(e.amount) : ""}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums font-mono ${
                    e.runningBalance < 0 ? "text-secondary" : "text-on-surface"
                  }`}
                >
                  {e.runningBalance < 0 ? "−" : ""}
                  {formatCurrency(Math.abs(e.runningBalance))}
                </td>
                <td className="px-4 py-3 text-right">
                  {editable ? (
                    isConfirming ? (
                      <span
                        className="inline-flex items-center gap-1"
                        data-testid="ledger-confirm-delete"
                      >
                        <button
                          type="button"
                          onClick={() => onConfirmDelete(e.id)}
                          className="px-2 py-1 text-[10px] uppercase tracking-wider bg-error text-on-error hover:bg-error/90 transition-colors"
                          aria-label="Confirm delete"
                        >
                          Delete?
                        </button>
                        <button
                          type="button"
                          onClick={onCancelDelete}
                          className="px-2 py-1 text-[10px] uppercase tracking-wider border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors"
                          aria-label="Cancel delete"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onRequestEdit(e)}
                          aria-label="Edit entry"
                          data-testid="ledger-edit-button"
                          className="size-8 inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                          title="Edit entry"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRequestDelete(e.id)}
                          aria-label="Delete entry"
                          data-testid="ledger-delete-button"
                          className="size-8 inline-flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    )
                  ) : (
                    <span
                      className="text-[10px] text-on-surface-variant italic"
                      title="Edit or delete via the source piece entry or wage payment"
                      data-testid="ledger-readonly-hint"
                    >
                      via source
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function sourceTypeChip(
  sourceType: LedgerEntryForClient["sourceType"],
): string | null {
  if (sourceType === "PIECE_ENTRY") return "Pieces";
  if (sourceType === "WAGE_PAYMENT") return "Wage";
  return null;
}
