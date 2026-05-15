"use client";

import { useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
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

export function SaleFormModal({
  open,
  onOpenChange,
  sale,
  customers,
}: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    control,
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

  const { fields, append, remove } = useFieldArray({
    control,
    // Cast: RHF's typing for nested array names on a schema with transforms
    // needs the explicit path string. Output type's `lineItems` array
    // matches FormInput's `lineItems` shape, so the form-state binding is
    // sound at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: "lineItems" as any,
  });

  useEffect(() => {
    if (open) {
      reset({
        date: dateToISO(sale?.date) as unknown as Date,
        customerId: sale?.customerId ?? null,
        partyName: sale?.partyName ?? "",
        partyPhone: sale?.partyPhone ?? "",
        lineItems: sale
          ? sale.lineItems.map((li) => ({
              itemDescription: li.itemDescription,
              qty: li.qty,
              rate: li.rate / 100,
            }))
          : [{ itemDescription: "", qty: 1, rate: 0 }],
        discount: sale ? sale.discount / 100 : 0,
        notes: sale?.notes ?? "",
      });
      setFormError(null);
    }
  }, [open, sale, reset]);

  const watchedLineItems = watch("lineItems") ?? [];
  const watchedDiscount = watch("discount");
  const watchedCustomerId = watch("customerId");
  const watchedPartyName = watch("partyName");
  const watchedPartyPhone = watch("partyPhone");

  // Live preview math in rupee floats. Persisted total is BigInt paise from
  // the server; this is a UI hint only. Negative final-total flags the
  // "discount exceeds subtotal" case before the action rejects it.
  const subtotal = watchedLineItems.reduce((sum, li) => {
    const q = Number(li?.qty ?? 0);
    const r = Number(li?.rate ?? 0);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return sum;
    return sum + Math.max(0, q) * Math.max(0, r);
  }, 0);
  const discountNum = Number(watchedDiscount ?? 0);
  const finalTotal = subtotal - (Number.isFinite(discountNum) ? Math.max(0, discountNum) : 0);
  const isNegativeTotal = finalTotal < 0;

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
          // Cast to any for the array-root case; RHF accepts string paths
          // and attaches the error to the field-array root.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setError(key as any, { message: messages[0] });
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
      <DialogContent className="w-full max-w-[760px] bg-surface-container border border-outline-variant p-6 gap-0 max-h-[90vh] overflow-y-auto">
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

          {/* Line items ------------------------------------------------- */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <FormLabel>Items</FormLabel>
              <button
                type="button"
                onClick={() =>
                  append({ itemDescription: "", qty: 1, rate: 0 })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-surface-container-high text-on-surface hover:bg-surface-container-highest border border-outline-variant transition-colors"
              >
                <Plus className="size-3.5" />
                Add line
              </button>
            </div>

            <div className="border border-outline-variant divide-y divide-outline-variant/50">
              {/* Header */}
              <div className="grid grid-cols-[1fr_80px_120px_120px_40px] gap-2 px-3 py-2 bg-surface-container-high text-xs uppercase tracking-wider font-display text-on-surface-variant">
                <span>Description</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Rate (₹)</span>
                <span className="text-right">Line total</span>
                <span></span>
              </div>

              {fields.map((field, idx) => {
                const q = Number(watchedLineItems[idx]?.qty ?? 0);
                const r = Number(watchedLineItems[idx]?.rate ?? 0);
                const lineTotalPaise =
                  Number.isFinite(q) && Number.isFinite(r)
                    ? Math.max(0, q) * Math.max(0, r) * 100
                    : 0;

                const lineErrors = errors.lineItems?.[idx];

                return (
                  <div
                    key={field.id}
                    role="group"
                    aria-label={`Line ${idx + 1}`}
                    className="grid grid-cols-[1fr_80px_120px_120px_40px] gap-2 px-3 py-2 items-start"
                  >
                    <div>
                      <FormInput
                        id={`sale-line-${idx}-item`}
                        type="text"
                        autoComplete="off"
                        placeholder="Item description"
                        aria-invalid={!!lineErrors?.itemDescription}
                        {...register(`lineItems.${idx}.itemDescription`)}
                      />
                      {lineErrors?.itemDescription?.message && (
                        <FormError>
                          {lineErrors.itemDescription.message}
                        </FormError>
                      )}
                    </div>
                    <div>
                      <FormInput
                        id={`sale-line-${idx}-qty`}
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        className="text-right tabular-nums"
                        aria-invalid={!!lineErrors?.qty}
                        {...register(`lineItems.${idx}.qty`, {
                          setValueAs: (v) =>
                            v === "" || v === null || v === undefined
                              ? 0
                              : Number(v),
                        })}
                      />
                      {lineErrors?.qty?.message && (
                        <FormError>{lineErrors.qty.message}</FormError>
                      )}
                    </div>
                    <div>
                      <FormInput
                        id={`sale-line-${idx}-rate`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        aria-invalid={!!lineErrors?.rate}
                        {...register(`lineItems.${idx}.rate`, {
                          setValueAs: (v) =>
                            v === "" || v === null || v === undefined
                              ? 0
                              : Number(v),
                        })}
                      />
                      {lineErrors?.rate?.message && (
                        <FormError>{lineErrors.rate.message}</FormError>
                      )}
                    </div>
                    <div className="h-10 flex items-center justify-end pr-1 text-on-surface tabular-nums font-mono text-sm">
                      {formatCurrency(lineTotalPaise)}
                    </div>
                    <div className="h-10 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => remove(idx)}
                        disabled={fields.length === 1}
                        aria-label={`Remove line ${idx + 1}`}
                        className="p-1.5 text-on-surface-variant hover:text-error disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {errors.lineItems?.message && (
              <FormError>{String(errors.lineItems.message)}</FormError>
            )}
          </div>

          {/* Totals ----------------------------------------------------- */}
          <div className="border border-outline-variant bg-surface-container-high p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Subtotal</span>
              <span className="tabular-nums font-mono text-on-surface">
                {formatCurrency(subtotal * 100)}
              </span>
            </div>
            <div className="grid grid-cols-[1fr_140px] gap-3 items-center">
              <FormLabel htmlFor="sale-discount" className="!mb-0 text-sm normal-case tracking-normal text-on-surface-variant">
                Discount (₹)
              </FormLabel>
              <FormInput
                id="sale-discount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="text-right tabular-nums"
                aria-invalid={!!errors.discount}
                {...register("discount", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined ? 0 : Number(v),
                })}
              />
            </div>
            <FormError>{errors.discount?.message}</FormError>

            <div className="border-t border-outline-variant pt-3 flex items-center justify-between">
              <span className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
                Total
              </span>
              <span
                className={`text-lg font-display tabular-nums ${
                  isNegativeTotal ? "text-error" : "text-on-surface"
                }`}
              >
                {formatCurrency(finalTotal * 100)}
              </span>
            </div>
            {isNegativeTotal && (
              <p className="text-xs text-error">
                Discount exceeds line item subtotal
              </p>
            )}
          </div>

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
    lineItems: [{ itemDescription: "", qty: 1, rate: 0 }],
    discount: 0,
    notes: "",
  };
}

const FORM_FIELDS = [
  "date",
  "customerId",
  "partyName",
  "partyPhone",
  "lineItems",
  "discount",
  "notes",
] as const;
type FormField = (typeof FORM_FIELDS)[number];
function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}
