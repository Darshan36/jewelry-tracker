// Phase 20 — zod schema for ShopSettings upsert.
//
// `shopName` is the only required field — it anchors the bill header.
// Phone / address / footer are optional; empty-string inputs normalize
// to null so the rendered bill can branch on falsy values rather than
// distinguishing "empty string" vs "null".

import { z } from "zod";

const emptyToNull = (v: string | null | undefined) =>
  v === undefined || v === null || v.trim() === "" ? null : v.trim();

export const shopSettingsInputSchema = z.object({
  shopName: z.string().trim().min(1, "Shop name is required").max(200),
  phone: z
    .string()
    .trim()
    .max(50, "Phone too long")
    .nullish()
    .transform(emptyToNull),
  address: z
    .string()
    .trim()
    .max(500, "Address too long")
    .nullish()
    .transform(emptyToNull),
  footer: z
    .string()
    .trim()
    .max(200, "Footer too long")
    .nullish()
    .transform(emptyToNull),
});

export type ShopSettingsInput = z.input<typeof shopSettingsInputSchema>;
export type ShopSettingsParsed = z.output<typeof shopSettingsInputSchema>;
