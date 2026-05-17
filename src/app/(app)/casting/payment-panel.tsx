"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { z } from "zod";

import {
  FormError,
  FormInput,
  FormLabel,
} from "@/components/form-controls";
import { formatCurrency, formatDate } from "@/lib/format";

import {
  createCastingPayment,
  softDeleteCastingPayment,
} from "./payment-actions";
import type {
  CastingEntryForClient,
  CastingPaymentForClient,
} from "./casting-helpers";

// Local schema for the inline payment form. Mirrors the (gitignored)
// shape used in sales/payment-schema.ts. Kept local to this file since
// it's only used here — server validation lives in payment-actions.ts.
const paymentFormSchema = z.object({
  castingEntryId: z.string().min(1),
  date: z.coerce.date({ message: "Date is required" }),
  amount: z.number().positive("Amount must be greater than zero"),
  type: z.enum(["PAYMENT", "REFUND"]),
  note: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
});

type FormInputT = z.input<typeof paymentFormSchema>;
type FormOutput = z.output<typeof paymentFormSchema>;

type Props = {
  entry: CastingEntryForClient;
  payments: CastingPaymentForClient[];
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PaymentPanel({ entry, payments }: Props) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  // For Casting/Plating: status semantics match Purchases (shop owes
  // vendor money). `refund_due` = vendor owes shop money back; this
  // happens only if a refund-type payment is over-applied (rare).
  const outstandingPaise = entry.total - entry.paidAmount;
  const isRefundMode = entry.status === "refund_due";
  const refundOwedPaise = isRefundMode ? -outstandingPaise : 0;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
    setValue,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: emptyDefaults(entry.id, isRefundMode),
  });

  useEffect(() => {
    if (isFormOpen) {
      reset(emptyDefaults(entry.id, isRefundMode));
      setServerError(null);
    }
  }, [isFormOpen, entry.id, isRefundMode, reset]);

  const onSubmit = async (data: FormOutput) => {
    setServerError(null);
    const result = await createCastingPayment(data);
    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat)) {
        const messages = flat[key as keyof typeof flat];
        if (messages && messages.length > 0) {
          if (key === "amount" || key === "date" || key === "note") {
            setError(key, { message: messages[0] });
            surfaced = true;
          } else {
            setServerError(messages[0]);
          }
        }
      }
      if (!surfaced && !serverError) setServerError("Save failed.");
      return;
    }
    setIsFormOpen(false);
    router.refresh();
  };

  const handleReverse = (paymentId: string) => {
    startTransition(async () => {
      await softDeleteCastingPayment(paymentId);
      setReversingId(null);
      router.refresh();
    });
  };

  const autoFillFullBalance = () => {
    const targetPaise = isRefundMode ? refundOwedPaise : outstandingPaise;
    setValue("amount", Math.max(0, targetPaise / 100), {
      shouldValidate: true,
    });
  };

  return (
    <div className="border border-outline-variant bg-surface-container-low p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
          Payments
        </h3>
        {!isFormOpen && (
          <button
            type="button"
            onClick={() => setIsFormOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-surface-container-high text-on-surface hover:bg-surface-container-highest border border-outline-variant transition-colors"
          >
            <Plus className="size-3.5" />
            {isRefundMode ? "Record refund received" : "Record payment"}
          </button>
        )}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">
            Total
          </p>
          <p className="tabular-nums font-mono">
            {formatCurrency(entry.total)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">
            Paid
          </p>
          <p className="tabular-nums font-mono">
            {formatCurrency(entry.paidAmount)}
          </p>
        </div>
        <div>
          <p
            className={`text-[10px] uppercase tracking-wider mb-1 ${
              isRefundMode ? "text-secondary" : "text-on-surface-variant"
            }`}
          >
            {isRefundMode ? "Refund expected" : "Owed to vendor"}
          </p>
          <p
            className={`tabular-nums font-mono ${
              isRefundMode ? "text-secondary" : ""
            }`}
          >
            {formatCurrency(isRefundMode ? refundOwedPaise : outstandingPaise)}
          </p>
        </div>
      </div>

      {/* Inline form */}
      {isFormOpen && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="border-t border-outline-variant pt-4 space-y-3"
          noValidate
        >
          <input type="hidden" {...register("castingEntryId")} />
          <input type="hidden" {...register("type")} />
          {serverError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-3 py-2 text-xs">
              {serverError}
            </div>
          )}
          <div className="grid grid-cols-[140px_1fr_100px] gap-2 items-end">
            <div>
              <FormLabel htmlFor="cp-date" required>
                Date
              </FormLabel>
              <FormInput
                id="cp-date"
                type="date"
                aria-invalid={!!errors.date}
                {...register("date")}
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <FormLabel htmlFor="cp-amount" required>
                  Amount (₹)
                </FormLabel>
                <button
                  type="button"
                  onClick={autoFillFullBalance}
                  className="text-[10px] uppercase tracking-wider text-secondary hover:text-secondary-container transition-colors mb-1"
                >
                  {isRefundMode ? "Refund full amount" : "Pay full balance"}
                </button>
              </div>
              <FormInput
                id="cp-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tabular-nums"
                aria-invalid={!!errors.amount}
                {...register("amount", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined ? 0 : Number(v),
                })}
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-10 px-3 bg-primary text-on-primary font-display text-xs uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 transition-colors flex items-center justify-center"
            >
              {isSubmitting ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
          <FormError>{errors.amount?.message}</FormError>
          <FormError>{errors.date?.message ? String(errors.date.message) : null}</FormError>
          <div>
            <FormLabel htmlFor="cp-note">Note (optional)</FormLabel>
            <FormInput id="cp-note" type="text" {...register("note")} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setIsFormOpen(false)}
              disabled={isSubmitting}
              className="px-3 py-1.5 text-xs uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* History */}
      {payments.length > 0 ? (
        <div className="border-t border-outline-variant pt-3 space-y-1">
          {payments.map((p) => {
            const isRefund = p.type === "REFUND";
            return (
              <div
                key={p.id}
                className="grid grid-cols-[100px_70px_1fr_120px_30px] gap-2 items-center text-sm py-1"
              >
                <span className="text-xs text-on-surface-variant tabular-nums">
                  {formatDate(p.date)}
                </span>
                <span
                  className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 inline-block w-fit ${
                    isRefund
                      ? "bg-secondary-container text-on-secondary-container"
                      : "bg-surface-container-high text-on-surface-variant"
                  }`}
                >
                  {p.type}
                </span>
                <span className="text-xs text-on-surface-variant truncate">
                  {p.note ?? ""}
                </span>
                <span
                  className={`text-right tabular-nums font-mono text-sm ${
                    isRefund ? "text-secondary" : ""
                  }`}
                >
                  {isRefund ? "+" : ""}
                  {formatCurrency(p.amount)}
                </span>
                <div className="flex justify-end">
                  {reversingId === p.id ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setReversingId(null)}
                        disabled={isPending}
                        className="px-1 py-0.5 text-[10px] uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
                      >
                        No
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReverse(p.id)}
                        disabled={isPending}
                        className="px-1 py-0.5 text-[10px] uppercase tracking-wider text-error hover:text-error transition-colors"
                      >
                        {isPending ? "…" : "Reverse"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setReversingId(p.id)}
                      aria-label={`Reverse payment from ${formatDate(p.date)}`}
                      className="p-1 text-on-surface-variant hover:text-error transition-colors"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border-t border-outline-variant pt-3">
          <p className="text-xs text-on-surface-variant italic">
            No payments yet.
          </p>
        </div>
      )}
    </div>
  );
}

function emptyDefaults(
  castingEntryId: string,
  isRefundMode: boolean,
): FormInputT {
  return {
    castingEntryId,
    date: todayISO() as unknown as Date,
    amount: 0,
    type: isRefundMode ? "REFUND" : "PAYMENT",
    note: "",
  };
}
