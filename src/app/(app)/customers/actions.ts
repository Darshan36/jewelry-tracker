"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { customerInputSchema, type CustomerInput } from "./schema";

async function requireSession() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

export async function createCustomer(input: CustomerInput) {
  await requireSession();

  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const customer = await prisma.customer.create({ data: parsed.data });
  revalidatePath("/customers");
  return { ok: true as const, customer };
}

export async function updateCustomer(id: string, input: CustomerInput) {
  await requireSession();

  const parsed = customerInputSchema.safeParse(input);
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
  const customer = await prisma.customer.update({
    where: { id, deletedAt: null },
    data: parsed.data,
  });
  revalidatePath("/customers");
  return { ok: true as const, customer };
}

export async function softDeleteCustomer(id: string) {
  await requireSession();

  await prisma.customer.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/customers");
  return { ok: true as const };
}
