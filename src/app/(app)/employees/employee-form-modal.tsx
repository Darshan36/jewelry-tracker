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

import { createEmployee, updateEmployee } from "./actions";
import { employeeInputSchema } from "./schema";
import type { EmployeeForClient } from "./types";

type FormInputT = z.input<typeof employeeInputSchema>;
type FormOutput = z.output<typeof employeeInputSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: EmployeeForClient;
};

export function EmployeeFormModal({ open, onOpenChange, employee }: Props) {
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
    resolver: zodResolver(employeeInputSchema),
    defaultValues: emptyDefaults(),
  });

  const watchedType = watch("type");

  // Re-seed the form whenever the modal opens or the edit target changes.
  // Convert paise (server-side number) to rupees for the input.
  useEffect(() => {
    if (open) {
      const salaryRupees =
        employee?.monthlySalary === null || employee?.monthlySalary === undefined
          ? null
          : employee.monthlySalary / 100;
      reset({
        name: employee?.name ?? "",
        phone: employee?.phone ?? "",
        type: employee?.type ?? "LABOUR",
        monthlySalary: salaryRupees,
        address: employee?.address ?? "",
        notes: employee?.notes ?? "",
      });
      setFormError(null);
    }
  }, [open, employee, reset]);

  // When type flips to LABOUR, clear any stale salary value so the
  // hidden field's value can't sneak through and trigger superRefine errors.
  useEffect(() => {
    if (watchedType === "LABOUR") {
      setValue("monthlySalary", null);
    }
  }, [watchedType, setValue]);

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    const result = employee
      ? await updateEmployee(employee.id, data)
      : await createEmployee(data);

    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat) as Array<keyof typeof flat>) {
        const messages = flat[key];
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

  const title = employee ? "Edit employee" : "Add employee";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[500px] bg-surface-container border border-outline-variant p-6 gap-0">
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
            <FormLabel htmlFor="employee-name" required>
              Name
            </FormLabel>
            <FormInput
              id="employee-name"
              type="text"
              autoComplete="off"
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FormError>{errors.name?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="employee-phone">Phone</FormLabel>
            <FormInput
              id="employee-phone"
              type="tel"
              autoComplete="off"
              aria-invalid={!!errors.phone}
              {...register("phone")}
            />
            <FormError>{errors.phone?.message}</FormError>
          </div>

          {/* Type — two-button segmented selector */}
          <div>
            <FormLabel>
              Type <span className="text-error ml-1" aria-hidden>*</span>
            </FormLabel>
            {/* RHF tracks the value via a hidden input registered with type */}
            <input type="hidden" {...register("type")} />
            <div
              className="flex border border-outline-variant mt-1"
              role="radiogroup"
              aria-label="Employee type"
            >
              <button
                type="button"
                role="radio"
                aria-checked={watchedType === "FIXED"}
                onClick={() => setValue("type", "FIXED")}
                className={`flex-1 py-2 text-sm font-display uppercase tracking-wider transition-colors ${
                  watchedType === "FIXED"
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface hover:bg-surface-container"
                }`}
              >
                Fixed
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={watchedType === "LABOUR"}
                onClick={() => setValue("type", "LABOUR")}
                className={`flex-1 py-2 text-sm font-display uppercase tracking-wider transition-colors border-l border-outline-variant ${
                  watchedType === "LABOUR"
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface hover:bg-surface-container"
                }`}
              >
                Labour
              </button>
            </div>
            <FormError>{errors.type?.message}</FormError>
          </div>

          {/* Monthly salary — only shown for FIXED. Hidden for LABOUR. */}
          {watchedType === "FIXED" && (
            <div>
              <FormLabel htmlFor="employee-salary">
                Monthly salary (₹)
              </FormLabel>
              <FormInput
                id="employee-salary"
                type="number"
                inputMode="numeric"
                step="1"
                min="1"
                autoComplete="off"
                aria-invalid={!!errors.monthlySalary}
                {...register("monthlySalary", {
                  setValueAs: (v) =>
                    v === "" || v === null || v === undefined
                      ? null
                      : Number(v),
                })}
              />
              <FormError>{errors.monthlySalary?.message}</FormError>
            </div>
          )}

          <div>
            <FormLabel htmlFor="employee-address">Address</FormLabel>
            <FormTextarea
              id="employee-address"
              rows={3}
              aria-invalid={!!errors.address}
              {...register("address")}
            />
            <FormError>{errors.address?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="employee-notes">Notes</FormLabel>
            <FormTextarea
              id="employee-notes"
              rows={3}
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
    name: "",
    phone: "",
    type: "LABOUR",
    monthlySalary: null,
    address: "",
    notes: "",
  };
}

const FORM_FIELDS = [
  "name",
  "phone",
  "type",
  "monthlySalary",
  "address",
  "notes",
] as const;
type FormField = (typeof FORM_FIELDS)[number];
function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}
