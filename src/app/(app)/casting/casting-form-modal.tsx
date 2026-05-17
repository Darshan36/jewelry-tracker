"use client";

import { useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Upload, X } from "lucide-react";
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
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
} from "@/app/(app)/bills/schema";
import {
  confirmUpload,
  prepareUpload,
  softDeleteBill,
} from "@/app/(app)/bills/actions";

import {
  attachBillToCastingEntry,
  createCastingEntry,
  detachBillFromCastingEntry,
  updateCastingEntry,
} from "./actions";
import { PartyPicker, type VendorOption } from "./party-picker";
import { castingEntryInputSchema } from "./schema";
import type { CastingEntryForClient } from "./casting-helpers";

type FormInputT = z.input<typeof castingEntryInputSchema>;
type FormOutput = z.output<typeof castingEntryInputSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry?: CastingEntryForClient;
  vendors: VendorOption[];
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

function isAllowedMime(t: string): t is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(t);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function CastingFormModal({ open, onOpenChange, entry, vendors }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [filePickerError, setFilePickerError] = useState<string | null>(null);
  const [billStatus, setBillStatus] = useState<
    "idle" | "preparing" | "uploading" | "confirming" | "attaching"
  >("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    resolver: zodResolver(castingEntryInputSchema),
    defaultValues: emptyDefaults(),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: "lineItems" as any,
  });

  useEffect(() => {
    if (open) {
      reset({
        date: dateToISO(entry?.date) as unknown as Date,
        vendorId: entry?.vendorId ?? null,
        partyName: entry?.partyName ?? "",
        partyPhone: entry?.partyPhone ?? "",
        lineItems: entry
          ? entry.lineItems.map((li) => ({
              materialDescription: li.materialDescription,
              weightKg: parseFloat(li.weightKg),
              ratePerKg: li.ratePerKg / 100,
            }))
          : [{ materialDescription: "", weightKg: 0, ratePerKg: 0 }],
        discount: entry ? entry.discount / 100 : 0,
        billId: entry?.billId ?? null,
        notes: entry?.notes ?? "",
      });
      setFormError(null);
      setPickedFile(null);
      setFilePickerError(null);
      setBillStatus("idle");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open, entry, reset]);

  const watchedLineItems = watch("lineItems") ?? [];
  const watchedDiscount = watch("discount");
  const watchedVendorId = watch("vendorId");
  const watchedPartyName = watch("partyName");
  const watchedPartyPhone = watch("partyPhone");

  // Live preview math in rupee floats. Display only — the server's
  // Decimal × BigInt math is the source of truth (and may round
  // differently for borderline cases; the live preview is a hint).
  const subtotalRupees = watchedLineItems.reduce((sum, li) => {
    const w = Number(li?.weightKg ?? 0);
    const r = Number(li?.ratePerKg ?? 0);
    if (!Number.isFinite(w) || !Number.isFinite(r)) return sum;
    return sum + Math.max(0, w) * Math.max(0, r);
  }, 0);
  const discountNum = Number(watchedDiscount ?? 0);
  const finalRupees =
    subtotalRupees -
    (Number.isFinite(discountNum) ? Math.max(0, discountNum) : 0);
  const isNegativeTotal = finalRupees < 0;

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFilePickerError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setPickedFile(null);
      return;
    }
    if (!isAllowedMime(file.type)) {
      setPickedFile(null);
      setFilePickerError(
        `Unsupported file type "${file.type || "unknown"}". PDF, JPEG, PNG, WebP.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setPickedFile(null);
      setFilePickerError(
        `File too large (${formatBytes(file.size)}). Max ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setPickedFile(file);
  }

  // Upload a file to R2 attached to a casting entry. Two-stage flow
  // mirrors Phase 8: prepareUpload (creates Bill PENDING row + returns
  // presigned PUT URL) → browser PUT → confirmUpload (verifies + flips
  // to READY) → attach billId to the entry.
  async function uploadBillForEntry(entryId: string, file: File) {
    setBillStatus("preparing");
    const prep = await prepareUpload({
      originalFilename: file.name,
      mimeType: file.type as AllowedMimeType,
      sizeBytes: file.size,
      attachedToType: "CASTING_ENTRY",
      attachedToId: entryId,
    });
    if (!prep.ok) {
      const first = Object.values(prep.errors).flat().find(Boolean);
      throw new Error(first ?? "Bill prepareUpload failed");
    }

    setBillStatus("uploading");
    await putToR2(prep.presignedUrl, file);

    setBillStatus("confirming");
    const conf = await confirmUpload({ billId: prep.billId });
    if (!conf.ok) {
      const first = Object.values(conf.errors).flat().find(Boolean);
      throw new Error(first ?? "Bill confirm failed");
    }

    setBillStatus("attaching");
    const attach = await attachBillToCastingEntry(entryId, prep.billId);
    if (!attach.ok) throw new Error("Failed to attach bill");

    setBillStatus("idle");
    return prep.billId;
  }

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    // Stage 1: save the entry. For create, we exclude billId from the
    // initial save because the bill row doesn't exist yet — it gets
    // attached after upload via attachBillToCastingEntry.
    const dataForSave = { ...data, billId: pickedFile ? null : data.billId };

    const result = entry
      ? await updateCastingEntry(entry.id, dataForSave)
      : await createCastingEntry(dataForSave);

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

    const savedEntry = result.entry;

    // Stage 2: if the user picked a new file, run the upload pipeline
    // attached to the saved entry. If editing and the entry already had
    // a bill, soft-delete that old bill first (which removes the R2
    // object) before uploading the replacement.
    if (pickedFile) {
      try {
        if (entry?.billId) {
          // Detach first (clears the FK), then soft-delete the old bill.
          // Doing detach before delete avoids tripping the @unique
          // constraint on billId during the transient state.
          await detachBillFromCastingEntry(savedEntry.id);
          await softDeleteBill({ billId: entry.billId });
        }
        await uploadBillForEntry(savedEntry.id, pickedFile);
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Bill upload failed.",
        );
        // Entry IS saved — just bill upload failed. Refresh so the saved
        // entry shows up, but leave the modal open so user can retry.
        router.refresh();
        return;
      }
    }

    onOpenChange(false);
    router.refresh();
  };

  const title = entry ? "Edit casting entry" : "Add casting entry";
  const busy = isSubmitting || billStatus !== "idle";
  const busyLabel =
    billStatus === "preparing"
      ? "Preparing bill"
      : billStatus === "uploading"
        ? "Uploading bill"
        : billStatus === "confirming"
          ? "Confirming bill"
          : billStatus === "attaching"
            ? "Attaching bill"
            : "Saving";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[820px] bg-surface-container border border-outline-variant p-6 gap-0 max-h-[90vh] overflow-y-auto">
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
            <FormLabel htmlFor="casting-date" required>
              Date
            </FormLabel>
            <FormInput
              id="casting-date"
              type="date"
              aria-invalid={!!errors.date}
              {...register("date")}
            />
            <FormError>
              {errors.date?.message ? String(errors.date.message) : null}
            </FormError>
          </div>

          <input type="hidden" {...register("vendorId")} />
          <input type="hidden" {...register("partyName")} />
          <input type="hidden" {...register("partyPhone")} />
          <input type="hidden" {...register("billId")} />

          <PartyPicker
            vendors={vendors}
            value={{
              vendorId: (watchedVendorId as string | null) ?? null,
              partyName: (watchedPartyName as string | undefined) ?? "",
              partyPhone:
                (watchedPartyPhone as string | null | undefined) ?? null,
            }}
            onChange={(v) => {
              setValue("vendorId", v.vendorId);
              setValue("partyName", v.partyName, { shouldValidate: true });
              setValue("partyPhone", v.partyPhone);
            }}
            error={errors.partyName?.message ?? errors.vendorId?.message}
          />

          <div>
            <div className="flex items-center justify-between mb-2">
              <FormLabel>Materials</FormLabel>
              <button
                type="button"
                onClick={() =>
                  append({ materialDescription: "", weightKg: 0, ratePerKg: 0 })
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-surface-container-high text-on-surface hover:bg-surface-container-highest border border-outline-variant transition-colors"
              >
                <Plus className="size-3.5" />
                Add line
              </button>
            </div>

            <div className="border border-outline-variant divide-y divide-outline-variant/50">
              <div className="grid grid-cols-[1fr_110px_130px_130px_40px] gap-2 px-3 py-2 bg-surface-container-high text-xs uppercase tracking-wider font-display text-on-surface-variant">
                <span>Material</span>
                <span className="text-right">Weight (kg)</span>
                <span className="text-right">Rate (₹/kg)</span>
                <span className="text-right">Line total</span>
                <span></span>
              </div>

              {fields.map((field, idx) => {
                const w = Number(watchedLineItems[idx]?.weightKg ?? 0);
                const r = Number(watchedLineItems[idx]?.ratePerKg ?? 0);
                const lineTotalPaise =
                  Number.isFinite(w) && Number.isFinite(r)
                    ? Math.round(Math.max(0, w) * Math.max(0, r) * 100)
                    : 0;
                const lineErrors = errors.lineItems?.[idx];

                return (
                  <div
                    key={field.id}
                    role="group"
                    aria-label={`Line ${idx + 1}`}
                    className="grid grid-cols-[1fr_110px_130px_130px_40px] gap-2 px-3 py-2 items-start"
                  >
                    <div>
                      <FormInput
                        id={`casting-line-${idx}-material`}
                        type="text"
                        autoComplete="off"
                        placeholder="e.g. Brass, Aluminium"
                        aria-invalid={!!lineErrors?.materialDescription}
                        {...register(`lineItems.${idx}.materialDescription`)}
                      />
                      {lineErrors?.materialDescription?.message && (
                        <FormError>
                          {lineErrors.materialDescription.message}
                        </FormError>
                      )}
                    </div>
                    <div>
                      <FormInput
                        id={`casting-line-${idx}-weight`}
                        type="number"
                        min="0"
                        step="0.001"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        aria-invalid={!!lineErrors?.weightKg}
                        {...register(`lineItems.${idx}.weightKg`, {
                          setValueAs: (v) =>
                            v === "" || v === null || v === undefined
                              ? 0
                              : Number(v),
                        })}
                      />
                      {lineErrors?.weightKg?.message && (
                        <FormError>{lineErrors.weightKg.message}</FormError>
                      )}
                    </div>
                    <div>
                      <FormInput
                        id={`casting-line-${idx}-rate`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right tabular-nums"
                        aria-invalid={!!lineErrors?.ratePerKg}
                        {...register(`lineItems.${idx}.ratePerKg`, {
                          setValueAs: (v) =>
                            v === "" || v === null || v === undefined
                              ? 0
                              : Number(v),
                        })}
                      />
                      {lineErrors?.ratePerKg?.message && (
                        <FormError>{lineErrors.ratePerKg.message}</FormError>
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
                {formatCurrency(Math.round(subtotalRupees * 100))}
              </span>
            </div>
            <div className="grid grid-cols-[1fr_140px] gap-3 items-center">
              <FormLabel
                htmlFor="casting-discount"
                className="!mb-0 text-sm normal-case tracking-normal text-on-surface-variant"
              >
                Discount (₹)
              </FormLabel>
              <FormInput
                id="casting-discount"
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
                {formatCurrency(Math.round(finalRupees * 100))}
              </span>
            </div>
            {isNegativeTotal && (
              <p className="text-xs text-error">
                Discount exceeds line item subtotal
              </p>
            )}
          </div>

          <div>
            <FormLabel>Bill (optional)</FormLabel>
            <div className="border border-outline-variant bg-surface-container-low p-3 space-y-2">
              {entry?.bill && !pickedFile && (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-on-surface truncate">
                    {entry.bill.originalFilename}
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    {formatBytes(entry.bill.sizeBytes)}
                  </span>
                </div>
              )}
              {pickedFile && (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-on-surface truncate">
                    {pickedFile.name} (new)
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    {formatBytes(pickedFile.size)}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_MIME_TYPES.join(",")}
                  onChange={onPickFile}
                  disabled={busy}
                  className="text-xs text-on-surface file:mr-3 file:py-1.5 file:px-3 file:border-0 file:bg-surface-container-high file:text-on-surface file:font-display file:uppercase file:tracking-wider file:text-xs hover:file:bg-surface-container-highest"
                />
                {entry?.bill && !pickedFile && (
                  <p className="text-xs text-on-surface-variant">
                    Selecting a new file will replace the current bill.
                  </p>
                )}
              </div>
              {filePickerError && (
                <p className="text-xs text-error">{filePickerError}</p>
              )}
              <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">
                <Upload className="inline size-3 mr-1" />
                Max {formatBytes(MAX_FILE_SIZE_BYTES)}. PDF, JPEG, PNG, WebP.
              </p>
            </div>
          </div>

          <div>
            <FormLabel htmlFor="casting-notes">Notes</FormLabel>
            <FormTextarea
              id="casting-notes"
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
              disabled={busy}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-w-[140px] h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>{busyLabel}…</span>
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
    vendorId: null,
    partyName: "",
    partyPhone: "",
    lineItems: [{ materialDescription: "", weightKg: 0, ratePerKg: 0 }],
    discount: 0,
    billId: null,
    notes: "",
  };
}

const FORM_FIELDS = [
  "date",
  "vendorId",
  "partyName",
  "partyPhone",
  "lineItems",
  "discount",
  "billId",
  "notes",
] as const;
type FormField = (typeof FORM_FIELDS)[number];
function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
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
