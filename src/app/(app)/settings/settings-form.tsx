"use client";

// Phase 20 — Shop settings form.
//
// Pre-fills with existing settings if present; renders empty inputs
// otherwise (first-time configuration). On save, calls
// `upsertShopSettings` which handles create-or-update. Success
// surface is an inline banner that persists until the user
// navigates away or edits again — explicit feedback that "you saved
// the config that the printable bill uses".

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import {
  FormError,
  FormInput,
  FormLabel,
  FormTextarea,
} from "@/components/form-controls";

import { upsertShopSettings } from "./actions";
import {
  shopSettingsInputSchema,
  type ShopSettingsInput,
  type ShopSettingsParsed,
} from "./schema";
import type { ShopSettingsForClient } from "./types";

type Props = {
  initialSettings: ShopSettingsForClient | null;
};

export function SettingsForm({ initialSettings }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setError,
  } = useForm<ShopSettingsInput, unknown, ShopSettingsParsed>({
    resolver: zodResolver(shopSettingsInputSchema),
    defaultValues: {
      shopName: initialSettings?.shopName ?? "",
      phone: initialSettings?.phone ?? "",
      address: initialSettings?.address ?? "",
      footer: initialSettings?.footer ?? "",
    },
  });

  useEffect(() => {
    reset({
      shopName: initialSettings?.shopName ?? "",
      phone: initialSettings?.phone ?? "",
      address: initialSettings?.address ?? "",
      footer: initialSettings?.footer ?? "",
    });
  }, [initialSettings, reset]);

  const onSubmit = async (data: ShopSettingsParsed) => {
    setFormError(null);
    setSavedAt(null);

    const result = await upsertShopSettings(data);
    if (!result.ok) {
      const flat = result.errors as Record<string, string[] | undefined>;
      let surfaced = false;
      for (const key of ["shopName", "phone", "address", "footer"] as const) {
        const msg = flat[key]?.[0];
        if (msg) {
          setError(key, { message: msg });
          surfaced = true;
        }
      }
      if (!surfaced) {
        const generic = Object.values(flat).flat().filter(Boolean)[0];
        setFormError(generic ?? "Save failed. Please retry.");
      }
      return;
    }

    setSavedAt(new Date());
    router.refresh();
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-2xl space-y-5"
      noValidate
    >
      {formError && (
        <div className="border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm">
          {formError}
        </div>
      )}
      {savedAt && (
        <div
          className="border-l-2 border-[#5e8c4f] bg-[#5e8c4f]/10 text-[#5e8c4f] px-4 py-3 text-sm"
          data-testid="settings-saved-banner"
        >
          Settings saved. The bill header reflects the new values
          immediately.
        </div>
      )}

      <div>
        <FormLabel htmlFor="settings-shop-name" required>
          Shop name
        </FormLabel>
        <FormInput
          id="settings-shop-name"
          type="text"
          autoComplete="off"
          aria-invalid={!!errors.shopName}
          {...register("shopName")}
        />
        <p className="mt-1 text-xs text-on-surface-variant">
          Appears as the largest heading on every printed bill.
        </p>
        <FormError>{errors.shopName?.message}</FormError>
      </div>

      <div>
        <FormLabel htmlFor="settings-phone">Phone</FormLabel>
        <FormInput
          id="settings-phone"
          type="tel"
          autoComplete="off"
          aria-invalid={!!errors.phone}
          {...register("phone")}
        />
        <FormError>{errors.phone?.message}</FormError>
      </div>

      <div>
        <FormLabel htmlFor="settings-address">Address</FormLabel>
        <FormTextarea
          id="settings-address"
          rows={3}
          aria-invalid={!!errors.address}
          {...register("address")}
        />
        <p className="mt-1 text-xs text-on-surface-variant">
          Multi-line address renders verbatim under the shop name.
        </p>
        <FormError>{errors.address?.message}</FormError>
      </div>

      <div>
        <FormLabel htmlFor="settings-footer">Footer line</FormLabel>
        <FormInput
          id="settings-footer"
          type="text"
          autoComplete="off"
          aria-invalid={!!errors.footer}
          {...register("footer")}
        />
        <p className="mt-1 text-xs text-on-surface-variant">
          A short tagline printed at the bottom of every bill — e.g.
          &ldquo;Thank you for your purchase.&rdquo;
        </p>
        <FormError>{errors.footer?.message}</FormError>
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          data-testid="settings-save"
          className="min-w-[160px] h-11 md:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              <span>Saving…</span>
            </>
          ) : initialSettings ? (
            "Save changes"
          ) : (
            "Save settings"
          )}
        </button>
      </div>
    </form>
  );
}
