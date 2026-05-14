"use client";

// Payment panel for Purchases — mirror of sales/payment-panel.tsx with
// supplier-direction label inversions:
//
//   Sales label              →  Purchases label
//   "Outstanding"            →  "Owed to supplier"
//   "Refund owed"            →  "Refund expected"
//   "+ Record payment"       →  "+ Record payment"   (same)
//   "+ Issue refund"         →  "+ Record refund received"
//   "Pay full balance"       →  "Pay full balance"    (same — paying supplier)
//   "Refund full amount"     →  "Refund full amount"  (same — autofilling expected refund)
//   "Refund" badge in row    →  "Refund received"
//   REFUND row color: red    →  text-secondary (blue) — money INTO the shop is positive
//   REFUND row amount prefix: "−"  →  "+" — money flow into the shop
//
// The mental model is consistent across both panels: from the SHOP's
// perspective, red = money out, secondary-blue (positive) = money in.

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { type z } from "zod";

import {
  FormError,
  FormInput,
  FormLabel,
} from "@/components/form-controls";
import { formatCurrency, formatDate } from "@/lib/format";

import {
  createPurchasePayment,
  softDeletePurchasePayment,
} from "./payment-actions";
import { purchasePaymentInputSchema } from "./payment-schema";
import type {
  PurchaseForClient,
  PurchasePaymentForClient,
} from "./purchase-helpers";

type FormInputT = z.input<typeof purchasePaymentInputSchema>;
type FormOutput = z.output<typeof purchasePaymentInputSchema>;

type Props = {
  purchase: PurchaseForClient;
  payments: PurchasePaymentForClient[];
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function PaymentPanel({ purchase, payments }: Props) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const effectiveTotalPaise = purchase.total - purchase.returnTotal;
  const outstandingPaise = effectiveTotalPaise - purchase.paidAmount;
  const isRefundMode = purchase.status === "refund_due";
  // In refund mode: magnitude of what the supplier is expected to credit back.
  const refundExpectedPaise = isRefundMode ? -outstandingPaise : 0;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
    setValue,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(purchasePaymentInputSchema),
    defaultValues: emptyDefaults(purchase.id, isRefundMode),
  });

  useEffect(() => {
    if (isFormOpen) {
      reset(emptyDefaults(purchase.id, isRefundMode));
      setServerError(null);
    }
  }, [isFormOpen, purchase.id, isRefundMode, reset]);

  const onSubmit = async (data: FormOutput) => {
    setServerError(null);
    const result = await createPurchasePayment(data);
    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat)) {
        const messages = flat[key as keyof typeof flat];
        if (messages && messages.length > 0) {
          if (
            key === "amount" ||
            key === "date" ||
            key === "note" ||
            key === "type"
          ) {
            setError(key, { message: messages[0] });
            surfaced = true;
          } else {
            setServerError(messages[0]);
            surfaced = true;
          }
        }
      }
      if (!surfaced) setServerError("Save failed. Please retry.");
      return;
    }
    setIsFormOpen(false);
    router.refresh();
  };

  const handleConfirmReverse = (paymentId: string) => {
    startTransition(async () => {
      await softDeletePurchasePayment(paymentId);
      setReversingId(null);
      router.refresh();
    });
  };

  const handleAutofillAmount = () => {
    const fillRupees = isRefundMode
      ? refundExpectedPaise / 100
      : outstandingPaise / 100;
    setValue("amount", fillRupees, { shouldValidate: false });
  };

  const showActionButton = isRefundMode || outstandingPaise > 0;
  // Supplier-direction label inversions vs. Sales.
  const triggerLabel = isRefundMode
    ? "Record refund received"
    : "Record payment";
  const autofillLabel = isRefundMode ? "Refund full amount" : "Pay full balance";

  // Indicator label + color. For Purchases, "Refund expected" is money
  // coming IN to the shop — positive direction, text-secondary (blue), NOT
  // text-error (red).
  let indicatorLabel: string;
  let indicatorColor: string;
  let indicatorValuePaise: number;
  if (isRefundMode) {
    indicatorLabel = "Refund expected";
    indicatorColor = "text-secondary";
    indicatorValuePaise = refundExpectedPaise;
  } else if (outstandingPaise === 0) {
    indicatorLabel = "Owed to supplier";
    indicatorColor = "text-secondary";
    indicatorValuePaise = 0;
  } else {
    indicatorLabel = "Owed to supplier";
    indicatorColor = "text-primary";
    indicatorValuePaise = outstandingPaise;
  }

  return (
    <div className="mt-6 pt-6 border-t border-outline-variant">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
          Payment history
        </h3>
        <span
          className={`font-display text-sm tabular-nums ${indicatorColor}`}
        >
          {indicatorLabel}: {formatCurrency(indicatorValuePaise)}
        </span>
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-on-surface-variant mb-3">No payments yet.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {payments.map((p) => (
            <PaymentRow
              key={p.id}
              payment={p}
              isConfirming={reversingId === p.id}
              isPending={isPending}
              onRequestReverse={() => setReversingId(p.id)}
              onCancelReverse={() => setReversingId(null)}
              onConfirmReverse={() => handleConfirmReverse(p.id)}
            />
          ))}
        </ul>
      )}

      {!isFormOpen && showActionButton && (
        <button
          type="button"
          onClick={() => setIsFormOpen(true)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm border border-outline-variant transition-colors ${
            isRefundMode
              ? "bg-secondary-container text-secondary hover:bg-secondary-container/90"
              : "bg-secondary-container text-on-secondary-container hover:bg-secondary-container/90"
          }`}
        >
          <Plus className="size-4" />
          {triggerLabel}
        </button>
      )}

      {isFormOpen && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="border border-outline-variant bg-surface-container-low p-4 space-y-4"
          noValidate
        >
          {serverError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-3 py-2 text-sm">
              {serverError}
            </div>
          )}

          <input
            type="hidden"
            {...register("purchaseId")}
            value={purchase.id}
            readOnly
          />
          <input type="hidden" {...register("type")} />

          <div>
            <FormLabel htmlFor="payment-date" required>
              Date
            </FormLabel>
            <FormInput
              id="payment-date"
              type="date"
              aria-invalid={!!errors.date}
              {...register("date")}
            />
            <FormError>
              {errors.date?.message ? String(errors.date.message) : null}
            </FormError>
          </div>

          <div>
            <FormLabel htmlFor="payment-amount" required>
              Amount (₹)
            </FormLabel>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <FormInput
                  id="payment-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  aria-invalid={!!errors.amount}
                  {...register("amount", {
                    setValueAs: (v) =>
                      v === "" || v === null || v === undefined ? 0 : Number(v),
                  })}
                />
              </div>
              <button
                type="button"
                onClick={handleAutofillAmount}
                className="shrink-0 h-10 px-3 text-xs font-display uppercase tracking-wider bg-surface-container-high text-on-surface hover:bg-surface-container border border-outline-variant transition-colors"
              >
                {autofillLabel}
              </button>
            </div>
            <FormError>{errors.amount?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="payment-note">Note (optional)</FormLabel>
            <FormInput
              id="payment-note"
              type="text"
              autoComplete="off"
              aria-invalid={!!errors.note}
              {...register("note")}
            />
            <FormError>{errors.note?.message}</FormError>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              disabled={isSubmitting}
              aria-label="Cancel recording payment"
              className="px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-w-[100px] h-9 px-3 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function emptyDefaults(purchaseId: string, isRefundMode: boolean): FormInputT {
  return {
    purchaseId,
    date: todayISO() as unknown as Date,
    amount: 0,
    type: isRefundMode ? "REFUND" : "PAYMENT",
    note: "",
  };
}

function PaymentRow({
  payment,
  isConfirming,
  isPending,
  onRequestReverse,
  onCancelReverse,
  onConfirmReverse,
}: {
  payment: PurchasePaymentForClient;
  isConfirming: boolean;
  isPending: boolean;
  onRequestReverse: () => void;
  onCancelReverse: () => void;
  onConfirmReverse: () => void;
}) {
  const isRefund = payment.type === "REFUND";
  // Purchases: REFUND = supplier crediting money back to shop = money IN.
  // Color flip vs. Sales: text-secondary (positive) instead of text-error.
  const amountColor = isRefund ? "text-secondary" : "text-on-surface";
  // Plus prefix on REFUND amounts — money INTO the shop is positive direction.
  const amountDisplay = isRefund
    ? `+${formatCurrency(payment.amount)}`
    : formatCurrency(payment.amount);

  return (
    <li className="group flex items-center gap-3 px-3 py-2 text-sm bg-surface-container-low border border-outline-variant">
      <span className="text-on-surface-variant tabular-nums shrink-0 w-24">
        {formatDate(payment.date)}
      </span>
      <span
        className={`shrink-0 w-32 text-[10px] font-display uppercase tracking-wider ${
          isRefund ? "text-secondary" : "text-on-surface-variant"
        }`}
      >
        {isRefund ? "Refund received" : "Payment"}
      </span>
      <span
        className={`tabular-nums font-mono shrink-0 w-28 text-right ${amountColor}`}
      >
        {amountDisplay}
      </span>
      <span
        className="flex-1 min-w-0 text-on-surface-variant truncate"
        title={payment.note ?? undefined}
      >
        {payment.note ?? "—"}
      </span>
      {isConfirming ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs uppercase tracking-wider text-error">
            Reverse?
          </span>
          <button
            type="button"
            onClick={onCancelReverse}
            disabled={isPending}
            aria-label="Cancel reversing payment"
            className="px-2 py-1 text-xs uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmReverse}
            disabled={isPending}
            className="min-w-[70px] h-7 px-2 text-xs font-display uppercase tracking-wider bg-error text-on-error hover:bg-error/90 disabled:opacity-70 transition-colors flex items-center justify-center gap-1.5"
          >
            {isPending ? <Loader2 className="size-3 animate-spin" /> : "Confirm"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onRequestReverse}
          aria-label="Reverse payment"
          className="shrink-0 p-1.5 opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error hover:bg-surface-container transition-all"
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}
