"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { assertPartyHasRole } from "@/lib/party-roles";
import { prisma } from "@/lib/prisma";

import { customerInputSchema, type CustomerInput } from "./schema";

// Phase 17a: Customer data is now stored in the unified `Party` table with
// `isCustomer = true`. These actions are thin wrappers that filter Party
// queries by the role flag — same UX, unified data layer. Role-flag
// preservation: soft-deleting a customer does NOT clear `isCustomer` on
// the Party row; the deletedAt tombstone hides it from /customers but
// historical sales still reference the snapshot via partyName/partyPhone.

export async function createCustomer(input: CustomerInput) {
  await requireRole(["ADMIN"]);

  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // Phone collision: if a Party already exists at this phone (e.g. it was
  // first created as a supplier), flip the isCustomer flag rather than
  // duplicating. Phone is globally UNIQUE on parties.
  if (parsed.data.phone) {
    const existing = await prisma.party.findUnique({
      where: { phone: parsed.data.phone },
    });
    if (existing && existing.deletedAt === null) {
      const customer = await prisma.party.update({
        where: { id: existing.id },
        data: {
          isCustomer: true,
          // Only overwrite name/email/etc when caller provides them.
          name: parsed.data.name,
          email: parsed.data.email ?? existing.email,
          address: parsed.data.address ?? existing.address,
          notes: parsed.data.notes ?? existing.notes,
        },
      });
      revalidatePath("/customers");
      return { ok: true as const, customer };
    }
  }

  const partyData = { ...parsed.data, isCustomer: true };
  assertPartyHasRole(partyData);
  const customer = await prisma.party.create({ data: partyData });
  revalidatePath("/customers");
  return { ok: true as const, customer };
}

export async function updateCustomer(id: string, input: CustomerInput) {
  await requireRole(["ADMIN"]);

  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const customer = await prisma.party.update({
    where: { id, deletedAt: null },
    data: parsed.data,
  });
  revalidatePath("/customers");
  return { ok: true as const, customer };
}

export async function softDeleteCustomer(id: string) {
  const session = await requireRole(["ADMIN"]);

  // Phase 21c.2 cascade fix: soft-deleting a party must also soft-
  // delete its active ledger_entries. Pre-fix, an orphan ledger row
  // (active entry whose parent party is soft-deleted) would silently
  // leak into balance computations AND 404 the legacy /receivables/[id]
  // route. Two such orphans were cleaned out of prod in 21c.2.
  //
  // Mirrors the Phase 21a softDeleteSale cascade shape (commit 2bcf16e)
  // applied to LedgerEntry. Same shape across the three party-side
  // soft-deletes (customers, suppliers, vendors) — a Party row may
  // hold multiple role flags so the cascade is single regardless of
  // which entry point soft-deletes it.
  await prisma.$transaction(async (tx) => {
    const deletedAt = new Date();
    await tx.party.update({
      where: { id, deletedAt: null },
      data: { deletedAt },
    });
    await tx.ledgerEntry.updateMany({
      where: { partyId: id, deletedAt: null },
      data: { deletedAt, deletedById: session.user.id },
    });
  });
  revalidatePath("/customers");
  revalidatePath("/ledger");
  revalidatePath("/dashboard");
  return { ok: true as const };
}
