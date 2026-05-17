"use client";

// Standalone purchase form — extracted from purchase-form-modal.tsx in Phase 10.
// Renders without a Dialog wrapper for use inside dedicated form pages
// at /purchases/new and /purchases/[id]/edit.
//
// The form's internals — RHF, useFieldArray, zodResolver, the live
// subtotal/discount/total preview — are unchanged from the modal era;
// what changed is the surrounding container (page vs Dialog) and the
// save-flow choice ("Save and return" vs "Save and add another") via
// SaveDropdown.

import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { type z } from "zod";

import {
  FormError,
  FormInput,
  FormLabel,
  FormTextarea,
} from "@/components/form-controls";
import { SaveDropdown, type SaveMode } from "@/components/save-dropdown";
import { formatCurrency } from "@/lib/format";

import { createPurchase, updatePurchase } from "./actions";
import { PartyPicker, type SupplierOption } from "./party-picker";
import { purchaseInputSchema } from "./schema";
import type { PurchaseForClient } from "./purchase-helpers";

type FormInputT = z.input<typeof purchaseInputSchema>;
type FormOutput = z.output<typeof purchaseInputSchema>;

type Props = {
  mode: "create" | "edit";
  purchase?: PurchaseForClient;
  suppliers: SupplierOption[];
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateToISO(date: Date | string | null | undefined): string {
  if (!date) return todayISO();
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return todayISO();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyDefaults(): FormInputT {
  return {
    date: todayISO() as unknown as Date,
    supplierId: null,
    partyName: "",
    partyPhone: "",
    lineItems: [{ itemDescription: "", qty: 1, rate: 0 }],
    discount: 0,
    notes: "",
  };
}

export function PurchaseForm({ mode, purchase, suppliers }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // saveMode read inside onSubmit via a ref because setSaveMode + the
  // synchronous handleSubmit() call below would otherwise race — the
  // submit closure captures the previous state value before React's
  // re-render. Refs give synchronous read/write semantics.
  const saveModeRef = useRef<SaveMode>("return");

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
    resolver: zodResolver(purchaseInputSchema),
    defaultValues: emptyDefaults(),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: "lineItems" as any,
  });

  // Seed the form once on mount (edit) or with defaults (create).
  useEffect(() => {
    reset({
      date: dateToISO(purchase?.date) as unknown as Date,
      supplierId: purchase?.supplierId ?? null,
      partyName: purchase?.partyName ?? "",
      partyPhone: purchase?.partyPhone ?? "",
      lineItems: purchase
        ? purchase.lineItems.map((li) => ({
            itemDescription: li.itemDescription,
            qty: li.qty,
            rate: li.rate / 100,
          }))
        : [{ itemDescription: "", qty: 1, rate: 0 }],
      discount: purchase ? purchase.discount / 100 : 0,
      notes: purchase?.notes ?? "",
    });
  }, [purchase, reset]);

  const watchedLineItems = watch("lineItems") ?? [];
  const watchedDiscount = watch("discount");
  const watchedSupplierId = watch("supplierId");
  const watchedPartyName = watch("partyName");
  const watchedPartyPhone = watch("partyPhone");

  const subtotal = watchedLineItems.reduce((sum, li) => {
    const q = Number(li?.qty ?? 0);
    const r = Number(li?.rate ?? 0);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return sum;
    return sum + Math.max(0, q) * Math.max(0, r);
  }, 0);
  const discountNum = Number(watchedDiscount ?? 0);
  const finalTotal =
    subtotal -
    (Number.isFinite(discountNum) ? Math.max(0, discountNum) : 0);
  const isNegativeTotal = finalTotal < 0;

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    const result =
      mode === "edit" && purchase
        ? await updatePurchase(purchase.id, data)
        : await createPurchase(data);

    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat)) {
        const messages = flat[key as keyof typeof flat];
        if (messages && messages.length > 0 && isFormField(key)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setError(key as any, { message: messages[0] });
          surfaced = true;
        }
      }
      if (!surfaced) setFormError("Save failed. Please retry.");
      return;
    }

    if (saveModeRef.current === "return") {
      router.push("/purchases");
      router.refresh();
    } else {
      reset(emptyDefaults());
      router.refresh();
      // Scroll to top so the user sees the freshly cleared form.
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-5 max-w-4xl"
      noValidate
    >
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
                    id={`purchase-line-${idx}-item`}
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
                    id={`purchase-line-${idx}-qty`}
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
                    id={`purchase-line-${idx}-rate`}
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

      <div className="border border-outline-variant bg-surface-container-high p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-on-surface-variant">Subtotal</span>
          <span className="tabular-nums font-mono text-on-surface">
            {formatCurrency(subtotal * 100)}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_140px] gap-3 items-center">
          <FormLabel
            htmlFor="purchase-discount"
            className="!mb-0 text-sm normal-case tracking-normal text-on-surface-variant"
          >
            Discount (₹)
          </FormLabel>
          <FormInput
            id="purchase-discount"
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
        <FormLabel htmlFor="purchase-notes">Notes</FormLabel>
        <FormTextarea
          id="purchase-notes"
          rows={2}
          aria-invalid={!!errors.notes}
          {...register("notes")}
        />
        <FormError>{errors.notes?.message}</FormError>
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant">
        <button
          type="button"
          onClick={() => router.push("/purchases")}
          disabled={isSubmitting}
          className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
        >
          Cancel
        </button>
        <SaveDropdown
          saving={isSubmitting}
          // The dropdown picks "return" or "another"; we stash the chosen
          // mode in state so the (separate) form-submit handler can read
          // it. SaveDropdown.onSave is what actually triggers the form
          // submit programmatically via the type=submit button below.
          onSave={(m) => {
            saveModeRef.current = m;
            handleSubmit(onSubmit)();
          }}
        />
      </div>
    </form>
  );
}

const FORM_FIELDS = [
  "date",
  "supplierId",
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
