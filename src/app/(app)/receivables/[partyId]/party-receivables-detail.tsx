"use client";

// Phase 21a — party-receivables ledger statement view.
//
// Mirror of party-payables-detail.tsx. ADMIN-only access; no scope
// footnote (ADMIN always sees the true net balance, including
// MANUAL_PAYMENT entries against this party).
//
// Phase 21a.1: MANUAL_PAYMENT rows are editable + deletable in-place.
// TRANSACTION_LINKED rows are read-only at the ledger level.

import { useState, useTransition } from "react";
import { DollarSign, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { formatCurrency, formatDate } from "@/lib/format";
import type { Party } from "@/generated/prisma";
import type { PartyLedgerEntryForClient } from "@/lib/outstanding-balances";

import {
  PartyLedgerPaymentModal,
  type PartyLedgerPaymentEditTarget,
} from "@/components/action-modals/party-ledger-payment-modal";
import { softDeleteLedgerEntry } from "@/app/(app)/parties/ledger-actions";

type Props = {
  party: Party;
  totalOutstanding: number;
  entries: PartyLedgerEntryForClient[];
};

export function PartyReceivablesDetail({
  party,
  totalOutstanding,
  entries,
}: Props) {
  const router = useRouter();
  const [receiving, setReceiving] = useState(false);
  const [editing, setEditing] = useState<PartyLedgerPaymentEditTarget | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleDelete(id: string) {
    setDeleteError(null);
    startTransition(async () => {
      const result = await softDeleteLedgerEntry(id);
      if (!result.ok) {
        setDeleteError(result.errors.message ?? "Failed to delete entry.");
        return;
      }
      setDeletingId(null);
      router.refresh();
    });
  }

  const isCredit = totalOutstanding < 0;
  const balanceLabel = isCredit ? "Credit balance" : "Outstanding";
  const displayAmount = Math.abs(totalOutstanding);

  return (
    <>
      <div className="border border-outline-variant bg-surface-container-low p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">
            {balanceLabel}
          </div>
          <div
            className={`text-2xl md:text-3xl font-display tabular-nums ${
              isCredit ? "text-secondary" : "text-on-surface"
            }`}
            data-testid="party-balance"
            data-signed={totalOutstanding}
          >
            {formatCurrency(displayAmount)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReceiving(true)}
          className="h-11 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          data-testid="add-payment-button"
        >
          <DollarSign className="size-4" />
          <span>Receive Payment</span>
        </button>
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
            No ledger activity for this customer yet.
          </p>
        </div>
      ) : (
        <LedgerStatement
          entries={entries}
          confirmDeleteId={deletingId}
          onRequestEdit={(entry) =>
            setEditing({
              id: entry.id,
              amountPaise: entry.amount,
              date: entry.date,
              description: entry.description,
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

      {receiving && (
        <PartyLedgerPaymentModal
          open={receiving}
          onClose={() => setReceiving(false)}
          onSaved={() => setReceiving(false)}
          direction="receivable"
          party={{ id: party.id, name: party.name, phone: party.phone }}
        />
      )}

      {editing && (
        <PartyLedgerPaymentModal
          open={editing !== null}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          direction="receivable"
          party={{ id: party.id, name: party.name, phone: party.phone }}
          editEntry={editing}
        />
      )}
    </>
  );
}

function LedgerStatement({
  entries,
  confirmDeleteId,
  onRequestEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  entries: PartyLedgerEntryForClient[];
  confirmDeleteId: string | null;
  onRequestEdit: (entry: PartyLedgerEntryForClient) => void;
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
              Increase
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-28">
              Decrease
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
            return (
              <tr
                key={e.id}
                data-testid="ledger-entry-row"
                data-entry-type={e.entryType}
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
                        Payment
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
                          aria-label="Edit payment"
                          data-testid="ledger-edit-button"
                          className="size-8 inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                          title="Edit payment"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRequestDelete(e.id)}
                          aria-label="Delete payment"
                          data-testid="ledger-delete-button"
                          className="size-8 inline-flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                          title="Delete payment"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    )
                  ) : (
                    <span
                      className="text-[10px] text-on-surface-variant italic"
                      title="Edit or delete via the source transaction"
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
