"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";

import { saleInputSchema, type SaleInput } from "./schema";
import { serializeSale } from "./sale-helpers";

// Build the Prisma `data` payload from a validated schema parse.
//
// Three concerns live in here, all at the Prisma boundary:
//   1. Currency: rupees `number` → BigInt paise.
//   2. Snapshot integrity: if customerId is set, partyName/partyPhone are
//      copied from the Customer row (server is source of truth for FK-linked
//      party data — the form values are advisory only).
//   3. Total computation: total = qty * ratePaise - discountPaise, in BigInt.
//
// Returns either a Prisma data payload OR an `errors` shape (customer
// missing, discount-exceeds-total). The caller handles both.
type BuiltSaleData = {
  date: Date;
  customerId: string | null;
  partyName: string;
  partyPhone: string | null;
  itemDescription: string;
  qty: number;
  rate: bigint;
  discount: bigint;
  total: bigint;
  notes: string | null;
};

async function buildSaleData(
  parsed: SaleInput,
): Promise<
  | { ok: true; data: BuiltSaleData }
  | { ok: false; errors: Record<string, string[]> }
> {
  let partyName = parsed.partyName;
  let partyPhone = parsed.partyPhone;

  if (parsed.customerId !== null) {
    const customer = await prisma.customer.findUnique({
      where: { id: parsed.customerId, deletedAt: null },
    });
    if (!customer) {
      return {
        ok: false,
        errors: { customerId: ["Customer not found"] },
      };
    }
    partyName = customer.name;
    partyPhone = customer.phone;
  }

  const ratePaise = BigInt(Math.round(parsed.rate * 100));
  const discountPaise = BigInt(Math.round(parsed.discount * 100));
  const total = BigInt(parsed.qty) * ratePaise - discountPaise;

  if (total < 0n) {
    return {
      ok: false,
      errors: { discount: ["Discount cannot exceed line total"] },
    };
  }

  return {
    ok: true,
    data: {
      date: parsed.date,
      customerId: parsed.customerId,
      partyName,
      partyPhone,
      itemDescription: parsed.itemDescription,
      qty: parsed.qty,
      rate: ratePaise,
      discount: discountPaise,
      total,
      notes: parsed.notes,
    },
  };
}

export async function createSale(input: SaleInput) {
  await requireSession();

  const parsed = saleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const built = await buildSaleData(parsed.data);
  if (!built.ok) {
    return { ok: false as const, errors: built.errors };
  }

  const created = await prisma.sale.create({ data: built.data });
  revalidatePath("/sales");
  return { ok: true as const, sale: serializeSale(created) };
}

export async function updateSale(id: string, input: SaleInput) {
  await requireSession();

  const parsed = saleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const built = await buildSaleData(parsed.data);
  if (!built.ok) {
    return { ok: false as const, errors: built.errors };
  }

  const updated = await prisma.sale.update({
    where: { id, deletedAt: null },
    data: built.data,
  });
  revalidatePath("/sales");
  return { ok: true as const, sale: serializeSale(updated) };
}

export async function softDeleteSale(id: string) {
  await requireSession();

  await prisma.sale.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/sales");
  return { ok: true as const };
}
