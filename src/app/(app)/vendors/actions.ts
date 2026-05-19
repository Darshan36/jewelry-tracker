"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { vendorInputSchema, type VendorInput } from "./schema";

// Phase 17a: Vendor data lives in the unified `Party` table with at least
// one of `isCastingVendor` / `isPlatingVendor` set. The /vendors form
// doesn't distinguish casting from plating, so newly created vendors get
// BOTH flags by default — matching the pre-Phase-17a CastingPlatingVendor
// model which was always shared. Walk-in auto-promotion in /casting/new
// or /plating/new sets only the corresponding single flag.

const VENDOR_ROLES = ["ADMIN", "CASTING_PLATING_MGMT"] as const;

export async function createVendor(input: VendorInput) {
  await requireRole([...VENDOR_ROLES]);

  const parsed = vendorInputSchema.safeParse(input);
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
      const vendor = await prisma.party.update({
        where: { id: existing.id },
        data: {
          isCastingVendor: true,
          isPlatingVendor: true,
          name: parsed.data.name,
          address: parsed.data.address ?? existing.address,
          notes: parsed.data.notes ?? existing.notes,
        },
      });
      revalidatePath("/vendors");
      return { ok: true as const, vendor };
    }
  }

  const vendor = await prisma.party.create({
    data: {
      ...parsed.data,
      isCastingVendor: true,
      isPlatingVendor: true,
    },
  });
  revalidatePath("/vendors");
  return { ok: true as const, vendor };
}

export async function updateVendor(id: string, input: VendorInput) {
  await requireRole([...VENDOR_ROLES]);

  const parsed = vendorInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const vendor = await prisma.party.update({
    where: { id, deletedAt: null },
    data: parsed.data,
  });
  revalidatePath("/vendors");
  return { ok: true as const, vendor };
}

export async function softDeleteVendor(id: string) {
  await requireRole([...VENDOR_ROLES]);

  await prisma.party.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/vendors");
  return { ok: true as const };
}
