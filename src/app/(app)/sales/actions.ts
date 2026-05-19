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
// Phase 17a: walk-in auto-promotion now operates on the unified `Party`
// model. When `partyId` is null but `partyPhone` is non-null, the action
// either links to an existing Party (matched by phone) and sets the
// `isCustomer` flag if missing, or creates a new Party with `isCustomer =
// true`. The whole flow (party lookup/upsert + Sale create + line item
// creates) runs inside `prisma.$transaction`.

type BuiltSaleData = {
  date: Date;
  partyId: string | null;
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
  | { ok: true; data: BuiltSaleData; partyCreatedOrUpdated: boolean }
  | { ok: false; errors: Record<string, string[]> }
> {
  let partyId = parsed.partyId;
  let partyName = parsed.partyName;
  let partyPhone = parsed.partyPhone;
  let partyCreatedOrUpdated = false;

  if (partyId !== null) {
    const party = await tx.party.findUnique({
      where: { id: partyId, deletedAt: null },
    });
    if (!party) {
      return {
        ok: false,
        errors: { partyId: ["Party not found"] },
      };
    }
    // If the user picked a party that doesn't yet have the customer
    // flag (e.g. a supplier-only party), flip the flag — they now
    // transact as a customer too.
    if (!party.isCustomer) {
      await tx.party.update({
        where: { id: party.id },
        data: { isCustomer: true },
      });
      partyCreatedOrUpdated = true;
    }
    partyName = party.name;
    partyPhone = party.phone;
  } else if (partyPhone !== null) {
    const existing = await tx.party.findFirst({
      where: { phone: partyPhone, deletedAt: null },
    });

    if (existing) {
      if (!existing.isCustomer) {
        await tx.party.update({
          where: { id: existing.id },
          data: { isCustomer: true },
        });
        partyCreatedOrUpdated = true;
      }
      partyId = existing.id;
      partyName = existing.name;
      partyPhone = existing.phone;
    } else {
      const created = await tx.party.create({
        data: {
          name: partyName,
          phone: partyPhone,
          email: null,
          address: null,
          notes: null,
          isCustomer: true,
        },
      });
      partyId = created.id;
      partyName = created.name;
      partyPhone = created.phone;
      partyCreatedOrUpdated = true;
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
    partyCreatedOrUpdated,
    data: {
      date: parsed.date,
      partyId,
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
    return {
      ok: true as const,
      sale: created,
      partyCreatedOrUpdated: built.partyCreatedOrUpdated,
    };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePath("/sales");
  if (result.partyCreatedOrUpdated) revalidatePath("/customers");
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
    return {
      ok: true as const,
      sale: updated,
      partyCreatedOrUpdated: built.partyCreatedOrUpdated,
    };
  });

  if (!result.ok) {
    return { ok: false as const, errors: result.errors };
  }

  revalidatePath("/sales");
  if (result.partyCreatedOrUpdated) revalidatePath("/customers");
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
