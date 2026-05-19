"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma";

import type {
  PartyPaymentAllocation,
  PartyPaymentInput,
  PartyPaymentResult,
} from "./types";

// Party-level bulk payment (Phase 17b).
//
// Creates N payments across heterogeneous transaction kinds in a single
// Prisma transaction. The atomicity property is the whole point — the
// user picks 3 transactions to pay, types amounts, hits Save; either
// all 3 payments persist or none do.
//
// Each allocation is validated server-side against its source
// transaction's outstanding balance (refusing to create over-allocated
// payments). Validation errors return the index of the failing
// allocation so the modal can surface a per-row error.

function formatPaiseAsRupees(paise: bigint): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(paise) / 100);
}

function netPaid(
  payments: { amount: bigint; type: "PAYMENT" | "REFUND"; deletedAt: Date | null }[],
): bigint {
  return payments
    .filter((p) => p.deletedAt === null)
    .reduce(
      (s, p) => (p.type === "PAYMENT" ? s + p.amount : s - p.amount),
      0n,
    );
}

function returnTotalFn(
  returns: { refundAmount: bigint; deletedAt: Date | null }[],
): bigint {
  return returns
    .filter((r) => r.deletedAt === null)
    .reduce((s, r) => s + r.refundAmount, 0n);
}

/**
 * Role gate: which roles can pay each entity type. Mirrors the per-entity
 * payment-actions guards. Receivable (Sale) is ADMIN-only; the others
 * include PURCHASE_DEPT or CASTING_PLATING_MGMT respectively.
 */
function rolesForEntityType(t: PartyPaymentAllocation["entityType"]): Role[] {
  switch (t) {
    case "SALE":
      return ["ADMIN"];
    case "PURCHASE":
      return ["ADMIN", "PURCHASE_DEPT"];
    case "CASTING_ENTRY":
    case "PLATING_ENTRY":
      return ["ADMIN", "CASTING_PLATING_MGMT"];
  }
}

/**
 * Bulk-create payments for a list of (entityType, entityId, amount)
 * allocations. All-or-none atomicity via `prisma.$transaction`.
 *
 * The action computes the required role as the UNION of role gates per
 * allocation's entityType — so a single bulk save that mixes
 * sale + purchase requires ADMIN (the intersection of allowed sets).
 * For homogeneous bulks (all PURCHASE for example), PURCHASE_DEPT can
 * save.
 */
export async function createPartyPayment(
  input: PartyPaymentInput,
): Promise<PartyPaymentResult> {
  if (!Array.isArray(input.allocations) || input.allocations.length === 0) {
    return { ok: false, errors: { message: "No allocations selected" } };
  }

  // Role gate: intersection of roles allowed per entityType.
  const roleSets = input.allocations.map((a) => new Set(rolesForEntityType(a.entityType)));
  const intersection = roleSets.reduce<Set<Role>>(
    (acc, s) => new Set([...acc].filter((r) => s.has(r))),
    new Set(roleSets[0]),
  );
  if (intersection.size === 0) {
    return {
      ok: false,
      errors: {
        message:
          "Mixed-entity allocation requires roles that allow all entity types",
      },
    };
  }
  await requireRole([...intersection]);

  const date = input.date instanceof Date ? input.date : new Date(input.date);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, errors: { message: "Invalid date" } };
  }
  const note = input.note?.trim() || null;

  // Validate each allocation against its source transaction's
  // outstanding (or netPaid for REFUND). Collect ALL per-allocation
  // errors before failing — gives the user one round-trip per save.
  const allocErrors: Record<number, string[]> = {};
  type Plan = {
    idx: number;
    entityType: PartyPaymentAllocation["entityType"];
    entityId: string;
    amountPaise: bigint;
  };
  const plans: Plan[] = [];

  for (let i = 0; i < input.allocations.length; i++) {
    const a = input.allocations[i];
    if (!Number.isFinite(a.amount) || a.amount <= 0) {
      allocErrors[i] = ["Amount must be greater than zero"];
      continue;
    }
    const amountPaise = BigInt(Math.round(a.amount * 100));

    let total = 0n;
    let net = 0n;
    let returnTotal = 0n;
    let found = false;

    if (a.entityType === "SALE") {
      const sale = await prisma.sale.findUnique({
        where: { id: a.entityId, deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          returns: { where: { deletedAt: null } },
        },
      });
      if (sale) {
        found = true;
        total = sale.total;
        net = netPaid(sale.payments);
        returnTotal = returnTotalFn(sale.returns);
      }
    } else if (a.entityType === "PURCHASE") {
      const pu = await prisma.purchase.findUnique({
        where: { id: a.entityId, deletedAt: null },
        include: {
          payments: { where: { deletedAt: null } },
          returns: { where: { deletedAt: null } },
        },
      });
      if (pu) {
        found = true;
        total = pu.total;
        net = netPaid(pu.payments);
        returnTotal = returnTotalFn(pu.returns);
      }
    } else if (a.entityType === "CASTING_ENTRY") {
      const ce = await prisma.castingEntry.findUnique({
        where: { id: a.entityId, deletedAt: null },
        include: { payments: { where: { deletedAt: null } } },
      });
      if (ce) {
        found = true;
        total = ce.total;
        net = netPaid(ce.payments);
      }
    } else if (a.entityType === "PLATING_ENTRY") {
      const pe = await prisma.platingEntry.findUnique({
        where: { id: a.entityId, deletedAt: null },
        include: { payments: { where: { deletedAt: null } } },
      });
      if (pe) {
        found = true;
        total = pe.total;
        net = netPaid(pe.payments);
      }
    }

    if (!found) {
      allocErrors[i] = ["Transaction not found"];
      continue;
    }

    if (input.type === "PAYMENT") {
      const remaining = total - returnTotal - net;
      if (amountPaise > remaining) {
        allocErrors[i] = [
          `Exceeds remaining balance (${formatPaiseAsRupees(remaining)})`,
        ];
        continue;
      }
    } else {
      // REFUND check: can't refund more than what's been paid net so far.
      if (amountPaise > net) {
        allocErrors[i] = [
          `Refund exceeds net paid (${formatPaiseAsRupees(net)})`,
        ];
        continue;
      }
    }

    plans.push({ idx: i, entityType: a.entityType, entityId: a.entityId, amountPaise });
  }

  if (Object.keys(allocErrors).length > 0) {
    return { ok: false, errors: { allocations: allocErrors } };
  }
  if (plans.length === 0) {
    return { ok: false, errors: { message: "No valid allocations" } };
  }

  // Atomic bulk create. If any single create throws (e.g. a race
  // condition where the transaction was deleted between validation and
  // create), the whole transaction rolls back.
  await prisma.$transaction(async (tx) => {
    for (const p of plans) {
      if (p.entityType === "SALE") {
        await tx.salePayment.create({
          data: {
            saleId: p.entityId,
            date,
            amount: p.amountPaise,
            type: input.type,
            note,
          },
        });
      } else if (p.entityType === "PURCHASE") {
        await tx.purchasePayment.create({
          data: {
            purchaseId: p.entityId,
            date,
            amount: p.amountPaise,
            type: input.type,
            note,
          },
        });
      } else if (p.entityType === "CASTING_ENTRY") {
        await tx.castingPayment.create({
          data: {
            castingEntryId: p.entityId,
            date,
            amount: p.amountPaise,
            type: input.type,
            note,
          },
        });
      } else if (p.entityType === "PLATING_ENTRY") {
        await tx.platingPayment.create({
          data: {
            platingEntryId: p.entityId,
            date,
            amount: p.amountPaise,
            type: input.type,
            note,
          },
        });
      }
    }
  });

  // Revalidate every path that could display the paid transactions or
  // party rollups.
  revalidatePath("/payables");
  revalidatePath("/receivables");
  revalidatePath("/dashboard");
  revalidatePath("/sales");
  revalidatePath("/purchases");
  revalidatePath("/casting");
  revalidatePath("/plating");
  return { ok: true, created: plans.length };
}

