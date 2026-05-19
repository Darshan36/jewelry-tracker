"use client";

// Phase 18 — EmployeePaymentModal.
//
// Records a single payment (SALARY or WAGE) for one employee. Pre-fills
// amount + period based on context (caller passes `defaultAmount`,
// `defaultPeriodStart`, `defaultPeriodEnd`). The modal is a thin shell
// around createEmployeePayment; one row in, one row out.
//
// Unlike PartyPaymentModal this is NOT a bulk action — labour payments
// don't naturally batch across employees the way party payments batch
// across transactions. Each employee gets their own modal interaction.

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
import { formatCurrency, todayIsoIST, dateToIsoIST } from "@/lib/format";

import { createEmployeePayment } from "@/app/(app)/labour/actions";

export type EmployeePaymentType = "SALARY" | "WAGE";

export type EmployeePaymentModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  employee: {
    id: string;
    name: string;
    type: "FIXED" | "LABOUR";
  };
  paymentType: EmployeePaymentType;
  /** Default amount in PAISE (the component converts to rupees for the input). */
  defaultAmount?: number;
  defaultPeriodStart?: Date | string;
  defaultPeriodEnd?: Date | string;
  /** Context line shown above the form, e.g. "May 2026" or "1 May – 19 May". */
  contextLabel?: string;
};

function paiseToRupeeString(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function EmployeePaymentModal({
  open,
  onClose,
  onSaved,
  employee,
  paymentType,
  defaultAmount,
  defaultPeriodStart,
  defaultPeriodEnd,
  contextLabel,
}: EmployeePaymentModalProps) {
  const router = useRouter();

  const [amount, setAmount] = useState<string>("");
  const [paidAt, setPaidAt] = useState<string>(todayIsoIST());
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset state every time the modal opens so the user gets a clean
  // form with the latest defaults from props.
  useEffect(() => {
    if (!open) return;
    setAmount(
      defaultAmount && defaultAmount > 0
        ? paiseToRupeeString(defaultAmount)
        : "",
    );
    setPaidAt(todayIsoIST());
    setPeriodStart(
      defaultPeriodStart ? dateToIsoIST(defaultPeriodStart) : todayIsoIST(),
    );
    setPeriodEnd(
      defaultPeriodEnd ? dateToIsoIST(defaultPeriodEnd) : todayIsoIST(),
    );
    setNote("");
    setFormError(null);
    setFieldErrors({});
    setSaving(false);
  }, [open, defaultAmount, defaultPeriodStart, defaultPeriodEnd]);

  const amountNumber = Number(amount);
  const canSave =
    Number.isFinite(amountNumber) && amountNumber > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const result = await createEmployeePayment({
      employeeId: employee.id,
      type: paymentType,
      paidAt: new Date(paidAt),
      amount: amountNumber,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      note: note.trim() || null,
    });

    setSaving(false);

    if (!result.ok) {
      const newErrors: Record<string, string> = {};
      let surfaced = false;
      for (const [key, msgs] of Object.entries(result.errors)) {
        if (Array.isArray(msgs) && msgs.length > 0) {
          newErrors[key] = msgs[0];
          surfaced = true;
        }
      }
      if (surfaced) {
        setFieldErrors(newErrors);
      } else {
        setFormError("Save failed. Please retry.");
      }
      return;
    }

    onSaved();
    router.refresh();
    onClose();
  }

  const typeLabel = paymentType === "SALARY" ? "Salary" : "Wage";
  const typeChipClass =
    paymentType === "SALARY"
      ? "bg-secondary/10 text-secondary border-secondary/30"
      : "bg-primary/10 text-primary border-primary/30";

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[500px] md:p-6"
        mobileClassName="p-4"
        data-testid="employee-payment-modal"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            <span className="inline-flex items-center gap-3 flex-wrap">
              <span>Pay {employee.name}</span>
              <span
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider border ${typeChipClass}`}
              >
                {typeLabel}
              </span>
            </span>
          </ResponsiveDialogTitle>
          {contextLabel && (
            <p className="text-xs text-on-surface-variant">{contextLabel}</p>
          )}
        </ResponsiveDialogHeader>

        <div className="space-y-5">
          <div>
            <FormLabel htmlFor="emp-payment-amount" required>
              Amount (₹)
            </FormLabel>
            <FormInput
              id="emp-payment-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoComplete="off"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={!!fieldErrors.amount}
            />
            {defaultAmount !== undefined && defaultAmount > 0 && (
              <p className="mt-1 text-xs text-on-surface-variant">
                Pre-filled from {paymentType === "SALARY" ? "monthly salary" : "unpaid pieces"}: {formatCurrency(defaultAmount)}
              </p>
            )}
            <FormError>{fieldErrors.amount}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="emp-payment-paid-at" required>
              Paid on
            </FormLabel>
            <FormInput
              id="emp-payment-paid-at"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              aria-invalid={!!fieldErrors.paidAt}
            />
            <FormError>{fieldErrors.paidAt}</FormError>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <FormLabel htmlFor="emp-payment-period-start" required>
                Period start
              </FormLabel>
              <FormInput
                id="emp-payment-period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                aria-invalid={!!fieldErrors.periodStart}
              />
              <FormError>{fieldErrors.periodStart}</FormError>
            </div>
            <div>
              <FormLabel htmlFor="emp-payment-period-end" required>
                Period end
              </FormLabel>
              <FormInput
                id="emp-payment-period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                aria-invalid={!!fieldErrors.periodEnd}
              />
              <FormError>{fieldErrors.periodEnd}</FormError>
            </div>
          </div>

          <div>
            <FormLabel htmlFor="emp-payment-note">Note</FormLabel>
            <FormTextarea
              id="emp-payment-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <FormError>{fieldErrors.note}</FormError>
          </div>

          {formError && <FormError>{formError}</FormError>}
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
            className="min-w-[120px] h-11 md:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
            data-testid="employee-payment-save"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            <span>{saving ? "Saving…" : "Save payment"}</span>
          </button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
