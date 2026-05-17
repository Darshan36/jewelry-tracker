"use client";

// Shared inline payment modal — opens from the Actions column on any
// transaction-table row. Records a PAYMENT or REFUND against the
// underlying entity (Sale today; Purchase/Casting/Plating wireable
// when the mirror happens). Server actions stay where they are; this
// component just dispatches by entityType.

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FormError,
  FormInput,
  FormLabel,
  FormTextarea,
} from "@/components/form-controls";
import { formatCurrency } from "@/lib/format";

import { createSalePayment } from "@/app/(app)/sales/payment-actions";

export type PaymentEntityType = "sale" | "purchase" | "casting" | "plating";

// Local zod schema — keeps the modal self-contained. The server-action
// re-validates so this is purely client-side UX.
const paymentFormSchema = z.object({
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
  entityType: PaymentEntityType;
  entityId: string;
  entityTotal: number; // paise
  entityPaidAmount: number; // paise (net = PAYMENT − REFUND)
  open: boolean;
  onClose: () => void;
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Direction label for the "Owed" hint in the modal. Sales: customer
// owes shop. Purchases/Casting/Plating: shop owes vendor.
function owedLabel(entityType: PaymentEntityType): string {
  switch (entityType) {
    case "sale":
      return "Outstanding";
    case "purchase":
    case "casting":
    case "plating":
      return "Owed to vendor";
  }
}

export function PaymentActionModal({
  entityType,
  entityId,
  entityTotal,
  entityPaidAmount,
  open,
  onClose,
}: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const outstandingPaise = entityTotal - entityPaidAmount;
  const isRefundMode = outstandingPaise < 0;
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
    defaultValues: emptyDefaults(isRefundMode),
  });

  // Reset every time the modal opens so a previously-closed-without-save
  // form doesn't leak amount/date values into the next open.
  useEffect(() => {
    if (open) {
      reset(emptyDefaults(isRefundMode));
      setFormError(null);
    }
  }, [open, isRefundMode, reset]);

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    // Dispatch by entityType. Today only sale is wired; the other
    // entity types will dispatch to their respective actions when the
    // mirror happens. Each entity's create*Payment action shape is
    // identical (date, amount as rupees, type, note), so the dispatch
    // is a pass-through.
    let result;
    switch (entityType) {
      case "sale":
        result = await createSalePayment({
          saleId: entityId,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
        break;
      case "purchase":
      case "casting":
      case "plating":
        setFormError(
          `Payment actions for ${entityType} entities are not wired yet (Phase 10 scoped to sales).`,
        );
        return;
    }

    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat)) {
        const messages = flat[key as keyof typeof flat];
        if (messages && messages.length > 0) {
          if (key === "amount" || key === "date" || key === "note") {
            setError(key, { message: messages[0] });
            surfaced = true;
          }
        }
      }
      if (!surfaced) setFormError("Save failed. Please retry.");
      return;
    }

    onClose();
    router.refresh();
  };

  const autoFillFullBalance = () => {
    const target = isRefundMode ? refundOwedPaise : outstandingPaise;
    setValue("amount", Math.max(0, target / 100), { shouldValidate: true });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-[500px] bg-surface-container border border-outline-variant p-6 gap-0">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-lg font-semibold tracking-tight text-on-surface">
            {isRefundMode ? "Record refund" : "Record payment"}
          </DialogTitle>
        </DialogHeader>

        <div className="mb-5 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">
              Total
            </p>
            <p className="tabular-nums font-mono">{formatCurrency(entityTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant mb-1">
              Paid
            </p>
            <p className="tabular-nums font-mono">
              {formatCurrency(entityPaidAmount)}
            </p>
          </div>
          <div>
            <p
              className={`text-[10px] uppercase tracking-wider mb-1 ${
                isRefundMode ? "text-error" : "text-on-surface-variant"
              }`}
            >
              {isRefundMode ? "Refund owed" : owedLabel(entityType)}
            </p>
            <p
              className={`tabular-nums font-mono ${
                isRefundMode ? "text-error" : ""
              }`}
            >
              {formatCurrency(isRefundMode ? refundOwedPaise : outstandingPaise)}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <input type="hidden" {...register("type")} />
          {formError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-3 py-2 text-sm">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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
              <div className="flex items-center justify-between">
                <FormLabel htmlFor="payment-amount" required>
                  Amount (₹)
                </FormLabel>
                <button
                  type="button"
                  onClick={autoFillFullBalance}
                  className="text-[10px] uppercase tracking-wider text-secondary hover:text-secondary-container transition-colors mb-1"
                >
                  {isRefundMode ? "Refund full" : "Pay full"}
                </button>
              </div>
              <FormInput
                id="payment-amount"
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
              <FormError>{errors.amount?.message}</FormError>
            </div>
          </div>

          <div>
            <FormLabel htmlFor="payment-note">Note (optional)</FormLabel>
            <FormTextarea
              id="payment-note"
              rows={2}
              {...register("note")}
            />
          </div>

          <DialogFooter className="mt-6 -mx-6 -mb-6 px-6 py-4 bg-transparent border-t border-outline-variant flex flex-row justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-w-[120px] h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyDefaults(isRefundMode: boolean): FormInputT {
  return {
    date: todayISO() as unknown as Date,
    amount: 0,
    type: isRefundMode ? "REFUND" : "PAYMENT",
    note: "",
  };
}
