"use server";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { revalidateSaleViews } from "@/lib/revalidate-transaction-views";

import { saleReturnInputSchema, type SaleReturnInput } from "./return-schema";
import { serializeSaleReturn } from "./sale-helpers";

function formatPaiseAsRupees(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(rupees);
}

export async function createSaleReturn(input: SaleReturnInput) {
  await requireRole(["ADMIN"]);

  const parsed = saleReturnInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const sale = await prisma.sale.findUnique({
    where: { id: data.saleId, deletedAt: null },
    include: {
      returns: { where: { deletedAt: null } },
      lineItems: true,
    },
  });

  if (!sale) {
    return {
      ok: false as const,
      errors: { saleId: ["Sale not found"] },
    };
  }

  // Aggregate existing returns to enforce per-row + cumulative constraints.
  const existingReturnedQty = sale.returns.reduce(
    (sum, r) => sum + r.qtyReturned,
    0,
  );
  const existingReturnTotal = sale.returns.reduce(
    (sum, r) => sum + r.refundAmount,
    0n,
  );
  // Phase 7: total sellable qty is the sum across line items, not a single
  // `Sale.qty` column (which was removed).
  const totalLineItemQty = sale.lineItems.reduce(
    (sum, li) => sum + li.qty,
    0,
  );

  // QTY check: cumulative returned ≤ sum of line-item qty.
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

  // REFUND-AMOUNT check: cumulative refund ≤ sale.total (can't refund more
  // than the customer was originally invoiced).
  const remainingReturnable = sale.total - existingReturnTotal;
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

  const created = await prisma.saleReturn.create({
    data: {
      saleId: data.saleId,
      date: data.date,
      qtyReturned: data.qtyReturned,
      refundAmount: refundPaise,
      note: data.note,
    },
  });

  revalidateSaleViews();
  return { ok: true as const, return: serializeSaleReturn(created) };
}

export async function softDeleteSaleReturn(id: string) {
  await requireRole(["ADMIN"]);

  await prisma.saleReturn.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  revalidateSaleViews();
  return { ok: true as const };
}
