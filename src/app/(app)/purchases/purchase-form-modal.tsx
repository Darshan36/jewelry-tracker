"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { type z } from "zod";

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

import { createPurchase, updatePurchase } from "./actions";
import { PartyPicker, type SupplierOption } from "./party-picker";
import { purchaseInputSchema } from "./schema";
import type { PurchaseForClient } from "./purchase-helpers";

type FormInputT = z.input<typeof purchaseInputSchema>;
type FormOutput = z.output<typeof purchaseInputSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase?: PurchaseForClient;
  suppliers: SupplierOption[];
};

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateToISO(date: Date | string | null | undefined): string {
  if (!date) return todayISO();
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return todayISO();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computeLiveTotalPaise(
  qty: unknown,
  rate: unknown,
  discount: unknown,
): bigint {
  const q = Number(qty);
  const r = Number(rate);
  const d = Number(discount);
  if (!Number.isFinite(q) || !Number.isFinite(r) || !Number.isFinite(d)) {
    return 0n;
  }
  try {
    return (
      BigInt(Math.max(0, Math.trunc(q))) *
        BigInt(Math.round(Math.max(0, r) * 100)) -
      BigInt(Math.round(Math.max(0, d) * 100))
    );
  } catch {
    return 0n;
  }
}

export function PurchaseFormModal({
  open,
  onOpenChange,
  purchase,
  suppliers,
}: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
    setValue,
    watch,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(purchaseInputSchema),
    defaultValues: emptyDefaults(),
  });

  useEffect(() => {
    if (open) {
      reset({
        date: dateToISO(purchase?.date) as unknown as Date,
        supplierId: purchase?.supplierId ?? null,
        partyName: purchase?.partyName ?? "",
        partyPhone: purchase?.partyPhone ?? "",
        itemDescription: purchase?.itemDescription ?? "",
        qty: purchase?.qty ?? 1,
        rate: purchase ? purchase.rate / 100 : 0,
        discount: purchase ? purchase.discount / 100 : 0,
        notes: purchase?.notes ?? "",
      });
      setFormError(null);
    }
  }, [open, purchase, reset]);

  const watchedQty = watch("qty");
  const watchedRate = watch("rate");
  const watchedDiscount = watch("discount");
  const watchedSupplierId = watch("supplierId");
  const watchedPartyName = watch("partyName");
  const watchedPartyPhone = watch("partyPhone");

  const liveTotalPaise = computeLiveTotalPaise(
    watchedQty,
    watchedRate,
    watchedDiscount,
  );
  const isNegativeTotal = liveTotalPaise < 0n;

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    const result = purchase
      ? await updatePurchase(purchase.id, data)
      : await createPurchase(data);

    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat)) {
        const messages = flat[key as keyof typeof flat];
        if (messages && messages.length > 0 && isFormField(key)) {
          setError(key, { message: messages[0] });
          surfaced = true;
        }
      }
      if (!surfaced) {
        setFormError("Save failed. Please retry.");
      }
      return;
    }

    onOpenChange(false);
    router.refresh();
  };

  const title = purchase ? "Edit purchase" : "Add purchase";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[600px] bg-surface-container border border-outline-variant p-6 gap-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-lg font-semibold tracking-tight text-on-surface">
            {title}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {formError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm">
              {formError}
            </div>
          )}

          <div>
            <FormLabel htmlFor="purchase-date" required>
              Date
            </FormLabel>
            <FormInput
              id="purchase-date"
              type="date"
              aria-invalid={!!errors.date}
              {...register("date")}
            />
            <FormError>
              {errors.date?.message ? String(errors.date.message) : null}
            </FormError>
          </div>

          <input type="hidden" {...register("supplierId")} />
          <input type="hidden" {...register("partyName")} />
          <input type="hidden" {...register("partyPhone")} />

          <PartyPicker
            suppliers={suppliers}
            value={{
              supplierId: (watchedSupplierId as string | null) ?? null,
              partyName: (watchedPartyName as string | undefined) ?? "",
              partyPhone:
                (watchedPartyPhone as string | null | undefined) ?? null,
            }}
            onChange={(v) => {
              setValue("supplierId", v.supplierId);
              setValue("partyName", v.partyName, { shouldValidate: true });
              setValue("partyPhone", v.partyPhone);
            }}
            error={errors.partyName?.message ?? errors.supplierId?.message}
          />

          <div>
            <FormLabel htmlFor="purchase-item" required>
              Item description
            </FormLabel>
            <FormTextarea
              id="purchase-item"
              rows={2}
              aria-invalid={!!errors.itemDescription}
              {...register("itemDescription")}
            />
            <FormError>{errors.itemDescription?.message}</FormError>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <FormLabel htmlFor="purchase-qty" required>
                Qty
              </FormLabel>
              <FormInput
                id="purchase-qty"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                aria-invalid={!!errors.qty}
                {...register("qty", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined
                      ? 0
                      : Number(v),
                })}
              />
              <FormError>{errors.qty?.message}</FormError>
            </div>
            <div>
              <FormLabel htmlFor="purchase-rate" required>
                Rate (₹)
              </FormLabel>
              <FormInput
                id="purchase-rate"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                aria-invalid={!!errors.rate}
                {...register("rate", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined
                      ? 0
                      : Number(v),
                })}
              />
              <FormError>{errors.rate?.message}</FormError>
            </div>
            <div>
              <FormLabel htmlFor="purchase-discount">Discount (₹)</FormLabel>
              <FormInput
                id="purchase-discount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                aria-invalid={!!errors.discount}
                {...register("discount", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined
                      ? 0
                      : Number(v),
                })}
              />
              <FormError>{errors.discount?.message}</FormError>
            </div>
          </div>

          <div
            className={`border bg-surface-container-high p-3 flex items-center justify-between ${
              isNegativeTotal ? "border-error" : "border-outline-variant"
            }`}
          >
            <span className="text-xs uppercase tracking-wider text-on-surface-variant font-display">
              Total
            </span>
            <span
              className={`text-lg font-display tabular-nums ${
                isNegativeTotal ? "text-error" : "text-on-surface"
              }`}
            >
              {formatCurrency(Number(liveTotalPaise))}
            </span>
          </div>
          {isNegativeTotal && (
            <p className="text-xs text-error -mt-3">
              Discount exceeds line total
            </p>
          )}

          <div>
            <FormLabel htmlFor="purchase-notes">Notes</FormLabel>
            <FormTextarea
              id="purchase-notes"
              rows={2}
              aria-invalid={!!errors.notes}
              {...register("notes")}
            />
            <FormError>{errors.notes?.message}</FormError>
          </div>

          <DialogFooter className="mt-6 -mx-6 -mb-6 px-6 py-4 bg-transparent border-t border-outline-variant flex flex-row justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
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

function emptyDefaults(): FormInputT {
  return {
    date: todayISO() as unknown as Date,
    supplierId: null,
    partyName: "",
    partyPhone: "",
    itemDescription: "",
    qty: 1,
    rate: 0,
    discount: 0,
    notes: "",
  };
}

const FORM_FIELDS = [
  "date",
  "supplierId",
  "partyName",
  "partyPhone",
  "itemDescription",
  "qty",
  "rate",
  "discount",
  "notes",
] as const;
type FormField = (typeof FORM_FIELDS)[number];
function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}
