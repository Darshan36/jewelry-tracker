"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";

import { saleInputSchema, type SaleInput } from "./schema";
import { serializeSale } from "./sale-helpers";

// Build the Prisma `data` payload from a validated schema parse.
//
// Phase 7: line items moved to a child table. The parent `Sale` no longer
// carries `qty`, `rate`, or `itemDescription`; instead each `lineItems[i]`
// becomes a `SaleLineItem` row. Total is computed as `SUM(qty × rate) -
// discount` in BigInt paise and persisted on the Sale row (stored-not-derived
// discipline preserved). Discount-exceeds-subtotal is rejected at the action
// layer because the validation needs the parsed numbers in scope.
//
// Auto-promotion (Phase 6) still runs here: when `customerId` is null but
// `partyPhone` is non-null, the action either links to or auto-creates the
// Customer. The whole flow (party lookup/create + Sale create + line item
// creates) runs inside `prisma.$transaction`.

type BuiltSaleData = {
  date: Date;
  customerId: string | null;
  partyName: string;
  partyPhone: string | null;
  discount: bigint;
  total: bigint;
  notes: string | null;
  lineItemCreates: Array<{
    itemDescription: string;
    qty: number;
    rate: bigint;
  }>;
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

  // Compute subtotal across line items, in BigInt paise.
  const lineItemCreates = parsed.lineItems.map((line) => ({
    itemDescription: line.itemDescription,
    qty: line.qty,
    rate: BigInt(Math.round(line.rate * 100)),
  }));
  const subtotal = lineItemCreates.reduce(
    (sum, line) => sum + BigInt(line.qty) * line.rate,
    0n,
  );
  const discountPaise = BigInt(Math.round(parsed.discount * 100));

  if (discountPaise > subtotal) {
    return {
      ok: false,
      errors: { discount: ["Discount cannot exceed line item subtotal"] },
    };
  }

  const total = subtotal - discountPaise;

  return {
    ok: true,
    data: {
      date: parsed.date,
      customerId,
      partyName,
      partyPhone,
      discount: discountPaise,
      total,
      notes: parsed.notes,
      lineItemCreates,
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

  const result = await prisma.$transaction(async (tx) => {
    const built = await buildSaleData(tx, parsed.data);
    if (!built.ok) return built;
    const { lineItemCreates, ...saleData } = built.data;
    const created = await tx.sale.create({
      data: {
        ...saleData,
        lineItems: { create: lineItemCreates },
      },
      include: { lineItems: { orderBy: { createdAt: "asc" } } },
    });
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
    const { lineItemCreates, ...saleData } = built.data;
    // Hard-delete the existing line items, then recreate the full new set.
    // Line items are subordinate to the parent (no soft-delete) — see
    // Phase 7 locked decision Q6.
    await tx.saleLineItem.deleteMany({ where: { saleId: id } });
    const updated = await tx.sale.update({
      where: { id, deletedAt: null },
      data: {
        ...saleData,
        lineItems: { create: lineItemCreates },
      },
      include: { lineItems: { orderBy: { createdAt: "asc" } } },
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
