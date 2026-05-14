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
import type { Customer } from "@/generated/prisma";

import { createCustomer, updateCustomer } from "./actions";
import { customerInputSchema } from "./schema";

// RHF stores form values pre-transform (strings flowing from <input>);
// the resolver runs the schema and hands handleSubmit the post-transform
// shape (`"" → null`). FormInput is what we register/reset against;
// FormOutput is what onSubmit receives.
type FormInput = z.input<typeof customerInputSchema>;
type FormOutput = z.output<typeof customerInputSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer;
};

const FIELD_LABEL =
  "block font-display text-xs uppercase tracking-wider text-on-surface-variant";
const FIELD_INPUT =
  "w-full bg-transparent border-0 border-b border-outline-variant focus:border-secondary focus:outline-none py-2 text-on-surface placeholder:text-on-surface-variant/40 transition-colors";
const FIELD_TEXTAREA =
  "w-full bg-transparent border border-outline-variant focus:border-secondary focus:outline-none p-3 text-on-surface placeholder:text-on-surface-variant/40 transition-colors resize-none";
const FIELD_ERROR = "text-error text-xs mt-1";

export function CustomerFormModal({ open, onOpenChange, customer }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(customerInputSchema),
    defaultValues: emptyDefaults(),
  });

  // Re-seed the form whenever the modal opens or the edit target changes.
  useEffect(() => {
    if (open) {
      reset({
        name: customer?.name ?? "",
        phone: customer?.phone ?? "",
        email: customer?.email ?? "",
        address: customer?.address ?? "",
        notes: customer?.notes ?? "",
      });
      setFormError(null);
    }
  }, [open, customer, reset]);

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    const result = customer
      ? await updateCustomer(customer.id, data)
      : await createCustomer(data);

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

  const title = customer ? "Edit customer" : "Add customer";

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
            <label htmlFor="customer-name" className={FIELD_LABEL}>
              Name <span className="text-error" aria-hidden>*</span>
            </label>
            <input
              id="customer-name"
              type="text"
              autoComplete="off"
              autoFocus
              {...register("name")}
              aria-invalid={!!errors.name}
              className={FIELD_INPUT}
            />
            {errors.name && (
              <p className={FIELD_ERROR}>{errors.name.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="customer-phone" className={FIELD_LABEL}>
              Phone
            </label>
            <input
              id="customer-phone"
              type="tel"
              autoComplete="off"
              {...register("phone")}
              aria-invalid={!!errors.phone}
              className={FIELD_INPUT}
            />
            {errors.phone && (
              <p className={FIELD_ERROR}>{errors.phone.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="customer-email" className={FIELD_LABEL}>
              Email
            </label>
            <input
              id="customer-email"
              type="email"
              autoComplete="off"
              {...register("email")}
              aria-invalid={!!errors.email}
              className={FIELD_INPUT}
            />
            {errors.email && (
              <p className={FIELD_ERROR}>{errors.email.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="customer-address" className={FIELD_LABEL}>
              Address
            </label>
            <textarea
              id="customer-address"
              rows={3}
              {...register("address")}
              aria-invalid={!!errors.address}
              className={FIELD_TEXTAREA}
            />
            {errors.address && (
              <p className={FIELD_ERROR}>{errors.address.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="customer-notes" className={FIELD_LABEL}>
              Notes
            </label>
            <textarea
              id="customer-notes"
              rows={3}
              {...register("notes")}
              aria-invalid={!!errors.notes}
              className={FIELD_TEXTAREA}
            />
            {errors.notes && (
              <p className={FIELD_ERROR}>{errors.notes.message}</p>
            )}
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

function emptyDefaults(): FormInput {
  return { name: "", phone: "", email: "", address: "", notes: "" };
}

const FORM_FIELDS = ["name", "phone", "email", "address", "notes"] as const;
type FormField = (typeof FORM_FIELDS)[number];
function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}
