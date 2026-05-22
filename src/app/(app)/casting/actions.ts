"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";

import { requireRole } from "@/lib/auth-guards";
import {
  softDeleteTransactionLedgerEntry,
  updateTransactionLedgerEntry,
  writeTransactionLedgerEntry,
} from "@/lib/ledger";
import { assertPartyHasRole } from "@/lib/party-roles";
import { prisma } from "@/lib/prisma";
import { revalidateCastingViews } from "@/lib/revalidate-transaction-views";
import { computeLineTotal } from "@/lib/weight-helpers";
import type { Prisma } from "@/generated/prisma";

import {
  castingEntryInputSchema,
  type CastingEntryInput,
} from "./schema";
import { serializeCastingEntry } from "./casting-helpers";

const CASTING_ROLES = ["ADMIN", "CASTING_PLATING_MGMT"] as const;

// Build the prisma `data` payload for a CastingEntry from a parsed input.
// Phase 17a: vendor lookup is now via the unified Party model with the
// isCastingVendor role flag. Walk-in auto-promotion sets/adds the
// isCastingVendor flag on the matched-or-created Party row.

type BuiltLine = {
  materialDescription: string;
  weightKg: Decimal;
  ratePerKg: bigint;
  lineTotal: bigint;
};

type BuiltCastingData = {
  date: Date;
  partyId: string | null;
  partyName: string;
  partyPhone: string | null;
  discount: bigint;
  total: bigint;
  notes: string | null;
  attachmentId: string | null;
  lineItemCreates: BuiltLine[];
};

async function buildCastingData(
  tx: Prisma.TransactionClient,
  parsed: CastingEntryInput,
): Promise<
  | { ok: true; data: BuiltCastingData; partyCreatedOrUpdated: boolean }
  | { ok: false; errors: Record<string, string[]> }
> {
  let partyId = parsed.partyId;
  let partyName = parsed.partyName;
  let partyPhone = parsed.partyPhone;
  let partyCreatedOrUpdated = false;

  if (partyId !== null) {
    const party = await tx.party.findUnique({
      where: { id: partyId, deletedAt: null },
    });
    if (!party) {
      return { ok: false, errors: { partyId: ["Party not found"] } };
    }
    if (!party.isCastingVendor) {
      await tx.party.update({
        where: { id: party.id },
        data: { isCastingVendor: true },
      });
      partyCreatedOrUpdated = true;
    }
    partyName = party.name;
    partyPhone = party.phone;
  } else if (partyPhone !== null) {
    const existing = await tx.party.findFirst({
      where: { phone: partyPhone, deletedAt: null },
    });
    if (existing) {
      if (!existing.isCastingVendor) {
        await tx.party.update({
          where: { id: existing.id },
          data: { isCastingVendor: true },
        });
        partyCreatedOrUpdated = true;
      }
      partyId = existing.id;
      partyName = existing.name;
      partyPhone = existing.phone;
    } else {
      const newPartyData = {
        name: partyName,
        phone: partyPhone,
        email: null,
        address: null,
        notes: null,
        isCastingVendor: true,
      };
      assertPartyHasRole(newPartyData);
      const created = await tx.party.create({ data: newPartyData });
      partyId = created.id;
      partyName = created.name;
      partyPhone = created.phone;
      partyCreatedOrUpdated = true;
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

  let attachmentId: string | null = parsed.attachmentId;
  if (attachmentId !== null) {
    const attachment = await tx.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.deletedAt !== null || attachment.status !== "READY") {
      return { ok: false, errors: { attachmentId: ["Bill not found or not ready"] } };
    }
  }

  return {
    ok: true,
    partyCreatedOrUpdated,
    data: {
      date: parsed.date,
      partyId,
      partyName,
      partyPhone,
      discount: discountPaise,
      total: subtotal - discountPaise,
      notes: parsed.notes,
      attachmentId,
      lineItemCreates,
    },
  };
}

export async function createCastingEntry(input: CastingEntryInput) {
  const session = await requireRole([...CASTING_ROLES]);

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
            weightKg: l.weightKg.toFixed(3),
            ratePerKg: l.ratePerKg,
            lineTotal: l.lineTotal,
          })),
        },
      },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        party: true,
        attachment: true,
      },
    });
    if (created.partyId !== null) {
      await writeTransactionLedgerEntry(tx, {
        partyId: created.partyId,
        date: created.date,
        sourceType: "CASTING",
        sourceId: created.id,
        amount: created.total,
        lineItemCount: lineItemCreates.length,
        userId: session.user.id,
      });
    }
    return {
      ok: true as const,
      entry: created,
      partyCreatedOrUpdated: built.partyCreatedOrUpdated,
    };
  });

  if (!result.ok) return { ok: false as const, errors: result.errors };

  revalidateCastingViews();
  if (result.partyCreatedOrUpdated) revalidatePath("/vendors");
  return { ok: true as const, entry: serializeCastingEntry(result.entry) };
}

export async function updateCastingEntry(id: string, input: CastingEntryInput) {
  const session = await requireRole([...CASTING_ROLES]);

  const parsed = castingEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, errors: parsed.error.flatten().fieldErrors };
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.castingEntry.findUnique({
      where: { id, deletedAt: null },
      select: { partyId: true },
    });
    if (!existing) {
      return {
        ok: false as const,
        errors: { partyId: ["Casting entry not found"] },
      };
    }
    const oldPartyId = existing.partyId;

    const built = await buildCastingData(tx, parsed.data);
    if (!built.ok) return built;
    const { lineItemCreates, ...entryData } = built.data;
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
        party: true,
        attachment: true,
      },
    });
    await updateTransactionLedgerEntry(tx, {
      sourceType: "CASTING",
      sourceId: updated.id,
      oldPartyId,
      newPartyId: updated.partyId,
      newDate: updated.date,
      newAmount: updated.total,
      newLineItemCount: lineItemCreates.length,
      userId: session.user.id,
    });
    return {
      ok: true as const,
      entry: updated,
      partyCreatedOrUpdated: built.partyCreatedOrUpdated,
    };
  });

  if (!result.ok) return { ok: false as const, errors: result.errors };

  revalidateCastingViews();
  if (result.partyCreatedOrUpdated) revalidatePath("/vendors");
  return { ok: true as const, entry: serializeCastingEntry(result.entry) };
}

export async function softDeleteCastingEntry(id: string) {
  const session = await requireRole([...CASTING_ROLES]);

  // See softDeleteSale for the cascade rationale. Casting/Plating
  // have no *Return table (outsourced services don't have a returnable-
  // goods workflow per the Phase 9 decision), so only *Payment children
  // need cascading.
  await prisma.$transaction(async (tx) => {
    const deletedAt = new Date();
    await tx.castingEntry.update({
      where: { id, deletedAt: null },
      data: { deletedAt },
    });
    await tx.castingPayment.updateMany({
      where: { castingEntryId: id, deletedAt: null },
      data: { deletedAt },
    });
    await softDeleteTransactionLedgerEntry(tx, {
      sourceType: "CASTING",
      sourceId: id,
      userId: session.user.id,
    });
  });
  revalidateCastingViews();
  return { ok: true as const };
}

export async function attachAttachmentToCastingEntry(entryId: string, attachmentId: string) {
  await requireRole([...CASTING_ROLES]);

  await prisma.castingEntry.update({
    where: { id: entryId, deletedAt: null },
    data: { attachmentId },
  });
  revalidateCastingViews();
  return { ok: true as const };
}

export async function detachAttachmentFromCastingEntry(entryId: string) {
  await requireRole([...CASTING_ROLES]);

  await prisma.castingEntry.update({
    where: { id: entryId, deletedAt: null },
    data: { attachmentId: null },
  });
  revalidateCastingViews();
  return { ok: true as const };
}
