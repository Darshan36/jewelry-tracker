"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import {
  purchaseReturnInputSchema,
  type PurchaseReturnInput,
} from "./return-schema";
import { serializePurchaseReturn } from "./purchase-helpers";

function formatPaiseAsRupees(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(rupees);
}

export async function createPurchaseReturn(input: PurchaseReturnInput) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  const parsed = purchaseReturnInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const purchase = await prisma.purchase.findUnique({
    where: { id: data.purchaseId, deletedAt: null },
    include: { returns: { where: { deletedAt: null } } },
  });

  if (!purchase) {
    return {
      ok: false as const,
      errors: { purchaseId: ["Purchase not found"] },
    };
  }

  const existingReturnedQty = purchase.returns.reduce(
    (sum, r) => sum + r.qtyReturned,
    0,
  );
  const existingReturnTotal = purchase.returns.reduce(
    (sum, r) => sum + r.refundAmount,
    0n,
  );

  if (data.qtyReturned + existingReturnedQty > purchase.qty) {
    return {
      ok: false as const,
      errors: {
        qtyReturned: [
          `Cannot return more than the original quantity. Already returned: ${existingReturnedQty} of ${purchase.qty}`,
        ],
      },
    };
  }

  const refundPaise = BigInt(Math.round(data.refundAmount * 100));

  const remainingReturnable = purchase.total - existingReturnTotal;
  if (refundPaise > remainingReturnable) {
    return {
      ok: false as const,
      errors: {
        refundAmount: [
          `Refund exceeds remaining returnable value. Maximum: ${formatPaiseAsRupees(remainingReturnable)}`,
        ],
      },
    };
  }

  const created = await prisma.purchaseReturn.create({
    data: {
      purchaseId: data.purchaseId,
      date: data.date,
      qtyReturned: data.qtyReturned,
      refundAmount: refundPaise,
      note: data.note,
    },
  });

  revalidatePath("/purchases");
  return { ok: true as const, return: serializePurchaseReturn(created) };
}

export async function softDeletePurchaseReturn(id: string) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  await prisma.purchaseReturn.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/purchases");
  return { ok: true as const };
}
