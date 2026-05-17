"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { vendorInputSchema, type VendorInput } from "./schema";

// Role gate for every vendor mutation: ADMIN or CASTING_PLATING_MGMT.
// Vendors are shared by casting and plating, so the role rule is
// symmetric — anyone who can edit casting can edit vendors and vice
// versa. ADMIN passes through as always.
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

  const vendor = await prisma.castingPlatingVendor.create({
    data: parsed.data,
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

  const vendor = await prisma.castingPlatingVendor.update({
    where: { id, deletedAt: null },
    data: parsed.data,
  });
  revalidatePath("/vendors");
  return { ok: true as const, vendor };
}

export async function softDeleteVendor(id: string) {
  await requireRole([...VENDOR_ROLES]);

  await prisma.castingPlatingVendor.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/vendors");
  return { ok: true as const };
}
