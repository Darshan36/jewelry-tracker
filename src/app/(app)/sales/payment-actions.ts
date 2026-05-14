"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { salePaymentInputSchema, type SalePaymentInput } from "./payment-schema";
import { serializeSalePayment } from "./sale-helpers";

// Format paise BigInt → "₹1,234.56" for the action's user-facing error
// message. Mirrors `formatCurrency` in `src/lib/format.ts` but kept local
// to avoid pulling a client-targeted helper into the server-action module.
function formatPaiseAsRupees(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(rupees);
}

export async function createSalePayment(input: SalePaymentInput) {
  await requireSession();

  const parsed = salePaymentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Look up the sale + its non-deleted payments in one round-trip so we can
  // compute the remaining balance accurately. Soft-deleted sale → "not
  // found" (same convention as the customer lookup in createSale).
  const sale = await prisma.sale.findUnique({
    where: { id: data.saleId, deletedAt: null },
    include: { payments: { where: { deletedAt: null } } },
  });

  if (!sale) {
    return {
      ok: false as const,
      errors: { saleId: ["Sale not found"] },
    };
  }

  const paidSoFar = sale.payments.reduce((sum, p) => sum + p.amount, 0n);
  const remaining = sale.total - paidSoFar;
  const amountPaise = BigInt(Math.round(data.amount * 100));

  if (amountPaise > remaining) {
    return {
      ok: false as const,
      errors: {
        amount: [
          `Exceeds remaining balance. Outstanding: ${formatPaiseAsRupees(remaining)}`,
        ],
      },
    };
  }

  const created = await prisma.salePayment.create({
    data: {
      saleId: data.saleId,
      date: data.date,
      amount: amountPaise,
      note: data.note,
    },
  });

  revalidatePath("/sales");
  return { ok: true as const, payment: serializeSalePayment(created) };
}

export async function softDeleteSalePayment(id: string) {
  await requireSession();

  await prisma.salePayment.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/sales");
  return { ok: true as const };
}
