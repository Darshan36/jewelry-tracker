"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

import { purchaseInputSchema, type PurchaseInput } from "./schema";
import { serializePurchase } from "./purchase-helpers";

// Mirror of sales/actions.ts. Same auto-promotion + line-items pattern,
// only the target tables flip: Supplier instead of Customer, PurchaseLineItem
// instead of SaleLineItem.

type BuiltPurchaseData = {
  date: Date;
  supplierId: string | null;
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
    data: {
      date: parsed.date,
      supplierId,
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
