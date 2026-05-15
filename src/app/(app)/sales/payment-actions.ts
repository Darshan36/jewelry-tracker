"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { salePaymentInputSchema, type SalePaymentInput } from "./payment-schema";
import { serializeSalePayment } from "./sale-helpers";

// Format paise BigInt → "₹1,234.56" for the action's user-facing error
// message. Kept local to this server-action module (vs. importing from
// @/lib/format) to avoid pulling client-targeted helpers into a 'use
// server' file.
function formatPaiseAsRupees(paise: bigint): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(rupees);
}

// Net paid: SUM(PAYMENT) − SUM(REFUND) over non-deleted.
function computeNetPaid(
  payments: { amount: bigint; type: "PAYMENT" | "REFUND"; deletedAt: Date | null }[],
): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce((sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount), 0n);
}

function computeReturnTotal(
  returns: { refundAmount: bigint; deletedAt: Date | null }[],
): bigint {
  return returns
    .filter((r) => r.deletedAt === null)
    .reduce((sum, r) => sum + r.refundAmount, 0n);
}

export async function createSalePayment(input: SalePaymentInput) {
  await requireRole(["ADMIN"]);

  const parsed = salePaymentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Look up sale + both children in one round-trip so we can compute
  // remaining-payment OR refundable-amount accurately based on the type.
  const sale = await prisma.sale.findUnique({
    where: { id: data.saleId, deletedAt: null },
    include: {
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
    },
  });

  if (!sale) {
    return {
      ok: false as const,
      errors: { saleId: ["Sale not found"] },
    };
  }

  const netPaid = computeNetPaid(sale.payments);
  const returnTotal = computeReturnTotal(sale.returns);
  const effectiveTotal = sale.total - returnTotal;
  const amountPaise = BigInt(Math.round(data.amount * 100));

  if (data.type === "PAYMENT") {
    // PAYMENT check: can't exceed what's still owed against the effective
    // total (which may already be reduced by returns).
    const remaining = effectiveTotal - netPaid;
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
  } else {
    // REFUND check: can't refund more than has been paid net so far.
    // (Refunding ₹500 from a ₹100 paid sale doesn't make business sense —
    // the customer never gave us that money.)
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

  const created = await prisma.salePayment.create({
    data: {
      saleId: data.saleId,
      date: data.date,
      amount: amountPaise,
      type: data.type,
      note: data.note,
    },
  });

  revalidatePath("/sales");
  return { ok: true as const, payment: serializeSalePayment(created) };
}

export async function softDeleteSalePayment(id: string) {
  await requireRole(["ADMIN"]);

  await prisma.salePayment.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/sales");
  return { ok: true as const };
}
