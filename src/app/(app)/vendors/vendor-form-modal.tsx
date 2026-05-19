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
import type { Party as CastingPlatingVendor } from "@/generated/prisma";

import { createVendor, updateVendor } from "./actions";
import { vendorInputSchema } from "./schema";

type FormInputT = z.input<typeof vendorInputSchema>;
type FormOutput = z.output<typeof vendorInputSchema>;

// Form props accept either the Prisma row OR the serialised client shape
// (VendorForClient is a strict superset with extra aggregate fields).
// Both have the same name/phone/address/notes shape that the form uses.
type VendorLike = Pick<
  CastingPlatingVendor,
  "id" | "name" | "phone" | "address" | "notes"
>;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: VendorLike;
};

export function VendorFormModal({ open, onOpenChange, vendor }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(vendorInputSchema),
    defaultValues: emptyDefaults(),
  });

  useEffect(() => {
    if (open) {
      reset({
        name: vendor?.name ?? "",
        phone: vendor?.phone ?? "",
        address: vendor?.address ?? "",
        notes: vendor?.notes ?? "",
      });
      setFormError(null);
    }
  }, [open, vendor, reset]);

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);

    const result = vendor
      ? await updateVendor(vendor.id, data)
      : await createVendor(data);

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

  const title = vendor ? "Edit vendor" : "Add vendor";

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
            <FormLabel htmlFor="vendor-name" required>
              Name
            </FormLabel>
            <FormInput
              id="vendor-name"
              type="text"
              autoComplete="off"
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FormError>{errors.name?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="vendor-phone">Phone</FormLabel>
            <FormInput
              id="vendor-phone"
              type="tel"
              autoComplete="off"
              aria-invalid={!!errors.phone}
              {...register("phone")}
            />
            <FormError>{errors.phone?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="vendor-address">Address</FormLabel>
            <FormTextarea
              id="vendor-address"
              rows={3}
              aria-invalid={!!errors.address}
              {...register("address")}
            />
            <FormError>{errors.address?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="vendor-notes">Notes</FormLabel>
            <FormTextarea
              id="vendor-notes"
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
  return { name: "", phone: "", address: "", notes: "" };
}

const FORM_FIELDS = ["name", "phone", "address", "notes"] as const;
type FormField = (typeof FORM_FIELDS)[number];
function isFormField(key: string): key is FormField {
  return (FORM_FIELDS as readonly string[]).includes(key);
}
