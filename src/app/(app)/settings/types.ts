// Phase 20 — client-safe shape for ShopSettings.
//
// `updatedAt` ships as a Date instance across the action boundary;
// React Flight handles Date natively (unlike BigInt), so no
// serialization needed. `updatedById` stays as-is.

import type { ShopSettings } from "@/generated/prisma";

export type ShopSettingsForClient = ShopSettings;
