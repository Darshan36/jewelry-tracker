"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { supplierInputSchema, type SupplierInput } from "./schema";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

export async function createSupplier(input: SupplierInput) {
  await requireSession();

  const parsed = supplierInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supplier = await prisma.supplier.create({ data: parsed.data });
  revalidatePath("/suppliers");
  return { ok: true as const, supplier };
}

export async function updateSupplier(id: string, input: SupplierInput) {
  await requireSession();

  const parsed = supplierInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // The schema's `.nullish().transform(... ? null : v)` guarantees parsed
  // values for cleared fields are `null` (not `undefined`), so Prisma
  // actually sets the column to NULL rather than skipping it. See the
  // schema comment above for the rationale.
  const supplier = await prisma.supplier.update({
    where: { id, deletedAt: null },
    data: parsed.data,
  });
  revalidatePath("/suppliers");
  return { ok: true as const, supplier };
}

export async function softDeleteSupplier(id: string) {
  await requireSession();

  await prisma.supplier.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/suppliers");
  return { ok: true as const };
}
