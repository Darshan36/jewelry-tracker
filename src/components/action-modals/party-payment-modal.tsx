"use client";

// Party-level bulk payment modal (Phase 17b).
//
// Renders a list of unpaid transactions for one party, lets the user
// check which ones to pay, edits per-row amount (default = full
// outstanding), and submits as an atomic bulk via createPartyPayment.
//
// Direction:
//   - "payable":  paying a supplier/vendor — uses Payment direction
//     for purchases/casting/plating
//   - "receivable":  receiving from a customer — uses Payment direction
//     for sales
//
// The action type stays PAYMENT in both cases; the direction is encoded
// in the entityType per allocation. (REFUND-mode bulk payments aren't
// surfaced — refunds remain single-transaction via PaymentActionModal.)

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Paperclip } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import {
  FormError,
  FormInput,
  FormLabel,
  FormTextarea,
} from "@/components/form-controls";
import { formatCurrency, formatDate, todayIsoIST } from "@/lib/format";

import { createPartyPayment } from "@/app/(app)/parties/actions";
import type { PartyPaymentAllocation } from "@/app/(app)/parties/types";

export type PartyPaymentDirection = "payable" | "receivable";

export type PartyPaymentTransaction = {
  entityType: PartyPaymentAllocation["entityType"];
  entityId: string;
  date: Date | string;
  /** Short label for the transaction (e.g. "Purchase · Gold chain + 1 more"). */
  label: string;
  /** Total in paise (Number, JSON-safe). */
  total: number;
  /** Outstanding amount in paise (Number). */
  outstanding: number;
  hasAttachment: boolean;
};

export type PartyPaymentModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  direction: PartyPaymentDirection;
  party: {
    id: string;
    name: string;
    phone: string | null;
  };
  transactions: PartyPaymentTransaction[];
};

type RowState = {
  selected: boolean;
  /** Amount in rupees (the form's wire format). */
  amount: string;
  /** Per-row error from server validation. */
  error: string | null;
};

function paiseToRupeeString(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function PartyPaymentModal({
  open,
  onClose,
  onSaved,
  direction,
  party,
  transactions,
}: PartyPaymentModalProps) {
  const router = useRouter();
  const [date, setDate] = useState<string>(todayIsoIST());
  const [note, setNote] = useState<string>("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset row state every time the modal opens. Defaults: nothing
  // selected; amount = full outstanding for each row.
  useEffect(() => {
    if (!open) return;
    const initial: Record<string, RowState> = {};
    for (const t of transactions) {
      initial[t.entityId] = {
        selected: false,
        amount: paiseToRupeeString(t.outstanding),
        error: null,
      };
    }
    setRows(initial);
    setTopError(null);
    setDate(todayIsoIST());
    setNote("");
  }, [open, transactions]);

  const total = useMemo(() => {
    let sum = 0;
    for (const t of transactions) {
      const row = rows[t.entityId];
      if (!row?.selected) continue;
      const n = Number(row.amount);
      if (Number.isFinite(n) && n > 0) sum += n;
    }
    return sum;
  }, [rows, transactions]);

  const selectedCount = Object.values(rows).filter((r) => r.selected).length;
  const canSave = selectedCount > 0 && total > 0 && !saving;

  function setRow(entityId: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [entityId]: { ...prev[entityId], ...patch },
    }));
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setTopError(null);

    const allocations: PartyPaymentAllocation[] = [];
    const entityIndexById: Record<string, number> = {};
    for (const t of transactions) {
      const row = rows[t.entityId];
      if (!row?.selected) continue;
      const amount = Number(row.amount);
      entityIndexById[t.entityId] = allocations.length;
      allocations.push({
        entityType: t.entityType,
        entityId: t.entityId,
        amount,
      });
    }

    const result = await createPartyPayment({
      date: new Date(date),
      type: "PAYMENT",
      note: note.trim() || null,
      allocations,
    });

    setSaving(false);

    if (!result.ok) {
      if (result.errors.message) {
        setTopError(result.errors.message);
      }
      if (result.errors.allocations) {
        const newRows = { ...rows };
        // Reverse-map allocation index back to entityId.
        const idToIndex = entityIndexById;
        for (const [entityId, idx] of Object.entries(idToIndex)) {
          const msgs = result.errors.allocations[idx];
          if (msgs && msgs.length > 0) {
            newRows[entityId] = { ...newRows[entityId], error: msgs[0] };
          }
        }
        setRows(newRows);
      }
      return;
    }

    onSaved();
    router.refresh();
    onClose();
  }

  const directionLabel =
    direction === "payable" ? `Pay ${party.name}` : `Receive from ${party.name}`;

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="sm:max-w-2xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{directionLabel}</ResponsiveDialogTitle>
          {party.phone && (
            <p className="text-xs text-on-surface-variant tabular-nums">
              {party.phone}
            </p>
          )}
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          {/* Date + Note row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FormLabel htmlFor="party-payment-date" required>
                Date
              </FormLabel>
              <FormInput
                id="party-payment-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <FormLabel htmlFor="party-payment-note">Note</FormLabel>
              <FormTextarea
                id="party-payment-note"
                rows={1}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          {/* Transactions list */}
          <div className="border border-outline-variant bg-surface-container-low">
            <div className="grid grid-cols-[36px_1fr_120px_120px] gap-2 px-3 py-2 bg-surface-container-high text-xs uppercase tracking-wider font-display text-on-surface-variant">
              <span></span>
              <span>Transaction</span>
              <span className="text-right">Outstanding</span>
              <span className="text-right">Pay (₹)</span>
            </div>
            {transactions.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-on-surface-variant">
                No outstanding transactions.
              </div>
            )}
            {transactions.map((t) => {
              const row = rows[t.entityId];
              if (!row) return null;
              return (
                <div key={t.entityId}>
                  <div className="grid grid-cols-[36px_1fr_120px_120px] gap-2 px-3 py-2 items-center border-b border-outline-variant/50 last:border-b-0">
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onChange={(e) =>
                        setRow(t.entityId, { selected: e.target.checked, error: null })
                      }
                      aria-label={`Include ${t.label}`}
                      className="size-4 accent-primary"
                    />
                    <div className="min-w-0">
                      <div className="text-sm text-on-surface truncate flex items-center gap-2">
                        <span className="truncate">{t.label}</span>
                        {!t.hasAttachment && (
                          <span
                            data-testid="missing-attachment-badge"
                            title="Missing bill attachment"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-error/10 text-error border border-error/30"
                          >
                            <Paperclip className="size-3" />
                            Missing
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-on-surface-variant tabular-nums">
                        {formatDate(t.date)}
                      </div>
                    </div>
                    <div className="text-right text-sm tabular-nums font-mono text-on-surface">
                      {formatCurrency(t.outstanding)}
                    </div>
                    <div>
                      <FormInput
                        id={`party-payment-amount-${t.entityId}`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        value={row.amount}
                        onChange={(e) =>
                          setRow(t.entityId, {
                            amount: e.target.value,
                            error: null,
                          })
                        }
                        disabled={!row.selected}
                      />
                    </div>
                  </div>
                  {row.error && (
                    <div className="px-3 pb-2 text-xs text-error">
                      <AlertCircle className="inline size-3 mr-1" />
                      {row.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Sum line */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-on-surface-variant">
              {selectedCount} selected · sum
            </span>
            <span className="text-lg font-display tabular-nums text-on-surface">
              ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {topError && (
            <FormError>{topError}</FormError>
          )}
        </div>

        <ResponsiveDialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-11 md:h-10 px-4 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors w-full md:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="h-11 md:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            <span>{direction === "payable" ? "Pay" : "Record payment"}</span>
          </button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
