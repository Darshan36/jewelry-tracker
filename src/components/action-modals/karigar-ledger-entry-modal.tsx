"use client";

// Phase 21b.1 — direct karigar ledger entry modal.
//
// Mirrors `party-ledger-payment-modal.tsx` (Phase 21a / 21a.1) for the
// employee owner, with one extra control: a +/− direction picker, since
// karigar entries can go either way (DECREASE for advance/payment,
// INCREASE for opening balance / adjustment). Party-side payments are
// always DECREASE.
//
// Why this exists: the original "advance" path was the bulk-piece-entry
// form's free-text note column — users typed "advance" there to create
// pseudo-piece rows that posted INCREASE (wrong direction). This modal
// is the correct, direct path. Section 2 of /labour gains a "Record
// entry" button per karigar that opens it.

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

import {
  createKarigarLedgerEntry,
  updateKarigarLedgerEntry,
} from "@/app/(app)/labour/karigar-ledger-actions";

export type KarigarLedgerDirection = "INCREASE" | "DECREASE";

export type KarigarLedgerEditTarget = {
  id: string;
  amountPaise: number;
  date: Date;
  direction: KarigarLedgerDirection;
  description: string;
};

export type KarigarLedgerEntryModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employee: {
    id: string;
    name: string;
  };
  /** When set, modal runs in edit mode and submits via updateKarigarLedgerEntry. */
  editEntry?: KarigarLedgerEditTarget;
};

function dateToInputValue(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function KarigarLedgerEntryModal({
  open,
  onClose,
  onSaved,
  employee,
  editEntry,
}: KarigarLedgerEntryModalProps) {
  const router = useRouter();
  const isEdit = !!editEntry;

  const [date, setDate] = useState<string>(todayIsoIST());
  const [amount, setAmount] = useState<string>("");
  const [direction, setDirection] = useState<KarigarLedgerDirection>("DECREASE");
  const [description, setDescription] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset on open. Edit mode prefills from `editEntry`; create mode
  // defaults to DECREASE (advance / payment — the common case).
  useEffect(() => {
    if (!open) return;
    if (editEntry) {
      setDate(dateToInputValue(editEntry.date));
      setAmount((editEntry.amountPaise / 100).toFixed(2));
      setDirection(editEntry.direction);
      setDescription(editEntry.description);
    } else {
      setDate(todayIsoIST());
      setAmount("");
      setDirection("DECREASE");
      setDescription("");
    }
    setFieldErrors({});
    setTopError(null);
    setSaving(false);
  }, [open, editEntry]);

  const amountNum = Number(amount);
  const descriptionTrimmed = description.trim();
  const canSave =
    !saving &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    date.length > 0 &&
    descriptionTrimmed.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setTopError(null);
    setFieldErrors({});

    const result = editEntry
      ? await updateKarigarLedgerEntry({
          id: editEntry.id,
          date: new Date(date),
          amount: amountNum,
          direction,
          description: descriptionTrimmed,
        })
      : await createKarigarLedgerEntry({
          employeeId: employee.id,
          date: new Date(date),
          amount: amountNum,
          direction,
          description: descriptionTrimmed,
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

  const titleLabel = isEdit
    ? `Edit ledger entry — ${employee.name}`
    : `Record entry — ${employee.name}`;
  const buttonLabel = isEdit ? "Save changes" : "Record entry";

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-md md:p-6"
        mobileClassName="p-4"
        data-testid="karigar-ledger-entry-modal"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{titleLabel}</ResponsiveDialogTitle>
          <p className="text-xs text-on-surface-variant">
            Direct ledger entry — for advances, payments, or adjustments
            not tied to specific piece work.
          </p>
        </ResponsiveDialogHeader>

        <div className="space-y-4">
          {/* Direction picker first — frames everything below. */}
          <div>
            <FormLabel htmlFor="karigar-ledger-direction" required>
              Direction
            </FormLabel>
            <div
              role="radiogroup"
              aria-labelledby="karigar-ledger-direction-label"
              className="grid grid-cols-1 md:grid-cols-2 gap-2"
            >
              <label
                className={`flex items-start gap-3 p-3 border cursor-pointer transition-colors ${
                  direction === "DECREASE"
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant bg-surface-container-low hover:bg-surface-container"
                }`}
              >
                <input
                  type="radio"
                  name="karigar-ledger-direction"
                  value="DECREASE"
                  checked={direction === "DECREASE"}
                  onChange={() => setDirection("DECREASE")}
                  className="mt-0.5"
                  data-testid="karigar-ledger-direction-decrease"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-on-surface">
                    − Advance / payment
                  </span>
                  <span className="block text-xs text-on-surface-variant mt-0.5">
                    You gave karigar money
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-3 p-3 border cursor-pointer transition-colors ${
                  direction === "INCREASE"
                    ? "border-primary bg-primary/5"
                    : "border-outline-variant bg-surface-container-low hover:bg-surface-container"
                }`}
              >
                <input
                  type="radio"
                  name="karigar-ledger-direction"
                  value="INCREASE"
                  checked={direction === "INCREASE"}
                  onChange={() => setDirection("INCREASE")}
                  className="mt-0.5"
                  data-testid="karigar-ledger-direction-increase"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-on-surface">
                    + Adjustment / opening
                  </span>
                  <span className="block text-xs text-on-surface-variant mt-0.5">
                    Karigar owed more (prior work, correction)
                  </span>
                </span>
              </label>
            </div>
            {fieldErrors.direction && (
              <FormError>{fieldErrors.direction[0]}</FormError>
            )}
          </div>

          <div>
            <FormLabel htmlFor="karigar-ledger-amount" required>
              Amount (₹)
            </FormLabel>
            <FormInput
              id="karigar-ledger-amount"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-right tabular-nums"
              aria-invalid={!!fieldErrors.amount}
            />
            {fieldErrors.amount && (
              <FormError>{fieldErrors.amount[0]}</FormError>
            )}
          </div>

          <div>
            <FormLabel htmlFor="karigar-ledger-date" required>
              Date
            </FormLabel>
            <FormInput
              id="karigar-ledger-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={!!fieldErrors.date}
            />
            {fieldErrors.date && <FormError>{fieldErrors.date[0]}</FormError>}
          </div>

          <div>
            <FormLabel htmlFor="karigar-ledger-description" required>
              Description
            </FormLabel>
            <FormTextarea
              id="karigar-ledger-description"
              rows={2}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                direction === "DECREASE"
                  ? 'e.g. "advance for next week", "diwali bonus paid"'
                  : 'e.g. "opening balance — prior work", "correction"'
              }
              aria-invalid={!!fieldErrors.description}
            />
            <p className="mt-1 text-xs text-on-surface-variant">
              Required — explains what the entry is. Shown on the
              karigar&apos;s ledger statement.
            </p>
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
            data-testid="karigar-ledger-save"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            <span>{buttonLabel}</span>
          </button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
