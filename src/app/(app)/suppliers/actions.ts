"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { assertPartyHasRole } from "@/lib/party-roles";
import { prisma } from "@/lib/prisma";

import { supplierInputSchema, type SupplierInput } from "./schema";

// Phase 17a: Supplier data is now stored in the unified `Party` table with
// `isSupplier = true`. See customers/actions.ts for the pattern rationale.

export async function createSupplier(input: SupplierInput) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  const parsed = supplierInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  if (parsed.data.phone) {
    const existing = await prisma.party.findUnique({
      where: { phone: parsed.data.phone },
    });
    if (existing && existing.deletedAt === null) {
      const supplier = await prisma.party.update({
        where: { id: existing.id },
        data: {
          isSupplier: true,
          name: parsed.data.name,
          email: parsed.data.email ?? existing.email,
          address: parsed.data.address ?? existing.address,
          notes: parsed.data.notes ?? existing.notes,
        },
      });
      revalidatePath("/suppliers");
      return { ok: true as const, supplier };
    }
  }

  const partyData = { ...parsed.data, isSupplier: true };
  assertPartyHasRole(partyData);
  const supplier = await prisma.party.create({ data: partyData });
  revalidatePath("/suppliers");
  return { ok: true as const, supplier };
}

export async function updateSupplier(id: string, input: SupplierInput) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  const parsed = supplierInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supplier = await prisma.party.update({
    where: { id, deletedAt: null },
    data: parsed.data,
  });
  revalidatePath("/suppliers");
  return { ok: true as const, supplier };
}

export async function softDeleteSupplier(id: string) {
  await requireRole(["ADMIN", "PURCHASE_DEPT"]);

  await prisma.party.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/suppliers");
  return { ok: true as const };
}
