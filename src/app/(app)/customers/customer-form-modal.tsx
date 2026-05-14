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
import type { Customer } from "@/generated/prisma";

import { createCustomer, updateCustomer } from "./actions";
import { customerInputSchema } from "./schema";

// RHF stores form values pre-transform (strings flowing from <input>);
// the resolver runs the schema and hands handleSubmit the post-transform
// shape (`"" → null`). FormInput is what we register/reset against;
// FormOutput is what onSubmit receives.
type FormInputT = z.input<typeof customerInputSchema>;
type FormOutput = z.output<typeof customerInputSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer?: Customer;
};

export function CustomerFormModal({ open, onOpenChange, customer }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInputT, unknown, FormOutput>({
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
            <FormLabel htmlFor="customer-name" required>
              Name
            </FormLabel>
            <FormInput
              id="customer-name"
              type="text"
              autoComplete="off"
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FormError>{errors.name?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="customer-phone">Phone</FormLabel>
            <FormInput
              id="customer-phone"
              type="tel"
              autoComplete="off"
              aria-invalid={!!errors.phone}
              {...register("phone")}
            />
            <FormError>{errors.phone?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="customer-email">Email</FormLabel>
            <FormInput
              id="customer-email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            <FormError>{errors.email?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="customer-address">Address</FormLabel>
            <FormTextarea
              id="customer-address"
              rows={3}
              aria-invalid={!!errors.address}
              {...register("address")}
            />
            <FormError>{errors.address?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="customer-notes">Notes</FormLabel>
            <FormTextarea
              id="customer-notes"
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
  return { name: "", phone: "", email: "", address: "", notes: "" };
}

const FORM_FIELDS = ["name", "phone", "email", "address", "notes"] as const;
type FormField = (typeof FORM_FIELDS)[number];
function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}
