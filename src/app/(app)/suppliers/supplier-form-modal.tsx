"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { type z } from "zod";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import {
  FormError,
  FormInput,
  FormLabel,
  FormTextarea,
} from "@/components/form-controls";
import type { Supplier } from "@/generated/prisma";

import { createSupplier, updateSupplier } from "./actions";
import { supplierInputSchema } from "./schema";

// RHF stores form values pre-transform (strings flowing from <input>);
// the resolver runs the schema and hands handleSubmit the post-transform
// shape (`"" → null`). FormInput is what we register/reset against;
// FormOutput is what onSubmit receives.
type FormInputT = z.input<typeof supplierInputSchema>;
type FormOutput = z.output<typeof supplierInputSchema>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier;
};

export function SupplierFormModal({ open, onOpenChange, supplier }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(supplierInputSchema),
    defaultValues: emptyDefaults(),
  });

  // Re-seed the form whenever the modal opens or the edit target changes.
  useEffect(() => {
    if (open) {
      reset({
        name: supplier?.name ?? "",
        phone: supplier?.phone ?? "",
        email: supplier?.email ?? "",
        address: supplier?.address ?? "",
        notes: supplier?.notes ?? "",
      });
      setFormError(null);
    }
  }, [open, supplier, reset]);

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    const result = supplier
      ? await updateSupplier(supplier.id, data)
      : await createSupplier(data);

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

  const title = supplier ? "Edit supplier" : "Add supplier";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[500px] md:p-6"
        mobileClassName="p-4"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {formError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm">
              {formError}
            </div>
          )}

          <div>
            <FormLabel htmlFor="supplier-name" required>
              Name
            </FormLabel>
            <FormInput
              id="supplier-name"
              type="text"
              autoComplete="off"
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FormError>{errors.name?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="supplier-phone">Phone</FormLabel>
            <FormInput
              id="supplier-phone"
              type="tel"
              autoComplete="off"
              aria-invalid={!!errors.phone}
              {...register("phone")}
            />
            <FormError>{errors.phone?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="supplier-email">Email</FormLabel>
            <FormInput
              id="supplier-email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            <FormError>{errors.email?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="supplier-address">Address</FormLabel>
            <FormTextarea
              id="supplier-address"
              rows={3}
              aria-invalid={!!errors.address}
              {...register("address")}
            />
            <FormError>{errors.address?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="supplier-notes">Notes</FormLabel>
            <FormTextarea
              id="supplier-notes"
              rows={3}
              aria-invalid={!!errors.notes}
              {...register("notes")}
            />
            <FormError>{errors.notes?.message}</FormError>
          </div>

          <ResponsiveDialogFooter className="-mx-4 -mb-4 md:-mx-6 md:-mb-6 px-4 md:px-6 py-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="h-11 md:h-10 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors w-full md:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-w-[120px] h-11 md:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
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
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
