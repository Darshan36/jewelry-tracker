"use server";

// Phase 21a — party-ledger payment actions.
//
// Replaces the Phase 17b bulk `createPartyPayment` (which split a
// single payment into N per-bill *Payment rows). The ledger model
// treats payment as a single party-level event:
//
//   - One DECREASE entry on the party's ledger.
//   - No per-bill allocation. Outstanding reconciles against the full
//     party balance, not per-transaction.
//
// Role gating: same role-intersection logic as the old bulk action,
// derived from the party's role flags. A supplier-only payment can be
// recorded by ADMIN OR PURCHASE_DEPT; a customer payment is ADMIN-only;
// a multi-role party (rare) requires the role that intersects every
// applicable activity (typically ADMIN).

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";

import {
  createLedgerPaymentSchema,
  type CreateLedgerPaymentInput,
} from "./ledger-schema";

export type LedgerActionResult =
  | { ok: true; entryId: string }
  | {
      ok: false;
      errors: {
        partyId?: string[];
        amount?: string[];
        date?: string[];
        description?: string[];
        id?: string[];
        message?: string;
      };
    };

/**
 * Determine the role-intersection that may pay this party. Driven by
 * the party's role flags:
 *   - Customer payments (sales receivables) → ADMIN-only.
 *   - Supplier payments → ADMIN + PURCHASE_DEPT.
 *   - Casting/Plating vendor payments → ADMIN + CASTING_PLATING_MGMT.
 *   - Multi-role parties → intersection (typically just ADMIN).
 *
 * Defensive: if the party has no role flags set, returns [] which
 * forces the role check to fail (no role can save). Shouldn't happen
 * given the Phase 17a roleless-party assertion, but the guard is here.
 */
function rolesAllowedForParty(party: {
  isCustomer: boolean;
  isSupplier: boolean;
  isCastingVendor: boolean;
  isPlatingVendor: boolean;
}): Role[] {
  const sets: Set<Role>[] = [];
  if (party.isCustomer) sets.push(new Set<Role>(["ADMIN"]));
  if (party.isSupplier) sets.push(new Set<Role>(["ADMIN", "PURCHASE_DEPT"]));
  if (party.isCastingVendor)
    sets.push(new Set<Role>(["ADMIN", "CASTING_PLATING_MGMT"]));
  if (party.isPlatingVendor)
    sets.push(new Set<Role>(["ADMIN", "CASTING_PLATING_MGMT"]));
  if (sets.length === 0) return [];
  return [...sets.reduce((acc, s) => new Set([...acc].filter((r) => s.has(r))))];
}

export async function createLedgerPayment(
  input: CreateLedgerPaymentInput,
): Promise<LedgerActionResult> {
  const parsed = createLedgerPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  // Load the party for the role-intersection check + audit context.
  const party = await prisma.party.findUnique({
    where: { id: data.partyId, deletedAt: null },
    select: {
      id: true,
      isCustomer: true,
      isSupplier: true,
      isCastingVendor: true,
      isPlatingVendor: true,
    },
  });
  if (!party) {
    return { ok: false, errors: { partyId: ["Party not found"] } };
  }

  const allowed = rolesAllowedForParty(party);
  if (allowed.length === 0) {
    return {
      ok: false,
      errors: {
        message:
          "Party has no role flags — payment routing cannot be resolved.",
      },
    };
  }
  const session = await requireRole(allowed);

  const amountPaise = BigInt(Math.round(data.amount * 100));

  // No overpayment / overdraft guard in 21a — the workshop owner
  // accepted that negative party balances (credits) are valid and
  // representable. If a customer pays ₹5000 against ₹2000 outstanding,
  // the resulting ₹3000 credit balance sits on the ledger as a
  // negative party balance until reconciled.
  const created = await prisma.ledgerEntry.create({
    data: {
      partyId: party.id,
      date: data.date,
      direction: "DECREASE",
      amount: amountPaise,
      description: data.description,
      entryType: "MANUAL_PAYMENT",
      sourceType: null,
      sourceId: null,
      createdById: session.user.id,
      updatedById: session.user.id,
    },
  });

  // Revalidate every surface that displays party balances or ledger
  // statements.
  revalidatePath("/payables");
  revalidatePath("/receivables");
  revalidatePath("/dashboard");
  revalidatePath(`/payables/${party.id}`);
  revalidatePath(`/receivables/${party.id}`);

  return { ok: true, entryId: created.id };
}

/**
 * Soft-delete a MANUAL_PAYMENT ledger entry. Only MANUAL_PAYMENT
 * entries can be soft-deleted directly via this action —
 * TRANSACTION_LINKED entries are managed by their parent transaction's
 * soft-delete flow (softDeleteSale / softDeletePurchase / etc.) which
 * cascades through the same prisma.$transaction envelope.
 */
export async function softDeleteLedgerEntry(
  id: string,
): Promise<LedgerActionResult> {
  // Find the entry first to determine which roles can soft-delete it.
  const entry = await prisma.ledgerEntry.findUnique({
    where: { id, deletedAt: null },
    select: {
      id: true,
      entryType: true,
      party: {
        select: {
          id: true,
          isCustomer: true,
          isSupplier: true,
          isCastingVendor: true,
          isPlatingVendor: true,
        },
      },
    },
  });
  if (!entry) {
    return { ok: false, errors: { message: "Ledger entry not found" } };
  }
  if (entry.entryType !== "MANUAL_PAYMENT") {
    return {
      ok: false,
      errors: {
        message:
          "Cannot soft-delete a TRANSACTION_LINKED entry directly. Delete the parent transaction instead.",
      },
    };
  }

  const allowed = rolesAllowedForParty(entry.party);
  if (allowed.length === 0) {
    return {
      ok: false,
      errors: { message: "Party has no role flags." },
    };
  }
  const session = await requireRole(allowed);

  await prisma.ledgerEntry.update({
    where: { id: entry.id },
    data: {
      deletedAt: new Date(),
      deletedById: session.user.id,
    },
  });

  revalidatePath("/payables");
  revalidatePath("/receivables");
  revalidatePath("/dashboard");
  revalidatePath(`/payables/${entry.party.id}`);
  revalidatePath(`/receivables/${entry.party.id}`);

  return { ok: true, entryId: entry.id };
}
