"use client";

// Standalone plating-entry form — Phase 10.6 mirror of sale-form.tsx
// (Phase 10/10.5) with plating-specific adaptations:
//   - Line items use weightKg (Decimal, step="0.001") + ratePerKg
//     instead of qty (Int) + rate.
//   - Live preview math uses Math.round(weight × rate × 100) instead of
//     qty × rate × 100 because weight can be fractional.
//   - Vendor picker (VendorOption) instead of customer picker.
//   - Attachment attachment uses FK-based attach AFTER confirmUpload:
//       prepareUpload → R2 PUT → confirmUpload → attachAttachmentToPlatingEntry
//     Sales uses discriminator-only and skips the attach step.
//
// Renders without a Dialog wrapper for use inside dedicated form pages
// at /plating/new and /plating/[id]/edit.

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
import { AttachmentPreview } from "@/components/attachment-preview";
import {
  dateToIsoIST,
  formatCurrency,
  todayIsoIST,
} from "@/lib/format";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
} from "@/app/(app)/attachments/schema";
import {
  confirmUpload,
  prepareUpload,
} from "@/app/(app)/attachments/actions";

import {
  attachAttachmentToPlatingEntry,
  createPlatingEntry,
  updatePlatingEntry,
} from "./actions";
import { PartyPicker, type PartyOption } from "@/components/party-picker";
import { platingEntryInputSchema } from "./schema";
import type { PlatingEntryForClient } from "./plating-helpers";

type FormInputT = z.input<typeof platingEntryInputSchema>;
type FormOutput = z.output<typeof platingEntryInputSchema>;

type Props = {
  mode: "create" | "edit";
  entry?: PlatingEntryForClient;
  parties: PartyOption[];
};

// Date helpers pin to Asia/Kolkata via shared format helpers — without
// the explicit timezone, server (UTC) and client (IST) produced different
// "today" strings near UTC midnight, tripping React hydration warnings.

function emptyDefaults(): FormInputT {
  return {
    date: todayIsoIST() as unknown as Date,
    partyId: null,
    partyName: "",
    partyPhone: "",
    lineItems: [{ materialDescription: "", weightKg: 0, ratePerKg: 0 }],
    discount: 0,
    attachmentId: null,
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

export function PlatingForm({ mode, entry, parties }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const saveModeRef = useRef<SaveMode>("return");
  const [pickedBillFile, setPickedBillFile] = useState<File | null>(null);
  const [billPickerError, setBillPickerError] = useState<string | null>(null);
  const [billUploadStatus, setBillUploadStatus] = useState<
    "idle" | "preparing" | "uploading" | "confirming" | "attaching"
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
    resolver: zodResolver(platingEntryInputSchema),
    defaultValues: emptyDefaults(),
  });

  const { fields, append, remove } = useFieldArray({
    control,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name: "lineItems" as any,
  });

  useEffect(() => {
    reset({
      date: dateToIsoIST(entry?.date) as unknown as Date,
      partyId: entry?.partyId ?? null,
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
      attachmentId: entry?.attachmentId ?? null,
      notes: entry?.notes ?? "",
    });
  }, [entry, reset]);

  const watchedLineItems = watch("lineItems") ?? [];
  const watchedDiscount = watch("discount");
  const watchedPartyId = watch("partyId");
  const watchedPartyName = watch("partyName");
  const watchedPartyPhone = watch("partyPhone");

  const subtotal = watchedLineItems.reduce((sum, li) => {
    const w = Number(li?.weightKg ?? 0);
    const r = Number(li?.ratePerKg ?? 0);
    if (!Number.isFinite(w) || !Number.isFinite(r)) return sum;
    return sum + Math.max(0, w) * Math.max(0, r);
  }, 0);
  const discountNum = Number(watchedDiscount ?? 0);
  const finalTotal =
    subtotal -
    (Number.isFinite(discountNum) ? Math.max(0, discountNum) : 0);
  const isNegativeTotal = finalTotal < 0;

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    // Stage 1: save the entry. If a new bill is picked, we exclude
    // attachmentId from the initial save — the bill row doesn't exist yet.
    // The FK gets attached after upload via attachAttachmentToPlatingEntry.
    const dataForSave = pickedBillFile ? { ...data, attachmentId: null } : data;

    const result =
      mode === "edit" && entry
        ? await updatePlatingEntry(entry.id, dataForSave)
        : await createPlatingEntry(dataForSave);

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

    // Stage 2: if a bill was picked, run the upload chain with FK
    // attach at the end. On failure, leave the entry saved and surface
    // a banner — the user can retry via the row-level 📎 modal.
    const savedEntryId = result.entry.id;
    if (pickedBillFile) {
      try {
        setBillUploadStatus("preparing");
        const prep = await prepareUpload({
          originalFilename: pickedBillFile.name,
          mimeType: pickedBillFile.type as AllowedMimeType,
          sizeBytes: pickedBillFile.size,
          attachedToType: "PLATING_ENTRY",
          attachedToId: savedEntryId,
        });
        if (!prep.ok) {
          const first = Object.values(prep.errors).flat().find(Boolean);
          throw new Error(first ?? "Bill preparation failed");
        }
        setBillUploadStatus("uploading");
        await putToR2(prep.presignedUrl, pickedBillFile);
        setBillUploadStatus("confirming");
        const conf = await confirmUpload({ attachmentId: prep.attachmentId });
        if (!conf.ok) {
          const first = Object.values(conf.errors).flat().find(Boolean);
          throw new Error(first ?? "Bill confirmation failed");
        }
        setBillUploadStatus("attaching");
        const attach = await attachAttachmentToPlatingEntry(savedEntryId, prep.attachmentId);
        if (!attach.ok) throw new Error("Failed to attach bill");
        setBillUploadStatus("idle");
      } catch (err) {
        setBillUploadStatus("idle");
        setFormError(
          `Plating entry saved, but bill upload failed: ${
            err instanceof Error ? err.message : String(err)
          }. Use the 📎 button in the plating list to retry.`,
        );
        router.refresh();
        return;
      }
    }

    if (saveModeRef.current === "return") {
      router.push("/plating");
      router.refresh();
    } else {
      reset(emptyDefaults());
      setPickedBillFile(null);
      setBillPickerError(null);
      if (billInputRef.current) billInputRef.current.value = "";
      router.refresh();
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
          : billUploadStatus === "attaching"
            ? "Attaching bill"
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
        <FormLabel htmlFor="plating-date" required>
          Date
        </FormLabel>
        <FormInput
          id="plating-date"
          type="date"
          aria-invalid={!!errors.date}
          {...register("date")}
        />
        <FormError>
          {errors.date?.message ? String(errors.date.message) : null}
        </FormError>
      </div>

      <input type="hidden" {...register("partyId")} />
      <input type="hidden" {...register("partyName")} />
      <input type="hidden" {...register("partyPhone")} />
      <input type="hidden" {...register("attachmentId")} />

      <PartyPicker
        role="PLATING_VENDOR"
        inputIdPrefix="plating"
        parties={parties}
        value={{
          partyId: (watchedPartyId as string | null) ?? null,
          partyName: (watchedPartyName as string | undefined) ?? "",
          partyPhone:
            (watchedPartyPhone as string | null | undefined) ?? null,
        }}
        onChange={(v) => {
          setValue("partyId", v.partyId);
          setValue("partyName", v.partyName, { shouldValidate: true });
          setValue("partyPhone", v.partyPhone);
        }}
        error={errors.partyName?.message ?? errors.partyId?.message}
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
          {/* Column-header row only on md+. */}
          <div className="hidden md:grid md:grid-cols-[1fr_110px_130px_130px_40px] gap-2 px-3 py-2 bg-surface-container-high text-xs uppercase tracking-wider font-display text-on-surface-variant">
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
                className="grid grid-cols-1 md:grid-cols-[1fr_110px_130px_130px_40px] gap-2 px-3 py-3 md:py-2 items-start"
              >
                <div>
                  <FormInput
                    id={`plating-line-${idx}-material`}
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
                {/* Mobile sub-grid (weight | rate | ×); md:contents flattens
                    its children into outer cols 2/3/4/5. */}
                <div className="grid grid-cols-[1fr_1fr_44px] gap-2 md:contents">
                  <div>
                    <FormInput
                      id={`plating-line-${idx}-weight`}
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="Weight kg"
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
                      id={`plating-line-${idx}-rate`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="₹/kg"
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
                  {/* Desktop-only line total (col 4 via md:contents). */}
                  <div className="hidden md:flex md:h-10 md:items-center md:justify-end md:pr-1 text-on-surface tabular-nums font-mono text-sm">
                    {formatCurrency(lineTotalPaise)}
                  </div>
                  {/* Remove button — mobile sub-col 3, desktop col 5. */}
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
                {/* Mobile-only line total row 3. */}
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
          {mode === "edit" && entry && (
            <p className="text-xs text-on-surface-variant italic">
              To replace or remove an existing bill on this plating entry,
              use the 📎 button on the plating list row. Picking a file
              here adds a new bill alongside.
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
              <AttachmentPreview file={pickedBillFile} />
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
            {formatCurrency(Math.round(subtotal * 100))}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_120px] md:grid-cols-[1fr_140px] gap-3 items-center">
          <FormLabel
            htmlFor="plating-discount"
            className="!mb-0 text-sm normal-case tracking-normal text-on-surface-variant"
          >
            Discount (₹)
          </FormLabel>
          <FormInput
            id="plating-discount"
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
            {formatCurrency(Math.round(finalTotal * 100))}
          </span>
        </div>
        {isNegativeTotal && (
          <p className="text-xs text-error">
            Discount exceeds line item subtotal
          </p>
        )}
      </div>

      <div>
        <FormLabel htmlFor="plating-notes">Notes</FormLabel>
        <FormTextarea
          id="plating-notes"
          rows={2}
          aria-invalid={!!errors.notes}
          {...register("notes")}
        />
        <FormError>{errors.notes?.message}</FormError>
      </div>

      {/* Form footer — sticky-bottom on mobile, right-aligned row on md+. */}
      <div
        className="flex flex-col-reverse gap-3 pt-4 border-t border-outline-variant
          sticky bottom-0 z-10 -mx-4 px-4 pb-4 bg-surface
          md:static md:flex-row md:items-center md:justify-end md:mx-0 md:px-0 md:pb-0 md:bg-transparent"
      >
        <button
          type="button"
          onClick={() => router.push("/plating")}
          disabled={isSubmitting}
          className="h-11 md:h-10 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors w-full md:w-auto"
        >
          Cancel
        </button>
        <SaveDropdown
          saving={isSubmitting || billBusy}
          primaryLabel={billBusy ? billBusyLabel : "Save and return"}
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
  "partyId",
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
