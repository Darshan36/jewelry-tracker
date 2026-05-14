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

import { createSaleReturn, softDeleteSaleReturn } from "./return-actions";
import { saleReturnInputSchema } from "./return-schema";
import type {
  SaleForClient,
  SaleReturnForClient,
} from "./sale-helpers";

type FormInputT = z.input<typeof saleReturnInputSchema>;
type FormOutput = z.output<typeof saleReturnInputSchema>;

type Props = {
  sale: SaleForClient;
  returns: SaleReturnForClient[];
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ReturnPanel({ sale, returns }: Props) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  // Aggregate already-returned qty and refund (client-side from props) to
  // show inline hints under the form inputs. Server validates authoritatively.
  const existingReturnedQty = returns.reduce(
    (sum, r) => sum + r.qtyReturned,
    0,
  );
  const existingReturnTotalPaise = returns.reduce(
    (sum, r) => sum + r.refundAmount,
    0,
  );
  const remainingReturnableQty = sale.qty - existingReturnedQty;
  const remainingReturnableValuePaise = sale.total - existingReturnTotalPaise;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(saleReturnInputSchema),
    defaultValues: emptyDefaults(sale.id),
  });

  useEffect(() => {
    if (isFormOpen) {
      reset(emptyDefaults(sale.id));
      setServerError(null);
    }
  }, [isFormOpen, sale.id, reset]);

  const onSubmit = async (data: FormOutput) => {
    setServerError(null);
    const result = await createSaleReturn(data);
    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat)) {
        const messages = flat[key as keyof typeof flat];
        if (messages && messages.length > 0) {
          if (
            key === "qtyReturned" ||
            key === "refundAmount" ||
            key === "date" ||
            key === "note"
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

  const handleConfirmReverse = (returnId: string) => {
    startTransition(async () => {
      await softDeleteSaleReturn(returnId);
      setReversingId(null);
      router.refresh();
    });
  };

  // Hide "Record return" button once nothing further is returnable.
  const canRecordMore =
    remainingReturnableQty > 0 && remainingReturnableValuePaise > 0;

  return (
    <div className="mt-6 pt-6 border-t border-outline-variant">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
          Returns
        </h3>
        {existingReturnTotalPaise > 0 && (
          <span className="font-display text-sm tabular-nums text-primary">
            Returned: {formatCurrency(existingReturnTotalPaise)}
          </span>
        )}
      </div>

      {returns.length === 0 ? (
        <p className="text-sm text-on-surface-variant mb-3">No returns recorded.</p>
      ) : (
        <ul className="space-y-1 mb-3">
          {returns.map((r) => (
            <ReturnRow
              key={r.id}
              saleReturn={r}
              isConfirming={reversingId === r.id}
              isPending={isPending}
              onRequestReverse={() => setReversingId(r.id)}
              onCancelReverse={() => setReversingId(null)}
              onConfirmReverse={() => handleConfirmReverse(r.id)}
            />
          ))}
        </ul>
      )}

      {!isFormOpen && canRecordMore && (
        <button
          type="button"
          onClick={() => setIsFormOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-surface-container-high text-on-surface hover:bg-surface-container border border-outline-variant transition-colors"
        >
          <Plus className="size-4" />
          Record return
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
            <FormLabel htmlFor="return-date" required>
              Date
            </FormLabel>
            <FormInput
              id="return-date"
              type="date"
              aria-invalid={!!errors.date}
              {...register("date")}
            />
            <FormError>
              {errors.date?.message ? String(errors.date.message) : null}
            </FormError>
          </div>

          <div>
            <FormLabel htmlFor="return-qty" required>
              Quantity returned
            </FormLabel>
            <FormInput
              id="return-qty"
              type="number"
              min="1"
              step="1"
              max={String(remainingReturnableQty)}
              inputMode="numeric"
              autoFocus
              aria-invalid={!!errors.qtyReturned}
              {...register("qtyReturned", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined ? 0 : Number(v),
              })}
            />
            <p className="text-xs text-on-surface-variant mt-1">
              Up to {remainingReturnableQty} available to return
              {existingReturnedQty > 0
                ? ` (already returned: ${existingReturnedQty} of ${sale.qty})`
                : ""}
            </p>
            <FormError>{errors.qtyReturned?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="return-refund" required>
              Refund amount (₹)
            </FormLabel>
            <FormInput
              id="return-refund"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-invalid={!!errors.refundAmount}
              {...register("refundAmount", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined ? 0 : Number(v),
              })}
            />
            <p className="text-xs text-on-surface-variant mt-1">
              Max refund value: {formatCurrency(remainingReturnableValuePaise)}
            </p>
            <FormError>{errors.refundAmount?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="return-note">Note (optional)</FormLabel>
            <FormInput
              id="return-note"
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
              aria-label="Cancel recording return"
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
    qtyReturned: 1,
    refundAmount: 0,
    note: "",
  };
}

function ReturnRow({
  saleReturn,
  isConfirming,
  isPending,
  onRequestReverse,
  onCancelReverse,
  onConfirmReverse,
}: {
  saleReturn: SaleReturnForClient;
  isConfirming: boolean;
  isPending: boolean;
  onRequestReverse: () => void;
  onCancelReverse: () => void;
  onConfirmReverse: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-3 py-2 text-sm bg-surface-container-low border border-outline-variant">
      <span className="text-on-surface-variant tabular-nums shrink-0 w-24">
        {formatDate(saleReturn.date)}
      </span>
      <span className="text-on-surface tabular-nums shrink-0 w-16 text-right">
        {saleReturn.qtyReturned} qty
      </span>
      <span className="text-on-surface tabular-nums font-mono shrink-0 w-28 text-right">
        {formatCurrency(saleReturn.refundAmount)}
      </span>
      <span
        className="flex-1 min-w-0 text-on-surface-variant truncate"
        title={saleReturn.note ?? undefined}
      >
        {saleReturn.note ?? "—"}
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
            aria-label="Cancel reversing return"
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
          aria-label="Reverse return"
          className="shrink-0 p-1.5 opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error hover:bg-surface-container transition-all"
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}
