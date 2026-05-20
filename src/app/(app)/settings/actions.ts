"use server";

// Phase 20 — ShopSettings actions.
//
// Single-row semantics: enforced at the application layer via
// `findFirst` + conditional create-or-update. Postgres has no
// native "exactly one row" constraint that's both ergonomic and
// race-free, and adding a `singleton: 'shop'` unique column would
// clutter the schema for a single-row table. The `findFirst`
// pattern matches the read side (also `findFirst`), and the brief
// race window where two admins create concurrently is mitigated
// because (a) admins are coordinating manually, (b) a duplicate
// row from a race is recoverable via DB cleanup, (c) the
// upsertShopSettings reads the existing row before deciding to
// create or update.

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import {
  shopSettingsInputSchema,
  type ShopSettingsInput,
} from "./schema";
import type { ShopSettingsForClient } from "./types";

/**
 * Returns the single ShopSettings row, or `null` if the shop has
 * never been configured. The bill route renders a fallback header
 * in the null case so a bill always prints, even pre-config.
 */
export async function getShopSettings(): Promise<ShopSettingsForClient | null> {
  // No role gate on read — the bill page (admin-only via proxy +
  // server-component redirect) calls this server-side, and a
  // logged-in non-admin can't even reach the bill route. Keeping
  // the read public-ish would also make sense for shared callers
  // (e.g., a future read-only branding service), so we leave the
  // gate on the page surface and the write actions.
  return prisma.shopSettings.findFirst({
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Create-or-update the single ShopSettings row.
 *
 * Records `updatedById` from the session so the audit trail
 * preserves which admin last edited.
 *
 * If a row exists, updates it; else creates. The read-then-write
 * is NOT inside a transaction — the brief race window between two
 * admins configuring simultaneously is acceptable at workshop
 * scale (1–3 concurrent users). A future hardening could wrap in
 * `prisma.$transaction` with isolation level if real contention
 * ever surfaces.
 */
export async function upsertShopSettings(input: ShopSettingsInput) {
  const session = await requireRole(["ADMIN"]);

  const parsed = shopSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const existing = await prisma.shopSettings.findFirst();

  const data = {
    shopName: parsed.data.shopName,
    phone: parsed.data.phone,
    address: parsed.data.address,
    footer: parsed.data.footer,
    updatedById: session.user.id,
  };

  const saved = existing
    ? await prisma.shopSettings.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.shopSettings.create({ data });

  // Revalidate every surface that may read the shop header — the
  // settings page itself + the bill route. Sales list/edit pages
  // don't depend on settings; no need to bust their caches.
  revalidatePath("/settings");
  revalidatePath("/sales", "layout");
  return { ok: true as const, settings: saved };
}
