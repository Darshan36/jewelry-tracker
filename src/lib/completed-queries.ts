// Phase 19 — query helpers for the /completed page.
//
// Aggregates "completed" transactions across all four transactional
// entities (Sales, Purchases, Casting, Plating) plus EmployeePayments
// (which are inherently completed events — there's no in-flight state
// for a payment row).
//
// Filtering shape (shared across all five helpers):
//   - `range: { from, to }` — half-open UTC date window. Defaults
//     supplied by the caller; the /completed page defaults to the
//     current IST calendar month via startOfCurrentMonthIST() /
//     endOfCurrentMonthIST() (matching Sale/Purchase date storage
//     convention — midnight-UTC representing an IST calendar day).
//   - `partyQuery?` — optional case-insensitive substring match on
//     partyName OR partyPhone (for transactional entities) or
//     employee.name (for EmployeePayments). Empty/undefined → no
//     party filter.
//
// Completion definition:
//   - Sales / Purchases / Casting / Plating — strict `status ===
//     "completed"` after `computeTransactionStatus` runs. Status is
//     derived (CLAUDE.md §5), so we fetch in date range + party scope,
//     then filter in JS post-serialize. At ~100 tx/month the in-memory
//     filter cost is negligible; pushing into SQL would require either
//     a stored status column (rejected per §5) or a complex WHERE that
//     replicates the four-branch math.
//   - EmployeePayments — every non-deleted row is treated as a
//     completed event. Type discriminator (SALARY | WAGE) is kept on
//     the returned row for UI display.

import { prisma } from "@/lib/prisma";

import {
  serializeSale,
  type SaleForClient,
} from "@/app/(app)/sales/sale-helpers";
import {
  serializePurchase,
  type PurchaseForClient,
} from "@/app/(app)/purchases/purchase-helpers";
import {
  serializeCastingEntry,
  type CastingEntryForClient,
} from "@/app/(app)/casting/casting-helpers";
import {
  serializePlatingEntry,
  type PlatingEntryForClient,
} from "@/app/(app)/plating/plating-helpers";

import type { Prisma } from "@/generated/prisma";

export type DateRange = { from: Date; to: Date };

export type CompletedFilter = {
  range: DateRange;
  partyQuery?: string;
};

// Build a Prisma `where` filter for case-insensitive partyName OR
// partyPhone match. Returns `undefined` for empty queries so the
// caller can spread the result conditionally.
function partyFilter(query: string | undefined): Prisma.SaleWhereInput | undefined {
  const q = query?.trim();
  if (!q) return undefined;
  return {
    OR: [
      { partyName: { contains: q, mode: "insensitive" } },
      { partyPhone: { contains: q, mode: "insensitive" } },
    ],
  };
}

// --- Sales ----------------------------------------------------------

export async function getCompletedSales(
  filter: CompletedFilter,
): Promise<SaleForClient[]> {
  const partyMatch = partyFilter(filter.partyQuery);
  const rows = await prisma.sale.findMany({
    where: {
      deletedAt: null,
      date: { gte: filter.range.from, lt: filter.range.to },
      ...(partyMatch ?? {}),
    },
    orderBy: { date: "desc" },
    include: {
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });
  return rows
    .map((row) => serializeSale(row))
    .filter((s) => s.status === "completed");
}

// --- Purchases ------------------------------------------------------

export async function getCompletedPurchases(
  filter: CompletedFilter,
): Promise<PurchaseForClient[]> {
  const partyMatch = partyFilter(filter.partyQuery);
  const rows = await prisma.purchase.findMany({
    where: {
      deletedAt: null,
      date: { gte: filter.range.from, lt: filter.range.to },
      ...((partyMatch as Prisma.PurchaseWhereInput | undefined) ?? {}),
    },
    orderBy: { date: "desc" },
    include: {
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });
  // photoCount is not needed for the /completed view's column set; pass 0.
  return rows
    .map((p) => serializePurchase(p, { photoCount: 0 }))
    .filter((p) => p.status === "completed");
}

// --- Casting --------------------------------------------------------

export async function getCompletedCastingEntries(
  filter: CompletedFilter,
): Promise<CastingEntryForClient[]> {
  const partyMatch = partyFilter(filter.partyQuery);
  const rows = await prisma.castingEntry.findMany({
    where: {
      deletedAt: null,
      date: { gte: filter.range.from, lt: filter.range.to },
      ...((partyMatch as Prisma.CastingEntryWhereInput | undefined) ?? {}),
    },
    orderBy: { date: "desc" },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
      payments: true,
      party: true,
      attachment: true,
    },
  });
  return rows
    .map(serializeCastingEntry)
    .filter((e) => e.status === "completed");
}

// --- Plating --------------------------------------------------------

export async function getCompletedPlatingEntries(
  filter: CompletedFilter,
): Promise<PlatingEntryForClient[]> {
  const partyMatch = partyFilter(filter.partyQuery);
  const rows = await prisma.platingEntry.findMany({
    where: {
      deletedAt: null,
      date: { gte: filter.range.from, lt: filter.range.to },
      ...((partyMatch as Prisma.PlatingEntryWhereInput | undefined) ?? {}),
    },
    orderBy: { date: "desc" },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
      payments: true,
      party: true,
      attachment: true,
    },
  });
  return rows
    .map(serializePlatingEntry)
    .filter((e) => e.status === "completed");
}

// --- EmployeePayments ----------------------------------------------

// Lightweight client-shape for the Payroll tab. Distinct from the
// labour-page-client EmployeePayment because we need the employee name
// + type on the row itself (the /completed page doesn't carry parent
// Employee context like the /labour page does).
export type EmployeePaymentForCompleted = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeType: "FIXED" | "LABOUR";
  type: "SALARY" | "WAGE";
  paidAt: string; // ISO — date+time
  amount: number; // paise
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  note: string | null;
};

export async function getCompletedEmployeePayments(
  filter: CompletedFilter,
): Promise<EmployeePaymentForCompleted[]> {
  const q = filter.partyQuery?.trim();
  const rows = await prisma.employeePayment.findMany({
    where: {
      deletedAt: null,
      paidAt: { gte: filter.range.from, lt: filter.range.to },
      ...(q
        ? { employee: { name: { contains: q, mode: "insensitive" } } }
        : {}),
    },
    orderBy: { paidAt: "desc" },
    include: { employee: { select: { name: true, type: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    employeeId: p.employeeId,
    employeeName: p.employee.name,
    employeeType: p.employee.type,
    type: p.type,
    paidAt: p.paidAt.toISOString(),
    amount: Number(p.amount),
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    note: p.note,
  }));
}
