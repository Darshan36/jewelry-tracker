"use client";

// Shared inline return modal — opens from the Actions column on Sale
// or Purchase rows (Casting/Plating have no returns workflow per
// Phase 9 lineage).
//
// Phase 10.5: refactored to prop-injection. Caller passes `onSave`
// closing over the entity id and the right server action; the modal
// is entity-agnostic. `entityType` stays for any future UI-side
// label-direction logic.

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

export type ReturnEntityType = "sale" | "purchase";

const returnFormSchema = z.object({
  date: z.coerce.date({ message: "Date is required" }),
  qtyReturned: z
    .number()
    .int("Qty must be a whole number")
    .positive("Qty must be greater than zero"),
  refundAmount: z.number().nonnegative("Refund cannot be negative"),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
});

type FormInputT = z.input<typeof returnFormSchema>;
type FormOutput = z.output<typeof returnFormSchema>;

export type ReturnSaveResult =
  | { ok: true }
  | {
      ok: false;
      errors: Partial<
        Record<
          "qtyReturned" | "refundAmount" | "date" | "note" | string,
          string[]
        >
      >;
    };

export type ReturnSaveData = {
  date: Date;
  qtyReturned: number;
  refundAmount: number; // rupees
  note: string | null;
};

type Props = {
  entityType: ReturnEntityType;
  entityId: string;
  open: boolean;
  onClose: () => void;
  /** Entity-specific server-action wrapper. */
  onSave: (data: ReturnSaveData) => Promise<ReturnSaveResult>;
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function emptyDefaults(): FormInputT {
  return {
    date: todayISO() as unknown as Date,
    qtyReturned: 1,
    refundAmount: 0,
    note: "",
  };
}

export function ReturnActionModal({
  entityType: _entityType,
  entityId: _entityId,
  open,
  onClose,
  onSave,
}: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(returnFormSchema),
    defaultValues: emptyDefaults(),
  });

  useEffect(() => {
    if (open) {
      reset(emptyDefaults());
      setFormError(null);
    }
  }, [open, reset]);

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    const result = await onSave({
      date: data.date,
      qtyReturned: data.qtyReturned,
      refundAmount: data.refundAmount,
      note: data.note,
    });

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
          }
        }
      }
      if (!surfaced) setFormError("Save failed. Please retry.");
      return;
    }

    onClose();
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-[500px] bg-surface-container border border-outline-variant p-6 gap-0">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-lg font-semibold tracking-tight text-on-surface">
            Record return
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {formError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-3 py-2 text-sm">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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
                Qty returned
              </FormLabel>
              <FormInput
                id="return-qty"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                className="tabular-nums"
                aria-invalid={!!errors.qtyReturned}
                {...register("qtyReturned", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined ? 0 : Number(v),
                })}
              />
              <FormError>{errors.qtyReturned?.message}</FormError>
            </div>
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
              className="tabular-nums"
              aria-invalid={!!errors.refundAmount}
              {...register("refundAmount", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined ? 0 : Number(v),
              })}
            />
            <FormError>{errors.refundAmount?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="return-note">Note (optional)</FormLabel>
            <FormTextarea id="return-note" rows={2} {...register("note")} />
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
