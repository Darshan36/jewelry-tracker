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

import { createSale, updateSale } from "./actions";
import {
  PartyPicker,
  type CustomerOption,
} from "./party-picker";
import { saleInputSchema } from "./schema";
import type { SaleForClient } from "./sale-helpers";

type FormInputT = z.input<typeof saleInputSchema>;
type FormOutput = z.output<typeof saleInputSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale?: SaleForClient;
  customers: CustomerOption[];
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

export function SaleFormModal({
  open,
  onOpenChange,
  sale,
  customers,
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
    resolver: zodResolver(saleInputSchema),
    defaultValues: emptyDefaults(),
  });

  useEffect(() => {
    if (open) {
      reset({
        date: dateToISO(sale?.date) as unknown as Date,
        customerId: sale?.customerId ?? null,
        partyName: sale?.partyName ?? "",
        partyPhone: sale?.partyPhone ?? "",
        itemDescription: sale?.itemDescription ?? "",
        qty: sale?.qty ?? 1,
        rate: sale ? sale.rate / 100 : 0,
        discount: sale ? sale.discount / 100 : 0,
        notes: sale?.notes ?? "",
      });
      setFormError(null);
    }
  }, [open, sale, reset]);

  // Watches for the live-total display and the controlled PartyPicker.
  const watchedQty = watch("qty");
  const watchedRate = watch("rate");
  const watchedDiscount = watch("discount");
  const watchedCustomerId = watch("customerId");
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

    const result = sale
      ? await updateSale(sale.id, data)
      : await createSale(data);

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

  const title = sale ? "Edit sale" : "Add sale";

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
            <FormLabel htmlFor="sale-date" required>
              Date
            </FormLabel>
            <FormInput
              id="sale-date"
              type="date"
              aria-invalid={!!errors.date}
              {...register("date")}
            />
            <FormError>
              {errors.date?.message ? String(errors.date.message) : null}
            </FormError>
          </div>

          {/* Hidden inputs register the three party fields with RHF.
              The visible PartyPicker drives them via setValue/watch. */}
          <input type="hidden" {...register("customerId")} />
          <input type="hidden" {...register("partyName")} />
          <input type="hidden" {...register("partyPhone")} />

          <PartyPicker
            customers={customers}
            value={{
              customerId: (watchedCustomerId as string | null) ?? null,
              partyName: (watchedPartyName as string | undefined) ?? "",
              partyPhone:
                (watchedPartyPhone as string | null | undefined) ?? null,
            }}
            onChange={(v) => {
              setValue("customerId", v.customerId);
              setValue("partyName", v.partyName, { shouldValidate: true });
              setValue("partyPhone", v.partyPhone);
            }}
            error={errors.partyName?.message ?? errors.customerId?.message}
          />

          <div>
            <FormLabel htmlFor="sale-item" required>
              Item description
            </FormLabel>
            <FormTextarea
              id="sale-item"
              rows={2}
              aria-invalid={!!errors.itemDescription}
              {...register("itemDescription")}
            />
            <FormError>{errors.itemDescription?.message}</FormError>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <FormLabel htmlFor="sale-qty" required>
                Qty
              </FormLabel>
              <FormInput
                id="sale-qty"
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
              <FormLabel htmlFor="sale-rate" required>
                Rate (₹)
              </FormLabel>
              <FormInput
                id="sale-rate"
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
              <FormLabel htmlFor="sale-discount">Discount (₹)</FormLabel>
              <FormInput
                id="sale-discount"
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

          {/* Live total — server is the source of truth, this is preview only. */}
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
            <FormLabel htmlFor="sale-notes">Notes</FormLabel>
            <FormTextarea
              id="sale-notes"
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
    customerId: null,
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
  "customerId",
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
