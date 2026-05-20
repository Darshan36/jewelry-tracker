"use client";

// Phase 16 — Admin-initiated password reset modal.
//
// Independent of the edit form because:
//   - Different field shape (just password + confirm; no name/email/role)
//   - Different mental model (a separate "I'm setting a new password"
//     action vs. "I'm editing this user's profile")
//   - Reset can be invoked even on a deactivated user (in case the
//     admin wants to set a password before reactivating)
//
// The new password is bcrypt-hashed by the server action; this
// component never persists or transmits plaintext beyond the single
// network call.

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { FormError, FormLabel } from "@/components/form-controls";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

import { resetUserPassword } from "./actions";
import { PasswordField } from "./password-field";
import { resetPasswordInputSchema } from "./schema";
import type { UserForClient } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserForClient | null;
};

const formSchema = resetPasswordInputSchema
  .extend({
    confirmPassword: z.string().min(1, "Please confirm the password"),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match",
      });
    }
  });

type FormInputT = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function ResetPasswordModal({ open, onOpenChange, user }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<FormInputT, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (open) {
      reset({ password: "", confirmPassword: "" });
      setFormError(null);
    }
  }, [open, reset]);

  if (!user) return null;

  const onSubmit = async (data: FormOutput) => {
    setFormError(null);
    const result = await resetUserPassword(user.id, {
      password: data.password,
    });
    if (!result.ok) {
      // `result.errors` is a union (zod field errors OR `{ id: [...] }`
      // from "user not found"). Read defensively via Record-style index.
      const flat = result.errors as Record<string, string[] | undefined>;
      const passwordMsg = flat.password?.[0];
      if (passwordMsg) {
        setError("password", { message: passwordMsg });
      } else {
        const generic = Object.values(flat).flat().filter(Boolean)[0];
        setFormError(generic ?? "Reset failed. Please retry.");
      }
      return;
    }
    onOpenChange(false);
    router.refresh();
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[440px] md:p-6"
        mobileClassName="p-4"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            Reset password — {user.name}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-5"
          noValidate
        >
          {formError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm">
              {formError}
            </div>
          )}

          <div className="text-xs text-on-surface-variant border-l-2 border-secondary px-3 py-2 bg-surface-container-high">
            Communicate the new password to the user directly. They are not
            notified automatically.
          </div>

          <div>
            <FormLabel htmlFor="reset-password" required>
              New password
            </FormLabel>
            <PasswordField
              id="reset-password"
              autoComplete="new-password"
              autoFocus
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <p className="mt-1 text-xs text-on-surface-variant">
              Minimum {MIN_PASSWORD_LENGTH} characters. Click the eye icon to
              show/hide.
            </p>
            <FormError>{errors.password?.message}</FormError>
          </div>

          <div>
            <FormLabel htmlFor="reset-confirm-password" required>
              Confirm new password
            </FormLabel>
            <PasswordField
              id="reset-confirm-password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              {...register("confirmPassword")}
            />
            <FormError>{errors.confirmPassword?.message}</FormError>
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
              data-testid="reset-password-save"
              className="min-w-[120px] h-11 md:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                "Reset password"
              )}
            </button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
