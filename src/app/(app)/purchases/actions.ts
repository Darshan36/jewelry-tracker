"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { purchaseInputSchema, type PurchaseInput } from "./schema";
import { serializePurchase } from "./purchase-helpers";

type BuiltPurchaseData = {
  date: Date;
  supplierId: string | null;
  partyName: string;
  partyPhone: string | null;
  itemDescription: string;
  qty: number;
  rate: bigint;
  discount: bigint;
  total: bigint;
  notes: string | null;
};

async function buildPurchaseData(
  parsed: PurchaseInput,
): Promise<
  | { ok: true; data: BuiltPurchaseData }
  | { ok: false; errors: Record<string, string[]> }
> {
  let partyName = parsed.partyName;
  let partyPhone = parsed.partyPhone;

  if (parsed.supplierId !== null) {
    const supplier = await prisma.supplier.findUnique({
      where: { id: parsed.supplierId, deletedAt: null },
    });
    if (!supplier) {
      return {
        ok: false,
        errors: { supplierId: ["Supplier not found"] },
      };
    }
    partyName = supplier.name;
    partyPhone = supplier.phone;
  }

  const ratePaise = BigInt(Math.round(parsed.rate * 100));
  const discountPaise = BigInt(Math.round(parsed.discount * 100));
  const total = BigInt(parsed.qty) * ratePaise - discountPaise;

  if (total < 0n) {
    return {
      ok: false,
      errors: { discount: ["Discount cannot exceed line total"] },
    };
  }

  return {
    ok: true,
    data: {
      date: parsed.date,
      supplierId: parsed.supplierId,
      partyName,
      partyPhone,
      itemDescription: parsed.itemDescription,
      qty: parsed.qty,
      rate: ratePaise,
      discount: discountPaise,
      total,
      notes: parsed.notes,
    },
  };
}

export async function createPurchase(input: PurchaseInput) {
  await requireSession();

  const parsed = purchaseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const built = await buildPurchaseData(parsed.data);
  if (!built.ok) {
    return { ok: false as const, errors: built.errors };
  }

  const created = await prisma.purchase.create({ data: built.data });
  revalidatePath("/purchases");
  return { ok: true as const, purchase: serializePurchase(created) };
}

export async function updatePurchase(id: string, input: PurchaseInput) {
  await requireSession();

  const parsed = purchaseInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const built = await buildPurchaseData(parsed.data);
  if (!built.ok) {
    return { ok: false as const, errors: built.errors };
  }

  const updated = await prisma.purchase.update({
    where: { id, deletedAt: null },
    data: built.data,
  });
  revalidatePath("/purchases");
  return { ok: true as const, purchase: serializePurchase(updated) };
}

export async function softDeletePurchase(id: string) {
  await requireSession();

  await prisma.purchase.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/purchases");
  return { ok: true as const };
}
