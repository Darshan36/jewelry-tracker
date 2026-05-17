"use client";

// Standalone sale form — extracted from sale-form-modal.tsx in Phase 10.
// Renders without a Dialog wrapper for use inside dedicated form pages
// at /sales/new and /sales/[id]/edit.
//
// Phase 10.5: bill-in-form retrofit. The form now has an inline bill
// attach section after the line items. The bill upload happens AFTER
// the entry create/update (the entry needs an id before the bill can
// be attached). Flow on submit:
//   1. createSale / updateSale → entry.id
//   2. If a file is picked: prepareUpload (attachedToType="SALE",
//      attachedToId=entry.id) → R2 PUT → confirmUpload
//   3. Navigate via SaveMode (return) or reset (another)
// If step 2 fails, the entry IS saved — error banner shows + the user
// can use the inline 📎 BillActionModal from the row to retry. No
// rollback of step 1 (the entry stands on its own).

import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Paperclip, Plus, X } from "lucide-react";
import { type z } from "zod";

import {
  FormError,
  FormInput,
  FormLabel,
  FormTextarea,
} from "@/components/form-controls";
import { SaveDropdown, type SaveMode } from "@/components/save-dropdown";
import { BillPreview } from "@/components/bill-preview";
import { formatCurrency } from "@/lib/format";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
} from "@/app/(app)/bills/schema";
import {
  confirmUpload,
  prepareUpload,
} from "@/app/(app)/bills/actions";

import { createSale, updateSale } from "./actions";
import { PartyPicker, type CustomerOption } from "./party-picker";
import { saleInputSchema } from "./schema";
import type { SaleForClient } from "./sale-helpers";

type FormInputT = z.input<typeof saleInputSchema>;
type FormOutput = z.output<typeof saleInputSchema>;

type Props = {
  mode: "create" | "edit";
  sale?: SaleForClient;
  customers: CustomerOption[];
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
    customerId: null,
    partyName: "",
    partyPhone: "",
    lineItems: [{ itemDescription: "", qty: 1, rate: 0 }],
    discount: 0,
    notes: "",
  };
}

function isAllowedMime(t: string): t is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(t);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function putToR2(presignedUrl: string, file: File): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl, true);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 PUT failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export function SaleForm({ mode, sale, customers }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // saveMode read inside onSubmit via a ref because setSaveMode + the
  // synchronous handleSubmit() call below would otherwise race — the
  // submit closure captures the previous state value before React's
  // re-render. Refs give synchronous read/write semantics.
  const saveModeRef = useRef<SaveMode>("return");
  // Phase 10.5: optional bill-in-form. Picked file lives in state;
  // upload runs after the entry create/update succeeds. Replacing an
  // existing bill from the form page isn't supported — that flow lives
  // in the row-level BillActionModal.
  const [pickedBillFile, setPickedBillFile] = useState<File | null>(null);
  const [billPickerError, setBillPickerError] = useState<string | null>(null);
  const [billUploadStatus, setBillUploadStatus] = useState<
    "idle" | "preparing" | "uploading" | "confirming"
  >("idle");
  const billInputRef = useRef<HTMLInputElement | null>(null);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: "lineItems" as any,
  });

  // Seed the form once on mount (edit) or with defaults (create).
  useEffect(() => {
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
  }, [sale, reset]);

  const watchedLineItems = watch("lineItems") ?? [];
  const watchedDiscount = watch("discount");
  const watchedCustomerId = watch("customerId");
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
      mode === "edit" && sale
        ? await updateSale(sale.id, data)
        : await createSale(data);

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

    // Entry is saved. If a bill is picked, run the upload chain
    // attached to the entry's id. On failure, leave the entry saved
    // and surface a banner — the user can retry via the row-level
    // BillActionModal.
    const savedSaleId = result.sale.id;
    if (pickedBillFile) {
      try {
        setBillUploadStatus("preparing");
        const prep = await prepareUpload({
          originalFilename: pickedBillFile.name,
          mimeType: pickedBillFile.type as AllowedMimeType,
          sizeBytes: pickedBillFile.size,
          attachedToType: "SALE",
          attachedToId: savedSaleId,
        });
        if (!prep.ok) {
          const first = Object.values(prep.errors).flat().find(Boolean);
          throw new Error(first ?? "Bill preparation failed");
        }
        setBillUploadStatus("uploading");
        await putToR2(prep.presignedUrl, pickedBillFile);
        setBillUploadStatus("confirming");
        const conf = await confirmUpload({ billId: prep.billId });
        if (!conf.ok) {
          const first = Object.values(conf.errors).flat().find(Boolean);
          throw new Error(first ?? "Bill confirmation failed");
        }
        setBillUploadStatus("idle");
      } catch (err) {
        setBillUploadStatus("idle");
        setFormError(
          `Sale saved, but bill upload failed: ${
            err instanceof Error ? err.message : String(err)
          }. Use the 📎 button in the sales list to retry.`,
        );
        // Don't navigate away — leave the user on the form so they
        // can see the error. The sale is saved; they can also use the
        // row-level modal from /sales.
        router.refresh();
        return;
      }
    }

    if (saveModeRef.current === "return") {
      router.push("/sales");
      router.refresh();
    } else {
      reset(emptyDefaults());
      setPickedBillFile(null);
      setBillPickerError(null);
      if (billInputRef.current) billInputRef.current.value = "";
      router.refresh();
      // Scroll to top so the user sees the freshly cleared form.
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  const onPickBillFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBillPickerError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setPickedBillFile(null);
      return;
    }
    if (!isAllowedMime(file.type)) {
      setPickedBillFile(null);
      setBillPickerError(
        `Unsupported file type "${file.type || "unknown"}". PDF, JPEG, PNG, WebP only.`,
      );
      if (billInputRef.current) billInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setPickedBillFile(null);
      setBillPickerError(
        `File too large (${formatBytes(file.size)}). Max ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
      );
      if (billInputRef.current) billInputRef.current.value = "";
      return;
    }
    setPickedBillFile(file);
  };

  const billBusy = billUploadStatus !== "idle";
  const billBusyLabel =
    billUploadStatus === "preparing"
      ? "Preparing bill"
      : billUploadStatus === "uploading"
        ? "Uploading bill"
        : billUploadStatus === "confirming"
          ? "Confirming bill"
          : "";

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
          {/* Column-header row only renders on md+ — on mobile, each row is
              self-explanatory with placeholders and the line-total readout. */}
          <div className="hidden md:grid md:grid-cols-[1fr_80px_120px_120px_40px] gap-2 px-3 py-2 bg-surface-container-high text-xs uppercase tracking-wider font-display text-on-surface-variant">
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
                className="grid grid-cols-1 md:grid-cols-[1fr_80px_120px_120px_40px] gap-2 px-3 py-3 md:py-2 items-start"
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
                {/* Mobile: nested 3-col sub-grid for qty/rate/remove on row 2.
                    md+ via `md:contents`: the four children of this div
                    (qty, rate, desktop line total, remove) flatten into the
                    outer 5-col grid at cols 2/3/4/5 — preserving the desktop
                    horizontal layout. The desktop-only line total has
                    `hidden md:flex` so it doesn't take a sub-grid slot on
                    mobile (display:none is removed from layout). */}
                <div className="grid grid-cols-[1fr_1fr_44px] gap-2 md:contents">
                  <div>
                    <FormInput
                      id={`sale-line-${idx}-qty`}
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      placeholder="Qty"
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
                      placeholder="Rate ₹"
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
                  {/* Desktop-only line total — col 4 of outer grid via
                      md:contents. Hidden on mobile (no slot in sub-grid). */}
                  <div className="hidden md:flex md:h-10 md:items-center md:justify-end md:pr-1 text-on-surface tabular-nums font-mono text-sm">
                    {formatCurrency(lineTotalPaise)}
                  </div>
                  {/* Remove button — col 3 of mobile sub-grid, col 5 of
                      outer desktop grid via md:contents. 44px touch target. */}
                  <div className="h-11 md:h-10 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => remove(idx)}
                      disabled={fields.length === 1}
                      aria-label={`Remove line ${idx + 1}`}
                      className="h-11 w-11 md:h-8 md:w-8 flex items-center justify-center text-on-surface-variant hover:text-error disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
                {/* Mobile-only line total — row 3 on mobile. Hidden on md+
                    (the desktop variant inside the md:contents group renders). */}
                <div className="md:hidden flex items-center justify-end text-sm tabular-nums font-mono text-on-surface">
                  <span className="text-xs uppercase tracking-wider text-on-surface-variant mr-2">
                    Line total
                  </span>
                  {formatCurrency(lineTotalPaise)}
                </div>
              </div>
            );
          })}
        </div>

        {errors.lineItems?.message && (
          <FormError>{String(errors.lineItems.message)}</FormError>
        )}
      </div>

      <div>
        <FormLabel>
          <span className="inline-flex items-center gap-1.5">
            <Paperclip className="size-3.5" />
            Attach bill (optional)
          </span>
        </FormLabel>
        <div className="border border-outline-variant bg-surface-container-low p-3 space-y-3">
          {mode === "edit" && sale && (
            <p className="text-xs text-on-surface-variant italic">
              To replace or remove an existing bill on this sale, use the
              📎 button on the sales list row. Picking a file here adds a
              new bill alongside.
            </p>
          )}
          {!pickedBillFile && (
            <input
              ref={billInputRef}
              type="file"
              accept={ALLOWED_MIME_TYPES.join(",")}
              onChange={onPickBillFile}
              disabled={isSubmitting || billBusy}
              className="text-sm text-on-surface file:mr-3 file:py-2 file:px-4 file:border-0 file:bg-surface-container-high file:text-on-surface file:font-display file:uppercase file:tracking-wider file:text-xs hover:file:bg-surface-container-highest"
            />
          )}
          {billPickerError && (
            <p className="text-xs text-error">{billPickerError}</p>
          )}
          {pickedBillFile && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-on-surface truncate">
                  {pickedBillFile.name} · {formatBytes(pickedBillFile.size)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPickedBillFile(null);
                    setBillPickerError(null);
                    if (billInputRef.current)
                      billInputRef.current.value = "";
                  }}
                  disabled={billBusy}
                  className="text-xs uppercase tracking-wider text-on-surface-variant hover:text-error transition-colors"
                >
                  Remove
                </button>
              </div>
              <BillPreview file={pickedBillFile} />
            </div>
          )}
          <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">
            Max {formatBytes(MAX_FILE_SIZE_BYTES)}. PDF, JPEG, PNG, WebP.
          </p>
        </div>
      </div>

      <div className="border border-outline-variant bg-surface-container-high p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-on-surface-variant">Subtotal</span>
          <span className="tabular-nums font-mono text-on-surface">
            {formatCurrency(subtotal * 100)}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_120px] md:grid-cols-[1fr_140px] gap-3 items-center">
          <FormLabel
            htmlFor="sale-discount"
            className="!mb-0 text-sm normal-case tracking-normal text-on-surface-variant"
          >
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

      {/* Form footer. Mobile: stack reverse (save above cancel) and stick
          to the viewport bottom so it's reachable without scrolling through
          a long form. -mx-4 + px-4 makes the sticky band span the page
          padding so the background fully obscures content behind it.
          Desktop: horizontal right-aligned row, no sticky. */}
      <div
        className="flex flex-col-reverse gap-3 pt-4 border-t border-outline-variant
          sticky bottom-0 z-10 -mx-4 px-4 pb-4 bg-surface
          md:static md:flex-row md:items-center md:justify-end md:mx-0 md:px-0 md:pb-0 md:bg-transparent"
      >
        <button
          type="button"
          onClick={() => router.push("/sales")}
          disabled={isSubmitting}
          className="h-11 md:h-10 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors w-full md:w-auto"
        >
          Cancel
        </button>
        <SaveDropdown
          saving={isSubmitting || billBusy}
          primaryLabel={
            billBusy ? billBusyLabel : "Save and return"
          }
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
