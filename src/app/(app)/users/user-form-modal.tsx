"use client";

// Phase 16 — Create / edit user modal.
//
// Two modes via the optional `user` prop:
//   - `user === undefined` → CREATE: name, email, password,
//     confirm-password, role.
//   - `user` present → EDIT: name, email, role (NO password fields —
//     password reset is a separate flow via ResetPasswordModal).
//
// Self-protection UX: when editing your own account, the role dropdown
// is disabled with a notice. Server still enforces (action layer
// rejects self-demote even if the dropdown is somehow re-enabled).

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
import {
  FormError,
  FormInput,
  FormLabel,
} from "@/components/form-controls";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

import { createUser, updateUser } from "./actions";
import { PasswordField } from "./password-field";
import {
  createUserInputSchema,
  updateUserInputSchema,
} from "./schema";
import type { UserForClient } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserForClient;
  currentUserId: string;
};

// Per-mode form schemas: the create mode adds a `confirmPassword`
// cross-field check on top of `createUserInputSchema`.
const createFormSchema = createUserInputSchema
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

type CreateFormInput = z.input<typeof createFormSchema>;
type CreateFormOutput = z.output<typeof createFormSchema>;
type EditFormInput = z.input<typeof updateUserInputSchema>;
type EditFormOutput = z.output<typeof updateUserInputSchema>;

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "PURCHASE_DEPT", label: "Purchases" },
  { value: "LABOUR_MGMT", label: "Labour" },
  { value: "CASTING_PLATING_MGMT", label: "Casting / Plating" },
] as const;

export function UserFormModal({
  open,
  onOpenChange,
  user,
  currentUserId,
}: Props) {
  const isEdit = user !== undefined;
  const isSelf = isEdit && user.id === currentUserId;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[520px] md:p-6"
        mobileClassName="p-4"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {isEdit ? "Edit user" : "Add user"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {isEdit ? (
          <EditForm
            user={user}
            isSelf={isSelf}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <CreateForm onClose={() => onOpenChange(false)} />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ---------- Create ----------

function CreateForm({ onClose }: { onClose: () => void }) {
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
  } = useForm<CreateFormInput, unknown, CreateFormOutput>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "PURCHASE_DEPT",
    },
  });

  // Reset every time the modal opens so a half-typed previous attempt
  // doesn't bleed across.
  useEffect(() => {
    reset({
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "PURCHASE_DEPT",
    });
    setFormError(null);
  }, [reset]);

  const watchedRole = watch("role");

  const onSubmit = async (data: CreateFormOutput) => {
    setFormError(null);
    const { confirmPassword: _ignored, ...createData } = data;
    void _ignored;
    const result = await createUser(createData);
    if (!result.ok) {
      const flat = result.errors;
      let surfaced = false;
      for (const key of Object.keys(flat) as Array<keyof typeof flat>) {
        const messages = flat[key];
        if (
          messages &&
          messages.length > 0 &&
          (key === "name" ||
            key === "email" ||
            key === "password" ||
            key === "role")
        ) {
          setError(key as keyof CreateFormInput, { message: messages[0] });
          surfaced = true;
        }
      }
      if (!surfaced) setFormError("Save failed. Please retry.");
      return;
    }
    onClose();
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError && (
        <div className="border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm">
          {formError}
        </div>
      )}

      <div>
        <FormLabel htmlFor="user-name" required>
          Name
        </FormLabel>
        <FormInput
          id="user-name"
          type="text"
          autoComplete="off"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name")}
        />
        <FormError>{errors.name?.message}</FormError>
      </div>

      <div>
        <FormLabel htmlFor="user-email" required>
          Email
        </FormLabel>
        <FormInput
          id="user-email"
          type="email"
          autoComplete="off"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        <FormError>{errors.email?.message}</FormError>
      </div>

      <div>
        <FormLabel htmlFor="user-password" required>
          Password
        </FormLabel>
        <PasswordField
          id="user-password"
          autoComplete="new-password"
          aria-invalid={!!errors.password}
          {...register("password")}
        />
        <p className="mt-1 text-xs text-on-surface-variant">
          Minimum {MIN_PASSWORD_LENGTH} characters. Click the eye icon to
          show/hide. Communicate this to the user directly — they are not
          notified by email.
        </p>
        <FormError>{errors.password?.message}</FormError>
      </div>

      <div>
        <FormLabel htmlFor="user-confirm-password" required>
          Confirm password
        </FormLabel>
        <PasswordField
          id="user-confirm-password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          {...register("confirmPassword")}
        />
        <FormError>{errors.confirmPassword?.message}</FormError>
      </div>

      <div>
        <FormLabel required>Role</FormLabel>
        <input type="hidden" {...register("role")} />
        <RoleSelector
          value={watchedRole}
          onChange={(v) => setValue("role", v)}
          disabled={false}
        />
        <FormError>{errors.role?.message}</FormError>
      </div>

      <Footer isSubmitting={isSubmitting} onClose={onClose} />
    </form>
  );
}

// ---------- Edit ----------

function EditForm({
  user,
  isSelf,
  onClose,
}: {
  user: UserForClient;
  isSelf: boolean;
  onClose: () => void;
}) {
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
  } = useForm<EditFormInput, unknown, EditFormOutput>({
    resolver: zodResolver(updateUserInputSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });

  useEffect(() => {
    reset({ name: user.name, email: user.email, role: user.role });
    setFormError(null);
  }, [reset, user.id, user.name, user.email, user.role]);

  const watchedRole = watch("role");

  const onSubmit = async (data: EditFormOutput) => {
    setFormError(null);
    const result = await updateUser(user.id, data);
    if (!result.ok) {
      // Union narrowing — `result.errors` may be zod field errors OR
      // a `{ id: [...] }` "user not found" payload. Read defensively.
      const flat = result.errors as Record<string, string[] | undefined>;
      let surfaced = false;
      for (const key of ["name", "email", "role"] as const) {
        const msg = flat[key]?.[0];
        if (msg) {
          setError(key as keyof EditFormInput, { message: msg });
          surfaced = true;
        }
      }
      if (!surfaced) {
        const generic = Object.values(flat).flat().filter(Boolean)[0];
        setFormError(generic ?? "Save failed. Please retry.");
      }
      return;
    }
    onClose();
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError && (
        <div className="border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm">
          {formError}
        </div>
      )}

      <div>
        <FormLabel htmlFor="user-name" required>
          Name
        </FormLabel>
        <FormInput
          id="user-name"
          type="text"
          autoComplete="off"
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name")}
        />
        <FormError>{errors.name?.message}</FormError>
      </div>

      <div>
        <FormLabel htmlFor="user-email" required>
          Email
        </FormLabel>
        <FormInput
          id="user-email"
          type="email"
          autoComplete="off"
          aria-invalid={!!errors.email}
          {...register("email")}
        />
        <FormError>{errors.email?.message}</FormError>
      </div>

      <div>
        <FormLabel required>Role</FormLabel>
        <input type="hidden" {...register("role")} />
        <RoleSelector
          value={watchedRole}
          onChange={(v) => setValue("role", v)}
          disabled={isSelf}
        />
        {isSelf && (
          <p
            className="mt-2 text-xs text-on-surface-variant"
            data-testid="self-role-notice"
          >
            You cannot change your own role. Ask another administrator to do
            it if needed.
          </p>
        )}
        <FormError>{errors.role?.message}</FormError>
      </div>

      <Footer isSubmitting={isSubmitting} onClose={onClose} />
    </form>
  );
}

// ---------- Shared bits ----------

function RoleSelector({
  value,
  onChange,
  disabled,
}: {
  value: CreateFormOutput["role"];
  onChange: (v: CreateFormOutput["role"]) => void;
  disabled: boolean;
}) {
  return (
    <div
      className="mt-1 grid grid-cols-2 gap-2"
      role="radiogroup"
      aria-label="Role"
    >
      {ROLE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            data-testid={`role-option-${opt.value}`}
            className={[
              "h-10 px-3 text-sm font-display uppercase tracking-wider border border-outline-variant transition-colors",
              active
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-high text-on-surface hover:bg-surface-container",
              disabled ? "opacity-50 cursor-not-allowed" : "",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Footer({
  isSubmitting,
  onClose,
}: {
  isSubmitting: boolean;
  onClose: () => void;
}) {
  return (
    <ResponsiveDialogFooter className="-mx-4 -mb-4 md:-mx-6 md:-mb-6 px-4 md:px-6 py-4">
      <button
        type="button"
        onClick={onClose}
        disabled={isSubmitting}
        className="h-11 md:h-10 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors w-full md:w-auto"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSubmitting}
        data-testid="user-form-save"
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
  );
}
