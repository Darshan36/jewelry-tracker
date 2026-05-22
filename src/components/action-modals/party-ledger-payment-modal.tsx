"use client";

// Phase 21a — party-ledger payment modal.
//
// Replaces the Phase 17b PartyPaymentModal (bulk-allocation transaction
// picker). The ledger model treats payment as a single party-level
// event: one DECREASE entry. The modal collects amount + date +
// optional description and submits via createLedgerPayment.
//
// "Direction" is a UI label only — the underlying entry direction is
// always DECREASE for "Add payment" (money moving in the direction
// that reduces what the party owes). REFUND-type entries (the customer
// pays MORE than they owe, producing a credit balance) are handled
// implicitly via the raw-signed balance — no separate REFUND UI in
// 21a.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

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
import { todayIsoIST } from "@/lib/format";

import { createLedgerPayment } from "@/app/(app)/parties/ledger-actions";

export type PartyLedgerPaymentDirection = "payable" | "receivable";

export type PartyLedgerPaymentModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  direction: PartyLedgerPaymentDirection;
  party: {
    id: string;
    name: string;
    phone: string | null;
  };
  /** Optional default amount in paise — used to pre-fill from a "pay full balance" caller. */
  defaultAmountPaise?: number;
};

export function PartyLedgerPaymentModal({
  open,
  onClose,
  onSaved,
  direction,
  party,
  defaultAmountPaise,
}: PartyLedgerPaymentModalProps) {
  const router = useRouter();
  const [date, setDate] = useState<string>(todayIsoIST());
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset state each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setDate(todayIsoIST());
    setAmount(
      defaultAmountPaise && defaultAmountPaise > 0
        ? (defaultAmountPaise / 100).toFixed(2)
        : "",
    );
    setDescription("");
    setFieldErrors({});
    setTopError(null);
  }, [open, defaultAmountPaise]);

  const amountNum = Number(amount);
  const canSave =
    !saving && Number.isFinite(amountNum) && amountNum > 0 && date.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setTopError(null);
    setFieldErrors({});

    const result = await createLedgerPayment({
      partyId: party.id,
      date: new Date(date),
      amount: amountNum,
      description: description.trim() || null,
    });

    setSaving(false);

    if (!result.ok) {
      const errs = result.errors;
      if (errs.message) setTopError(errs.message);
      const fieldOnly: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(errs)) {
        if (k === "message" || v === undefined) continue;
        if (Array.isArray(v)) fieldOnly[k] = v;
      }
      setFieldErrors(fieldOnly);
      return;
    }

    onSaved();
    router.refresh();
    onClose();
  }

  const directionLabel =
    direction === "payable" ? `Pay ${party.name}` : `Receive from ${party.name}`;
  const buttonLabel = direction === "payable" ? "Record payment" : "Record receipt";

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{directionLabel}</ResponsiveDialogTitle>
          {party.phone && (
            <p className="text-xs text-on-surface-variant tabular-nums">
              {party.phone}
            </p>
          )}
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          <div>
            <FormLabel htmlFor="party-ledger-payment-date" required>
              Date
            </FormLabel>
            <FormInput
              id="party-ledger-payment-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {fieldErrors.date && (
              <FormError>{fieldErrors.date[0]}</FormError>
            )}
          </div>

          <div>
            <FormLabel htmlFor="party-ledger-payment-amount" required>
              Amount (₹)
            </FormLabel>
            <FormInput
              id="party-ledger-payment-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-right tabular-nums"
            />
            {fieldErrors.amount && (
              <FormError>{fieldErrors.amount[0]}</FormError>
            )}
          </div>

          <div>
            <FormLabel htmlFor="party-ledger-payment-description">
              Description (optional)
            </FormLabel>
            <FormTextarea
              id="party-ledger-payment-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. UPI, cheque #..., or notes"
            />
            {fieldErrors.description && (
              <FormError>{fieldErrors.description[0]}</FormError>
            )}
          </div>

          {topError && <FormError>{topError}</FormError>}
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
            <span>{buttonLabel}</span>
          </button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
