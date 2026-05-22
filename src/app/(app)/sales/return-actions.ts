"use server";

import { requireRole } from "@/lib/auth-guards";
import {
  softDeleteReturnLedgerEntry,
  writeReturnLedgerEntry,
} from "@/lib/ledger";
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
  const session = await requireRole(["ADMIN"]);

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
  const totalLineItemQty = sale.lineItems.reduce(
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

  // Phase 21a: create the return row + ledger DECREASE inside one
  // atomic transaction. Walk-in sales (sale.partyId IS NULL) skip the
  // ledger write — their balance stays on the *Payment / *Return
  // rails.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.saleReturn.create({
      data: {
        saleId: data.saleId,
        date: data.date,
        qtyReturned: data.qtyReturned,
        refundAmount: refundPaise,
        note: data.note,
      },
    });
    if (sale.partyId !== null) {
      await writeReturnLedgerEntry(tx, {
        partyId: sale.partyId,
        date: row.date,
        sourceType: "SALE_RETURN",
        sourceId: row.id,
        amount: row.refundAmount,
        userId: session.user.id,
      });
    }
    return row;
  });

  revalidateSaleViews();
  return { ok: true as const, return: serializeSaleReturn(created) };
}

export async function softDeleteSaleReturn(id: string) {
  const session = await requireRole(["ADMIN"]);

  await prisma.$transaction(async (tx) => {
    await tx.saleReturn.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await softDeleteReturnLedgerEntry(tx, {
      sourceType: "SALE_RETURN",
      sourceId: id,
      userId: session.user.id,
    });
  });

  revalidateSaleViews();
  return { ok: true as const };
}
