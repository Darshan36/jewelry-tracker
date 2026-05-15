"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

import { purchaseInputSchema, type PurchaseInput } from "./schema";
import { serializePurchase } from "./purchase-helpers";

// Mirror of sales/actions.ts. Same auto-promotion rules, only the target
// table flips: Supplier instead of Customer, partyPhone matched against
// `suppliers.phone`, auto-created on no match.

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
  tx: Prisma.TransactionClient,
  parsed: PurchaseInput,
): Promise<
  | { ok: true; data: BuiltPurchaseData }
  | { ok: false; errors: Record<string, string[]> }
> {
  let supplierId = parsed.supplierId;
  let partyName = parsed.partyName;
  let partyPhone = parsed.partyPhone;

  if (supplierId !== null) {
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId, deletedAt: null },
    });
    if (!supplier) {
      return {
        ok: false,
        errors: { supplierId: ["Supplier not found"] },
      };
    }
    partyName = supplier.name;
    partyPhone = supplier.phone;
  } else if (partyPhone !== null) {
    const existing = await tx.supplier.findFirst({
      where: { phone: partyPhone, deletedAt: null },
    });

    if (existing) {
      supplierId = existing.id;
      partyName = existing.name;
      partyPhone = existing.phone;
    } else {
      const created = await tx.supplier.create({
        data: {
          name: partyName,
          phone: partyPhone,
          email: null,
          address: null,
          notes: null,
        },
      });
      supplierId = created.id;
      partyName = created.name;
      partyPhone = created.phone;
    }
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
      supplierId,
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
    const created = await tx.purchase.create({ data: built.data });
    return { ok: true as const, purchase: created };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePath("/purchases");
  if (result.purchase.supplierId !== null) revalidatePath("/suppliers");
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
    const updated = await tx.purchase.update({
      where: { id, deletedAt: null },
      data: built.data,
    });
    return { ok: true as const, purchase: updated };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePath("/purchases");
  if (result.purchase.supplierId !== null) revalidatePath("/suppliers");
  return { ok: true as const, purchase: serializePurchase(result.purchase) };
}

export async function softDeletePurchase(id: string) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  await prisma.purchase.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/purchases");
  return { ok: true as const };
}
