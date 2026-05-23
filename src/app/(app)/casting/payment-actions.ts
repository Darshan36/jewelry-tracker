"use server";

import { z } from "zod";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { revalidateCastingViews } from "@/lib/revalidate-transaction-views";

import { serializeCastingEntry } from "./casting-helpers";

const CASTING_ROLES = ["ADMIN", "CASTING_PLATING_MGMT"] as const;

// Payment input schema. Mirrors the Sale/Purchase shape:
//   - amount as rupees (number), converted to paise at the Prisma boundary
//   - type as PaymentType (default PAYMENT)
//   - date coerced from "YYYY-MM-DD" strings
const paymentInputSchema = z.object({
  castingEntryId: z.string().min(1, "Entry id is required"),
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

export type CastingPaymentInput = z.input<typeof paymentInputSchema>;

export async function createCastingPayment(input: CastingPaymentInput) {
  await requireRole([...CASTING_ROLES]);

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
  const entry = await prisma.castingEntry.findUnique({
    where: { id: parsed.data.castingEntryId, deletedAt: null },
    include: { payments: { where: { deletedAt: null } } },
  });
  if (!entry) {
    return {
      ok: false as const,
      errors: { castingEntryId: ["Entry not found"] },
    };
  }

  // Phase 21c.2 — CastingPayment is WALK-IN-ONLY since 21c. Party-
  // linked casting entries record payments on the party ledger
  // (Phase 21a). This guard is the load-bearing invariant. See the
  // CastingPayment Prisma model comment.
  if (entry.partyId !== null) {
    return {
      ok: false as const,
      errors: {
        castingEntryId: [
          "Party-linked casting entries record payments on the party ledger. Use /payables instead.",
        ],
      },
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

  await prisma.castingPayment.create({
    data: {
      castingEntryId: parsed.data.castingEntryId,
      date: parsed.data.date,
      amount: amountPaise,
      type: parsed.data.type,
      note: parsed.data.note,
    },
  });

  revalidateCastingViews();

  // Re-read the entry with everything included so callers can update
  // their local snapshot without a separate round trip.
  const fresh = await prisma.castingEntry.findUnique({
    where: { id: parsed.data.castingEntryId },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
      payments: true,
      party: true,
      attachment: true,
    },
  });
  return {
    ok: true as const,
    entry: fresh ? serializeCastingEntry(fresh) : null,
  };
}

export async function softDeleteCastingPayment(id: string) {
  await requireRole([...CASTING_ROLES]);

  const existing = await prisma.castingPayment.findUnique({
    where: { id, deletedAt: null },
    select: {
      castingEntryId: true,
      castingEntry: { select: { partyId: true } },
    },
  });
  if (!existing) {
    return { ok: false as const, errors: { id: ["Payment not found"] } };
  }
  if (existing.castingEntry.partyId !== null) {
    return {
      ok: false as const,
      errors: {
        id: [
          "Party-linked casting entries record payments on the party ledger. Soft-delete the LedgerEntry instead.",
        ],
      },
    };
  }

  const payment = await prisma.castingPayment.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidateCastingViews();
  return { ok: true as const, castingEntryId: payment.castingEntryId };
}
