"use client";

// Return panel for Purchases — mirror of sales/return-panel.tsx.
//
// Semantically, a PurchaseReturn is the SHOP returning items to the
// SUPPLIER. UI labels reflect the supplier direction:
//   "Returns"        → "Returns to supplier"
//   "Record return"  → "Record return to supplier"
//
// Other inversions are minor (aria-labels, hint copy).

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
  createPurchaseReturn,
  softDeletePurchaseReturn,
} from "./return-actions";
import { purchaseReturnInputSchema } from "./return-schema";
import type {
  PurchaseForClient,
  PurchaseReturnForClient,
} from "./purchase-helpers";

type FormInputT = z.input<typeof purchaseReturnInputSchema>;
type FormOutput = z.output<typeof purchaseReturnInputSchema>;

type Props = {
  purchase: PurchaseForClient;
  returns: PurchaseReturnForClient[];
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ReturnPanel({ purchase, returns }: Props) {
  const router = useRouter();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const existingReturnedQty = returns.reduce(
    (sum, r) => sum + r.qtyReturned,
    0,
  );
  const existingReturnTotalPaise = returns.reduce(
    (sum, r) => sum + r.refundAmount,
    0,
  );
  const remainingReturnableQty = purchase.qty - existingReturnedQty;
  const remainingReturnableValuePaise =
    purchase.total - existingReturnTotalPaise;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(purchaseReturnInputSchema),
    defaultValues: emptyDefaults(purchase.id),
  });

  useEffect(() => {
    if (isFormOpen) {
      reset(emptyDefaults(purchase.id));
      setServerError(null);
    }
  }, [isFormOpen, purchase.id, reset]);

  const onSubmit = async (data: FormOutput) => {
    setServerError(null);
    const result = await createPurchaseReturn(data);
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
      await softDeletePurchaseReturn(returnId);
      setReversingId(null);
      router.refresh();
    });
  };

  const canRecordMore =
    remainingReturnableQty > 0 && remainingReturnableValuePaise > 0;

  return (
    <div className="mt-6 pt-6 border-t border-outline-variant">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
          Returns to supplier
        </h3>
        {existingReturnTotalPaise > 0 && (
          <span className="font-display text-sm tabular-nums text-primary">
            Returned: {formatCurrency(existingReturnTotalPaise)}
          </span>
        )}
      </div>

      {returns.length === 0 ? (
        <p className="text-sm text-on-surface-variant mb-3">
          No returns recorded.
        </p>
      ) : (
        <ul className="space-y-1 mb-3">
          {returns.map((r) => (
            <ReturnRow
              key={r.id}
              purchaseReturn={r}
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
          Record return to supplier
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
                ? ` (already returned: ${existingReturnedQty} of ${purchase.qty})`
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

function emptyDefaults(purchaseId: string): FormInputT {
  return {
    purchaseId,
    date: todayISO() as unknown as Date,
    qtyReturned: 1,
    refundAmount: 0,
    note: "",
  };
}

function ReturnRow({
  purchaseReturn,
  isConfirming,
  isPending,
  onRequestReverse,
  onCancelReverse,
  onConfirmReverse,
}: {
  purchaseReturn: PurchaseReturnForClient;
  isConfirming: boolean;
  isPending: boolean;
  onRequestReverse: () => void;
  onCancelReverse: () => void;
  onConfirmReverse: () => void;
}) {
  return (
    <li className="group flex items-center gap-3 px-3 py-2 text-sm bg-surface-container-low border border-outline-variant">
      <span className="text-on-surface-variant tabular-nums shrink-0 w-24">
        {formatDate(purchaseReturn.date)}
      </span>
      <span className="text-on-surface tabular-nums shrink-0 w-16 text-right">
        {purchaseReturn.qtyReturned} qty
      </span>
      <span className="text-on-surface tabular-nums font-mono shrink-0 w-28 text-right">
        {formatCurrency(purchaseReturn.refundAmount)}
      </span>
      <span
        className="flex-1 min-w-0 text-on-surface-variant truncate"
        title={purchaseReturn.note ?? undefined}
      >
        {purchaseReturn.note ?? "—"}
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
