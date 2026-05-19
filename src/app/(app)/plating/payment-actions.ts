"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { serializePlatingEntry } from "./plating-helpers";

const PLATING_ROLES = ["ADMIN", "CASTING_PLATING_MGMT"] as const;

// Payment input schema. Mirrors the Sale/Purchase shape:
//   - amount as rupees (number), converted to paise at the Prisma boundary
//   - type as PaymentType (default PAYMENT)
//   - date coerced from "YYYY-MM-DD" strings
const paymentInputSchema = z.object({
  platingEntryId: z.string().min(1, "Entry id is required"),
  date: z.coerce.date({ message: "Date is required" }),
  amount: z.number().positive("Amount must be greater than zero"),
  type: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT"),
  note: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v)),
});

export type PlatingPaymentInput = z.input<typeof paymentInputSchema>;

export async function createPlatingPayment(input: PlatingPaymentInput) {
  await requireRole([...PLATING_ROLES]);

  const parsed = paymentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, errors: parsed.error.flatten().fieldErrors };
  }

  const amountPaise = BigInt(Math.round(parsed.data.amount * 100));

  // Fetch the parent entry + its existing non-deleted payments. We need
  // the parent's `total` and the net-paid aggregation to validate the new
  // payment doesn't overshoot the remaining balance (or, for REFUND
  // entries, doesn't exceed the net paid amount — you can't refund what
  // the vendor never received).
  const entry = await prisma.platingEntry.findUnique({
    where: { id: parsed.data.platingEntryId, deletedAt: null },
    include: { payments: { where: { deletedAt: null } } },
  });
  if (!entry) {
    return {
      ok: false as const,
      errors: { platingEntryId: ["Entry not found"] },
    };
  }

  const netPaid = entry.payments.reduce(
    (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
    0n,
  );

  if (parsed.data.type === "PAYMENT") {
    const remaining = entry.total - netPaid;
    if (amountPaise > remaining) {
      const remainingRupees = Number(remaining) / 100;
      return {
        ok: false as const,
        errors: {
          amount: [
            `Exceeds remaining balance. Owed to vendor: ₹${remainingRupees.toFixed(2)}`,
          ],
        },
      };
    }
  } else {
    if (amountPaise > netPaid) {
      const netRupees = Number(netPaid) / 100;
      return {
        ok: false as const,
        errors: {
          amount: [
            `Refund exceeds amount paid. Maximum: ₹${netRupees.toFixed(2)}`,
          ],
        },
      };
    }
  }

  await prisma.platingPayment.create({
    data: {
      platingEntryId: parsed.data.platingEntryId,
      date: parsed.data.date,
      amount: amountPaise,
      type: parsed.data.type,
      note: parsed.data.note,
    },
  });

  revalidatePath("/plating");

  // Re-read the entry with everything included so callers can update
  // their local snapshot without a separate round trip.
  const fresh = await prisma.platingEntry.findUnique({
    where: { id: parsed.data.platingEntryId },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
      payments: true,
      party: true,
      attachment: true,
    },
  });
  return {
    ok: true as const,
    entry: fresh ? serializePlatingEntry(fresh) : null,
  };
}

export async function softDeletePlatingPayment(id: string) {
  await requireRole([...PLATING_ROLES]);

  const payment = await prisma.platingPayment.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/plating");
  return { ok: true as const, platingEntryId: payment.platingEntryId };
}
