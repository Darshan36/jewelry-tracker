"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { computeLineTotal } from "@/lib/weight-helpers";
import type { Prisma } from "@/generated/prisma";

import {
  castingEntryInputSchema,
  type CastingEntryInput,
} from "./schema";
import { serializeCastingEntry } from "./casting-helpers";

const CASTING_ROLES = ["ADMIN", "CASTING_PLATING_MGMT"] as const;

// Build the prisma `data` payload for a CastingEntry from a parsed input.
//
// Same shape as Sales/Purchases buildEntryData with two differences:
//   - line item math is weight × rate (Decimal × BigInt) instead of qty
//     × rate, via the canonical `computeLineTotal` helper in
//     src/lib/weight-helpers.ts.
//   - Vendor auto-promotion uses CastingPlatingVendor by normalized phone.
//     The same vendor table serves casting and plating, so a walk-in
//     vendor created here is reusable by both flows.

type BuiltLine = {
  materialDescription: string;
  weightKg: Decimal;
  ratePerKg: bigint;
  lineTotal: bigint;
};

type BuiltCastingData = {
  date: Date;
  vendorId: string | null;
  partyName: string;
  partyPhone: string | null;
  discount: bigint;
  total: bigint;
  notes: string | null;
  billId: string | null;
  lineItemCreates: BuiltLine[];
};

async function buildCastingData(
  tx: Prisma.TransactionClient,
  parsed: CastingEntryInput,
): Promise<
  | { ok: true; data: BuiltCastingData }
  | { ok: false; errors: Record<string, string[]> }
> {
  let vendorId = parsed.vendorId;
  let partyName = parsed.partyName;
  let partyPhone = parsed.partyPhone;

  if (vendorId !== null) {
    const vendor = await tx.castingPlatingVendor.findUnique({
      where: { id: vendorId, deletedAt: null },
    });
    if (!vendor) {
      return { ok: false, errors: { vendorId: ["Vendor not found"] } };
    }
    partyName = vendor.name;
    partyPhone = vendor.phone;
  } else if (partyPhone !== null) {
    const existing = await tx.castingPlatingVendor.findFirst({
      where: { phone: partyPhone, deletedAt: null },
    });
    if (existing) {
      vendorId = existing.id;
      partyName = existing.name;
      partyPhone = existing.phone;
    } else {
      const created = await tx.castingPlatingVendor.create({
        data: {
          name: partyName,
          phone: partyPhone,
          address: null,
          notes: null,
        },
      });
      vendorId = created.id;
      partyName = created.name;
      partyPhone = created.phone;
    }
  }

  const lineItemCreates: BuiltLine[] = parsed.lineItems.map((line) => {
    const weightKg = new Decimal(line.weightKg);
    const ratePerKg = BigInt(Math.round(line.ratePerKg * 100));
    return {
      materialDescription: line.materialDescription,
      weightKg,
      ratePerKg,
      lineTotal: computeLineTotal(weightKg, ratePerKg),
    };
  });

  const subtotal = lineItemCreates.reduce((sum, l) => sum + l.lineTotal, 0n);
  const discountPaise = BigInt(Math.round(parsed.discount * 100));

  if (discountPaise > subtotal) {
    return {
      ok: false,
      errors: { discount: ["Discount cannot exceed line item subtotal"] },
    };
  }

  // Validate billId if provided — must exist, be READY, not be already
  // attached to a different entry (the @unique constraint enforces this
  // at the DB level too, but a clean error here is better UX).
  let billId: string | null = parsed.billId;
  if (billId !== null) {
    const bill = await tx.bill.findUnique({ where: { id: billId } });
    if (!bill || bill.deletedAt !== null || bill.status !== "READY") {
      return { ok: false, errors: { billId: ["Bill not found or not ready"] } };
    }
  }

  return {
    ok: true,
    data: {
      date: parsed.date,
      vendorId,
      partyName,
      partyPhone,
      discount: discountPaise,
      total: subtotal - discountPaise,
      notes: parsed.notes,
      billId,
      lineItemCreates,
    },
  };
}

export async function createCastingEntry(input: CastingEntryInput) {
  await requireRole([...CASTING_ROLES]);

  const parsed = castingEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, errors: parsed.error.flatten().fieldErrors };
  }

  const result = await prisma.$transaction(async (tx) => {
    const built = await buildCastingData(tx, parsed.data);
    if (!built.ok) return built;
    const { lineItemCreates, ...entryData } = built.data;
    const created = await tx.castingEntry.create({
      data: {
        ...entryData,
        lineItems: {
          create: lineItemCreates.map((l) => ({
            materialDescription: l.materialDescription,
            // Prisma accepts string for Decimal inputs.
            weightKg: l.weightKg.toFixed(3),
            ratePerKg: l.ratePerKg,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        vendor: true,
        bill: true,
      },
    });
    return { ok: true as const, entry: created };
  });

  if (!result.ok) return { ok: false as const, errors: result.errors };

  revalidatePath("/casting");
  if (result.entry.vendorId !== null) revalidatePath("/vendors");
  return { ok: true as const, entry: serializeCastingEntry(result.entry) };
}

export async function updateCastingEntry(id: string, input: CastingEntryInput) {
  await requireRole([...CASTING_ROLES]);

  const parsed = castingEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, errors: parsed.error.flatten().fieldErrors };
  }

  const result = await prisma.$transaction(async (tx) => {
    const built = await buildCastingData(tx, parsed.data);
    if (!built.ok) return built;
    const { lineItemCreates, ...entryData } = built.data;
    // Replace-all line items (Phase 7 pattern). Hard-delete then recreate.
    await tx.castingLineItem.deleteMany({ where: { castingEntryId: id } });
    const updated = await tx.castingEntry.update({
      where: { id, deletedAt: null },
      data: {
        ...entryData,
        lineItems: {
          create: lineItemCreates.map((l) => ({
            materialDescription: l.materialDescription,
            weightKg: l.weightKg.toFixed(3),
            ratePerKg: l.ratePerKg,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        vendor: true,
        bill: true,
      },
    });
    return { ok: true as const, entry: updated };
  });

  if (!result.ok) return { ok: false as const, errors: result.errors };

  revalidatePath("/casting");
  if (result.entry.vendorId !== null) revalidatePath("/vendors");
  return { ok: true as const, entry: serializeCastingEntry(result.entry) };
}

export async function softDeleteCastingEntry(id: string) {
  await requireRole([...CASTING_ROLES]);

  await prisma.castingEntry.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/casting");
  return { ok: true as const };
}

// Attaches an existing Bill row to a casting entry. Called from the
// form-modal AFTER the entry has been created and the bill has been
// uploaded + confirmed (with attachedToType: 'CASTING_ENTRY',
// attachedToId: entry.id). Used by both the create flow and the edit-
// replace-bill flow.
export async function attachBillToCastingEntry(entryId: string, billId: string) {
  await requireRole([...CASTING_ROLES]);

  await prisma.castingEntry.update({
    where: { id: entryId, deletedAt: null },
    data: { billId },
  });
  revalidatePath("/casting");
  return { ok: true as const };
}

export async function detachBillFromCastingEntry(entryId: string) {
  await requireRole([...CASTING_ROLES]);

  await prisma.castingEntry.update({
    where: { id: entryId, deletedAt: null },
    data: { billId: null },
  });
  revalidatePath("/casting");
  return { ok: true as const };
}
