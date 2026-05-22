"use server";

import { requireRole } from "@/lib/auth-guards";
import {
  softDeleteReturnLedgerEntry,
  writeReturnLedgerEntry,
} from "@/lib/ledger";
import { prisma } from "@/lib/prisma";
import { revalidatePurchaseViews } from "@/lib/revalidate-transaction-views";

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
  const session = await requireRole(["ADMIN", "PURCHASE_DEPT"]);

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
    include: {
      returns: { where: { deletedAt: null } },
      lineItems: true,
    },
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
  const totalLineItemQty = purchase.lineItems.reduce(
    (sum, li) => sum + li.qty,
    0,
  );

  if (data.qtyReturned + existingReturnedQty > totalLineItemQty) {
    return {
      ok: false as const,
      errors: {
        qtyReturned: [
          `Cannot return more than the original quantity. Already returned: ${existingReturnedQty} of ${totalLineItemQty}`,
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

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.purchaseReturn.create({
      data: {
        purchaseId: data.purchaseId,
        date: data.date,
        qtyReturned: data.qtyReturned,
        refundAmount: refundPaise,
        note: data.note,
      },
    });
    if (purchase.partyId !== null) {
      await writeReturnLedgerEntry(tx, {
        partyId: purchase.partyId,
        date: row.date,
        sourceType: "PURCHASE_RETURN",
        sourceId: row.id,
        amount: row.refundAmount,
        userId: session.user.id,
      });
    }
    return row;
  });

  revalidatePurchaseViews();
  return { ok: true as const, return: serializePurchaseReturn(created) };
}

export async function softDeletePurchaseReturn(id: string) {
  const session = await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  await prisma.$transaction(async (tx) => {
    await tx.purchaseReturn.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await softDeleteReturnLedgerEntry(tx, {
      sourceType: "PURCHASE_RETURN",
      sourceId: id,
      userId: session.user.id,
    });
  });

  revalidatePurchaseViews();
  return { ok: true as const };
}
