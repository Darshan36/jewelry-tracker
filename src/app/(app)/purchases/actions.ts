"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { assertPartyHasRole } from "@/lib/party-roles";
import { prisma } from "@/lib/prisma";
import { revalidatePurchaseViews } from "@/lib/revalidate-transaction-views";
import type { Prisma } from "@/generated/prisma";

import { purchaseInputSchema, type PurchaseInput } from "./schema";
import { serializePurchase } from "./purchase-helpers";

// Mirror of sales/actions.ts. Phase 17a unified the FK to Party.partyId;
// walk-in auto-promotion now sets/adds the isSupplier role flag on the
// matched-or-created Party row.

type BuiltPurchaseData = {
  date: Date;
  partyId: string | null;
  partyName: string;
  partyPhone: string | null;
  discount: bigint;
  total: bigint;
  notes: string | null;
  lineItemCreates: Array<{
    itemDescription: string;
    qty: number;
    rate: bigint;
  }>;
};

async function buildPurchaseData(
  tx: Prisma.TransactionClient,
  parsed: PurchaseInput,
): Promise<
  | { ok: true; data: BuiltPurchaseData; partyCreatedOrUpdated: boolean }
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
      return {
        ok: false,
        errors: { partyId: ["Party not found"] },
      };
    }
    if (!party.isSupplier) {
      await tx.party.update({
        where: { id: party.id },
        data: { isSupplier: true },
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
      if (!existing.isSupplier) {
        await tx.party.update({
          where: { id: existing.id },
          data: { isSupplier: true },
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
        isSupplier: true,
      };
      assertPartyHasRole(newPartyData);
      const created = await tx.party.create({ data: newPartyData });
      partyId = created.id;
      partyName = created.name;
      partyPhone = created.phone;
      partyCreatedOrUpdated = true;
    }
  }

  const lineItemCreates = parsed.lineItems.map((line) => ({
    itemDescription: line.itemDescription,
    qty: line.qty,
    rate: BigInt(Math.round(line.rate * 100)),
  }));
  const subtotal = lineItemCreates.reduce(
    (sum, line) => sum + BigInt(line.qty) * line.rate,
    0n,
  );
  const discountPaise = BigInt(Math.round(parsed.discount * 100));

  if (discountPaise > subtotal) {
    return {
      ok: false,
      errors: { discount: ["Discount cannot exceed line item subtotal"] },
    };
  }

  const total = subtotal - discountPaise;

  return {
    ok: true,
    partyCreatedOrUpdated,
    data: {
      date: parsed.date,
      partyId,
      partyName,
      partyPhone,
      discount: discountPaise,
      total,
      notes: parsed.notes,
      lineItemCreates,
    },
  };
}

export async function createPurchase(input: PurchaseInput) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  const parsed = purchaseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const built = await buildPurchaseData(tx, parsed.data);
    if (!built.ok) return built;
    const { lineItemCreates, ...purchaseData } = built.data;
    const created = await tx.purchase.create({
      data: {
        ...purchaseData,
        lineItems: { create: lineItemCreates },
      },
      include: { lineItems: { orderBy: { createdAt: "asc" } } },
    });
    return {
      ok: true as const,
      purchase: created,
      partyCreatedOrUpdated: built.partyCreatedOrUpdated,
    };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePurchaseViews();
  if (result.partyCreatedOrUpdated) revalidatePath("/suppliers");
  return { ok: true as const, purchase: serializePurchase(result.purchase) };
}

export async function updatePurchase(id: string, input: PurchaseInput) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  const parsed = purchaseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const built = await buildPurchaseData(tx, parsed.data);
    if (!built.ok) return built;
    const { lineItemCreates, ...purchaseData } = built.data;
    await tx.purchaseLineItem.deleteMany({ where: { purchaseId: id } });
    const updated = await tx.purchase.update({
      where: { id, deletedAt: null },
      data: {
        ...purchaseData,
        lineItems: { create: lineItemCreates },
      },
      include: { lineItems: { orderBy: { createdAt: "asc" } } },
    });
    return {
      ok: true as const,
      purchase: updated,
      partyCreatedOrUpdated: built.partyCreatedOrUpdated,
    };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePurchaseViews();
  if (result.partyCreatedOrUpdated) revalidatePath("/suppliers");
  return { ok: true as const, purchase: serializePurchase(result.purchase) };
}

export async function softDeletePurchase(id: string) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  await prisma.purchase.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePurchaseViews();
  return { ok: true as const };
}
