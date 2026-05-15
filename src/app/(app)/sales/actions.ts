"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

import { saleInputSchema, type SaleInput } from "./schema";
import { serializeSale } from "./sale-helpers";

// Build the Prisma `data` payload from a validated schema parse.
//
// Three concerns live in here, all at the Prisma boundary:
//   1. Currency: rupees `number` → BigInt paise.
//   2. Snapshot integrity: if customerId is set OR auto-promoted from a phone
//      match, partyName/partyPhone are copied from the Customer row (server
//      is source of truth for FK-linked party data — the form values are
//      advisory only).
//   3. Total computation: total = qty * ratePaise - discountPaise, in BigInt.
//
// Auto-promotion (Phase 6): when `customerId` is null AND `partyPhone` is
// present, look up an existing customer by normalized phone. If found, link
// to them silently. If not found, auto-create a `Customer` row with the
// typed name + phone (other fields null) and link to it. Walk-ins without
// phone stay as walk-ins (`customerId` remains null; snapshot strings only).
// Both lookup and create happen on the transaction client `tx`, so the whole
// build + sale-create is atomic — if anything fails, no partial state lands.
//
// Returns either a Prisma data payload OR an `errors` shape.
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
  tx: Prisma.TransactionClient,
  parsed: SaleInput,
): Promise<
  | { ok: true; data: BuiltSaleData }
  | { ok: false; errors: Record<string, string[]> }
> {
  let customerId = parsed.customerId;
  let partyName = parsed.partyName;
  let partyPhone = parsed.partyPhone;

  if (customerId !== null) {
    // Explicit FK from the form — snapshot from the live customer row.
    const customer = await tx.customer.findUnique({
      where: { id: customerId, deletedAt: null },
    });
    if (!customer) {
      return {
        ok: false,
        errors: { customerId: ["Customer not found"] },
      };
    }
    partyName = customer.name;
    partyPhone = customer.phone;
  } else if (partyPhone !== null) {
    // Walk-in with a phone — auto-promote. Schema has already normalized
    // partyPhone, so the lookup compares clean-to-clean.
    const existing = await tx.customer.findFirst({
      where: { phone: partyPhone, deletedAt: null },
    });

    if (existing) {
      customerId = existing.id;
      partyName = existing.name;
      partyPhone = existing.phone;
    } else {
      const created = await tx.customer.create({
        data: {
          name: partyName,
          phone: partyPhone,
          email: null,
          address: null,
          notes: null,
        },
      });
      customerId = created.id;
      partyName = created.name;
      partyPhone = created.phone;
    }
  }
  // else: walk-in with no phone — snapshot-only, customerId stays null.

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
      customerId,
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
  await requireRole(["ADMIN"]);

  const parsed = saleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // Atomic: auto-promotion lookup/create + sale create live or die together.
  const result = await prisma.$transaction(async (tx) => {
    const built = await buildSaleData(tx, parsed.data);
    if (!built.ok) return built;
    const created = await tx.sale.create({ data: built.data });
    return { ok: true as const, sale: created };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePath("/sales");
  if (result.sale.customerId !== null) revalidatePath("/customers");
  return { ok: true as const, sale: serializeSale(result.sale) };
}

export async function updateSale(id: string, input: SaleInput) {
  await requireRole(["ADMIN"]);

  const parsed = saleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const built = await buildSaleData(tx, parsed.data);
    if (!built.ok) return built;
    const updated = await tx.sale.update({
      where: { id, deletedAt: null },
      data: built.data,
    });
    return { ok: true as const, sale: updated };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePath("/sales");
  if (result.sale.customerId !== null) revalidatePath("/customers");
  return { ok: true as const, sale: serializeSale(result.sale) };
}

export async function softDeleteSale(id: string) {
  await requireRole(["ADMIN"]);

  await prisma.sale.update({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  revalidatePath("/sales");
  return { ok: true as const };
}
