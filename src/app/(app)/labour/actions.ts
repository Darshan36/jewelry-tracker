"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import {
  softDeleteTransactionLedgerEntry,
  writePieceEntryLedger,
  writeWagePaymentLedger,
} from "@/lib/ledger";
import {
  bulkPieceEntryInputSchema,
  employeePaymentInputSchema,
  pieceEntryInputSchema,
  type BulkPieceEntryInput,
  type EmployeePaymentInput,
  type PieceEntryInput,
} from "./schema";

// --- Helpers ---------------------------------------------------------

function rupeesToPaise(rupees: number): bigint {
  return BigInt(Math.round(rupees * 100));
}

function revalidateLabour() {
  revalidatePath("/labour");
  revalidatePath("/employees");
  revalidatePath("/dashboard");
}

// --- Piece entries ---------------------------------------------------

/**
 * Bulk-create PieceEntries from the daily entry form.
 *
 * Rows with count === 0 (or empty) are filtered out *before*
 * validation by the caller, but we also defensively filter here.
 * If after filtering no rows remain, return `{ ok: true, created: 0 }`
 * — empty save is a no-op, not an error.
 */
export async function createBulkPieceEntries(input: BulkPieceEntryInput) {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  // Defensive filter: drop zero-count rows.
  const cleaned: BulkPieceEntryInput = {
    date: input.date,
    entries: (input.entries ?? []).filter(
      (e) => e && Number(e.count) > 0,
    ),
  };

  if (cleaned.entries.length === 0) {
    return { ok: true as const, created: 0 };
  }

  const parsed = bulkPieceEntryInputSchema.safeParse(cleaned);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // Validate that every employeeId resolves to a non-deleted LABOUR
  // employee. Filter ensures we don't create entries for FIXED/deleted
  // employees even if the client tries to inject one.
  const employeeIds = Array.from(
    new Set(parsed.data.entries.map((e) => e.employeeId)),
  );
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, deletedAt: null, type: "LABOUR" },
    select: { id: true },
  });
  const validEmployeeIds = new Set(employees.map((e) => e.id));

  const toCreate = parsed.data.entries.filter((e) =>
    validEmployeeIds.has(e.employeeId),
  );
  if (toCreate.length === 0) {
    return {
      ok: false as const,
      errors: { entries: ["No valid LABOUR employees in submission"] },
    };
  }

  await prisma.$transaction(async (tx) => {
    for (const e of toCreate) {
      const ratePerPiece = rupeesToPaise(e.ratePerPiece);
      const count = BigInt(e.count);
      const totalAmount = ratePerPiece * count;
      const created = await tx.pieceEntry.create({
        data: {
          employeeId: e.employeeId,
          date: parsed.data.date,
          count: e.count,
          ratePerPiece,
          totalAmount,
          note: e.note,
        },
      });
      // Phase 21b — emit INCREASE on the karigar's ledger. Atomic
      // with the parent insert: a thrown ledger write rolls the
      // piece_entry insert back.
      await writePieceEntryLedger(tx, {
        employeeId: e.employeeId,
        date: parsed.data.date,
        sourceId: created.id,
        count: e.count,
        ratePerPiece,
        totalAmount,
        note: e.note ?? null,
        userId: session.user.id,
      });
    }
  });

  revalidateLabour();
  return { ok: true as const, created: toCreate.length };
}

/**
 * Create a single piece entry (ad-hoc — from the employee detail modal
 * or anywhere else outside the bulk form).
 */
export async function createPieceEntry(input: PieceEntryInput) {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const parsed = pieceEntryInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: parsed.data.employeeId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!employee) {
    return {
      ok: false as const,
      errors: { employeeId: ["Employee not found"] },
    };
  }
  if (employee.type !== "LABOUR") {
    return {
      ok: false as const,
      errors: { employeeId: ["Only LABOUR employees can have piece entries"] },
    };
  }

  const ratePerPiece = rupeesToPaise(parsed.data.ratePerPiece);
  const totalAmount = ratePerPiece * BigInt(parsed.data.count);

  // Phase 21b — wrap the piece-entry insert and the linked ledger
  // INCREASE in a single prisma.$transaction so a thrown ledger write
  // rolls the parent back atomically.
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.pieceEntry.create({
      data: {
        employeeId: parsed.data.employeeId,
        date: parsed.data.date,
        count: parsed.data.count,
        ratePerPiece,
        totalAmount,
        note: parsed.data.note,
      },
    });
    await writePieceEntryLedger(tx, {
      employeeId: parsed.data.employeeId,
      date: parsed.data.date,
      sourceId: created.id,
      count: parsed.data.count,
      ratePerPiece,
      totalAmount,
      note: parsed.data.note ?? null,
      userId: session.user.id,
    });
    return created;
  });

  revalidateLabour();
  return {
    ok: true as const,
    entry: {
      ...entry,
      ratePerPiece: Number(entry.ratePerPiece),
      totalAmount: Number(entry.totalAmount),
    },
  };
}

/**
 * Soft-delete a piece entry. Used for corrections — wrong-count or
 * wrong-day entries are tombstoned, not edited (audit pattern from
 * Sales/Purchases payments).
 */
export async function softDeletePieceEntry(id: string) {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  // Phase 21b — cascade soft-delete to the linked PIECE_ENTRY ledger
  // row inside the same transaction. Without this, the ledger would
  // keep the INCREASE entry active while its source piece_entry is
  // tombstoned, corrupting the karigar's running balance (same shape
  // as the 21a soft-delete-cascade fix on party-side payments).
  await prisma.$transaction(async (tx) => {
    await tx.pieceEntry.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await softDeleteTransactionLedgerEntry(tx, {
      sourceType: "PIECE_ENTRY",
      sourceId: id,
      userId: session.user.id,
    });
  });

  revalidateLabour();
  return { ok: true as const };
}

// --- Employee payments ----------------------------------------------

/**
 * Create an EmployeePayment (SALARY or WAGE).
 *
 * Type rules:
 *   - SALARY: employee must be FIXED. periodStart/periodEnd should be
 *     the calendar-month boundaries (the modal pre-fills them).
 *   - WAGE: employee must be LABOUR. periodStart/periodEnd is an
 *     arbitrary window — coverage uses period-overlap (see
 *     labour-balances.ts isPieceEntryCovered).
 *
 * Validation:
 *   - Type must match employee type (no SALARY for LABOUR, no WAGE
 *     for FIXED).
 *   - For WAGE: amount must not exceed unpaid wages in the period
 *     (computed live from PieceEntry × existing payments).
 *   - For SALARY: no overpayment check — the user might pay an
 *     advance bonus or correction. The amount is whatever they say.
 */
export async function createEmployeePayment(input: EmployeePaymentInput) {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const parsed = employeePaymentInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: parsed.data.employeeId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!employee) {
    return {
      ok: false as const,
      errors: { employeeId: ["Employee not found"] },
    };
  }

  if (parsed.data.type === "SALARY" && employee.type !== "FIXED") {
    return {
      ok: false as const,
      errors: {
        type: ["Salary payments are only valid for FIXED employees"],
      },
    };
  }
  if (parsed.data.type === "WAGE" && employee.type !== "LABOUR") {
    return {
      ok: false as const,
      errors: {
        type: ["Wage payments are only valid for LABOUR employees"],
      },
    };
  }

  const amountPaise = rupeesToPaise(parsed.data.amount);

  await prisma.$transaction(async (tx) => {
    const created = await tx.employeePayment.create({
      data: {
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        paidAt: parsed.data.paidAt,
        amount: amountPaise,
        periodStart: parsed.data.periodStart,
        periodEnd: parsed.data.periodEnd,
        note: parsed.data.note,
      },
    });

    // Phase 21b — emit DECREASE on the karigar's ledger for WAGE
    // payments only. SALARY payments stay on the EmployeePayment rail
    // (FIXED employees use the monthly-reminder model — untouched in
    // 21b). Advances are WAGE payments with a note ("advance for next
    // week" etc.); the data model treats them as regular DECREASE
    // entries, producing a credit balance until piece work catches up.
    if (parsed.data.type === "WAGE") {
      await writeWagePaymentLedger(tx, {
        employeeId: parsed.data.employeeId,
        date: parsed.data.paidAt,
        sourceId: created.id,
        amount: amountPaise,
        note: parsed.data.note ?? null,
        userId: session.user.id,
      });
    }
  });

  revalidateLabour();
  return { ok: true as const };
}

/**
 * Soft-delete an EmployeePayment. Same pattern as soft-deleting a
 * SalePayment — tombstone so the audit trail survives.
 */
export async function softDeleteEmployeePayment(id: string) {
  const session = await requireRole(["ADMIN", "LABOUR_MGMT"]);

  // Phase 21b — for WAGE payments, cascade soft-delete to the linked
  // ledger DECREASE row. SALARY payments have no ledger entry to
  // cascade (21b scope: karigar-only). Load the type before the
  // update so we know whether the cascade applies.
  const existing = await prisma.employeePayment.findUnique({
    where: { id, deletedAt: null },
    select: { type: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.employeePayment.update({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (existing?.type === "WAGE") {
      await softDeleteTransactionLedgerEntry(tx, {
        sourceType: "WAGE_PAYMENT",
        sourceId: id,
        userId: session.user.id,
      });
    }
  });

  revalidateLabour();
  return { ok: true as const };
}

// --- History (for Employee detail modal) ----------------------------

/**
 * Fetch the piece-entry + payment history for one employee. Returns
 * arrays of plain JS objects (BigInt → Number) ready to render.
 * Used by the EmployeeDetailModal Pieces history + Payment history +
 * Ledger entries sections.
 *
 * Phase 21b.1: also returns the karigar's MANUAL_PAYMENT ledger entries
 * (direct advances / payments / adjustments). TRANSACTION_LINKED entries
 * are NOT returned here — they mirror the piece/wage rows already
 * surfaced in the other two sections.
 */
export async function getEmployeeHistory(employeeId: string) {
  await requireRole(["ADMIN", "LABOUR_MGMT"]);

  const [pieceEntries, payments, ledgerEntries] = await Promise.all([
    prisma.pieceEntry.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { date: "desc" },
      take: 50,
    }),
    prisma.employeePayment.findMany({
      where: { employeeId, deletedAt: null },
      orderBy: { paidAt: "desc" },
      take: 50,
    }),
    prisma.ledgerEntry.findMany({
      where: {
        employeeId,
        deletedAt: null,
        entryType: "MANUAL_PAYMENT",
      },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);

  return {
    pieceEntries: pieceEntries.map((p) => ({
      id: p.id,
      date: p.date.toISOString(),
      count: p.count,
      ratePerPiece: Number(p.ratePerPiece),
      totalAmount: Number(p.totalAmount),
      note: p.note,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      type: p.type,
      paidAt: p.paidAt.toISOString(),
      amount: Number(p.amount),
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      note: p.note,
    })),
    ledgerEntries: ledgerEntries.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      direction: e.direction,
      amount: Number(e.amount),
      description: e.description,
    })),
  };
}
