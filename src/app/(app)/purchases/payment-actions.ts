"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import {
  purchasePaymentInputSchema,
  type PurchasePaymentInput,
} from "./payment-schema";
import { serializePurchasePayment } from "./purchase-helpers";

function formatPaiseAsRupees(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(rupees);
}

// Net paid: SUM(PAYMENT) − SUM(REFUND) over non-deleted.
// For Purchases: PAYMENT = shop paid supplier; REFUND = supplier credited
// back. Net = shop's net cash outflow to supplier.
function computeNetPaid(
  payments: {
    amount: bigint;
    type: "PAYMENT" | "REFUND";
    deletedAt: Date | null;
  }[],
): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce(
      (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
      0n,
    );
}

function computeReturnTotal(
  returns: { refundAmount: bigint; deletedAt: Date | null }[],
): bigint {
  return returns
    .filter((r) => r.deletedAt === null)
    .reduce((sum, r) => sum + r.refundAmount, 0n);
}

export async function createPurchasePayment(input: PurchasePaymentInput) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  const parsed = purchasePaymentInputSchema.safeParse(input);
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
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
    },
  });

  if (!purchase) {
    return {
      ok: false as const,
      errors: { purchaseId: ["Purchase not found"] },
    };
  }

  const netPaid = computeNetPaid(purchase.payments);
  const returnTotal = computeReturnTotal(purchase.returns);
  const effectiveTotal = purchase.total - returnTotal;
  const amountPaise = BigInt(Math.round(data.amount * 100));

  if (data.type === "PAYMENT") {
    // PAYMENT (to supplier): can't pay more than what's still owed.
    const remaining = effectiveTotal - netPaid;
    if (amountPaise > remaining) {
      return {
        ok: false as const,
        errors: {
          amount: [
            `Exceeds remaining balance. Owed to supplier: ${formatPaiseAsRupees(remaining)}`,
          ],
        },
      };
    }
  } else {
    // REFUND (from supplier): can't receive back more than was actually
    // paid. Symmetric to Sales but the direction is flipped — REFUND in
    // Purchases is supplier crediting money back to the shop.
    if (amountPaise > netPaid) {
      return {
        ok: false as const,
        errors: {
          amount: [
            `Refund exceeds amount paid. Maximum: ${formatPaiseAsRupees(netPaid)}`,
          ],
        },
      };
    }
  }

  const created = await prisma.purchasePayment.create({
    data: {
      purchaseId: data.purchaseId,
      date: data.date,
      amount: amountPaise,
      type: data.type,
      note: data.note,
    },
  });

  revalidatePath("/purchases");
  return { ok: true as const, payment: serializePurchasePayment(created) };
}

export async function softDeletePurchasePayment(id: string) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  await prisma.purchasePayment.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/purchases");
  return { ok: true as const };
}
