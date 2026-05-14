"use client";

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
  createSalePayment,
  softDeleteSalePayment,
} from "./payment-actions";
import { salePaymentInputSchema } from "./payment-schema";
import type {
  SaleForClient,
  SalePaymentForClient,
} from "./sale-helpers";

type FormInputT = z.input<typeof salePaymentInputSchema>;
type FormOutput = z.output<typeof salePaymentInputSchema>;

type Props = {
  sale: SaleForClient;
  payments: SalePaymentForClient[];
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function PaymentPanel({ sale, payments }: Props) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  // Outstanding is computed on the client from the server-serialized fields.
  // `total` and `paidAmount` are both paise as Number; their difference is
  // safe within JS Number precision (paise up to 2^53 ≈ ₹90 quadrillion).
  const outstandingPaise = sale.total - sale.paidAmount;
  const remainingRupees = outstandingPaise / 100;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
    setValue,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(salePaymentInputSchema),
    defaultValues: emptyDefaults(sale.id),
  });

  // Re-seed defaults whenever the inline form (re-)opens so a previous
  // submission's stale state doesn't leak across.
  useEffect(() => {
    if (isFormOpen) {
      reset(emptyDefaults(sale.id));
      setServerError(null);
    }
  }, [isFormOpen, sale.id, reset]);

  const onSubmit = async (data: FormOutput) => {
    setServerError(null);
    const result = await createSalePayment(data);
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
            // saleId / unexpected keys — surface as form-level error
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
      await softDeleteSalePayment(paymentId);
      setReversingId(null);
      router.refresh();
    });
  };

  const handlePayFullBalance = () => {
    setValue("amount", remainingRupees, { shouldValidate: false });
  };

  const outstandingColor =
    outstandingPaise === 0
      ? "text-secondary"
      : outstandingPaise > 0
        ? "text-primary"
        : "text-error";

  return (
    <div className="mt-6 pt-6 border-t border-outline-variant">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
          Payment history
        </h3>
        <span
          className={`font-display text-sm tabular-nums ${outstandingColor}`}
        >
          Outstanding: {formatCurrency(outstandingPaise)}
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

      {!isFormOpen && outstandingPaise > 0 && (
        <button
          type="button"
          onClick={() => setIsFormOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-secondary-container text-on-secondary-container hover:bg-secondary-container/90 border border-outline-variant transition-colors"
        >
          <Plus className="size-4" />
          Record payment
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

          <input type="hidden" {...register("saleId")} value={sale.id} readOnly />

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
                onClick={handlePayFullBalance}
                className="shrink-0 h-10 px-3 text-xs font-display uppercase tracking-wider bg-surface-container-high text-on-surface hover:bg-surface-container border border-outline-variant transition-colors"
              >
                Pay full balance
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

function emptyDefaults(saleId: string): FormInputT {
  return {
    saleId,
    date: todayISO() as unknown as Date,
    amount: 0,
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
  payment: SalePaymentForClient;
  isConfirming: boolean;
  isPending: boolean;
  onRequestReverse: () => void;
  onCancelReverse: () => void;
  onConfirmReverse: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-3 py-2 text-sm bg-surface-container-low border border-outline-variant">
      <span className="text-on-surface-variant tabular-nums shrink-0 w-24">
        {formatDate(payment.date)}
      </span>
      <span className="text-on-surface tabular-nums font-mono shrink-0 w-28 text-right">
        {formatCurrency(payment.amount)}
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
