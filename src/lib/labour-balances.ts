// Outstanding-wages and missing-salary helpers (Phase 18).
//
// Mirrors the Phase 17b `outstanding-balances.ts` pattern: pure
// per-employee math at the top + DB-querying aggregators at the
// bottom. Currency stays as `bigint` paise through the aggregation;
// only the page renderers convert to Number for display.
//
// "Outstanding wages" model:
//   A LABOUR employee accumulates piece work via PieceEntry rows.
//   Each WAGE-type EmployeePayment covers a [periodStart, periodEnd]
//   window. A PieceEntry is "covered" iff there exists at least one
//   non-deleted WAGE payment whose period contains the entry's date.
//   Coverage is by period overlap (NOT a per-entry flag) — this
//   decouples production tracking from payment tracking and lets the
//   user record a single payment for a range of days without
//   touching the underlying piece data.
//
// "Missing salary this month" model:
//   For each FIXED employee, check if any non-deleted SALARY-type
//   EmployeePayment exists with periodStart in the current IST month.

import { prisma } from "@/lib/prisma";
import type {
  Employee,
  EmployeePayment,
  PieceEntry,
} from "@/generated/prisma";
import {
  currentIstYearMonth,
  endOfMonthIST,
  formatMonthIST,
  startOfMonthIST,
} from "@/lib/format";

// --- Pure helpers ----------------------------------------------------

type PieceEntryLike = {
  id: string;
  date: Date;
  totalAmount: bigint;
  count: number;
  deletedAt: Date | null;
};

type WagePaymentLike = {
  type: "SALARY" | "WAGE";
  periodStart: Date;
  periodEnd: Date;
  deletedAt: Date | null;
};

type SalaryPaymentLike = {
  type: "SALARY" | "WAGE";
  periodStart: Date;
  deletedAt: Date | null;
};

/**
 * True iff the given moment falls within the half-open
 * [periodStart, periodEnd] inclusive range. The check is inclusive on
 * both ends — a payment for "May 1 to May 31" covers a piece entry
 * dated either May 1 OR May 31.
 */
export function isDateInPeriod(
  date: Date,
  periodStart: Date,
  periodEnd: Date,
): boolean {
  const t = date.getTime();
  return t >= periodStart.getTime() && t <= periodEnd.getTime();
}

/**
 * True iff any non-deleted WAGE-type payment's period covers this
 * piece entry's date.
 */
export function isPieceEntryCovered(
  entry: PieceEntryLike,
  payments: WagePaymentLike[],
): boolean {
  for (const p of payments) {
    if (p.deletedAt !== null) continue;
    if (p.type !== "WAGE") continue;
    if (isDateInPeriod(entry.date, p.periodStart, p.periodEnd)) return true;
  }
  return false;
}

/**
 * Reduce per-employee piece entries + wage payments to a single
 * outstanding-wages bundle. Pure function — no DB. Used by the
 * aggregator below and by tests.
 */
export function computeOutstandingWages(
  entries: PieceEntryLike[],
  payments: WagePaymentLike[],
): {
  unpaidEntries: PieceEntryLike[];
  totalPieces: number;
  totalAmount: bigint;
  earliestUnpaidDate: Date | null;
} {
  const unpaidEntries: PieceEntryLike[] = [];
  let totalPieces = 0;
  let totalAmount = 0n;
  let earliestUnpaidDate: Date | null = null;

  for (const e of entries) {
    if (e.deletedAt !== null) continue;
    if (isPieceEntryCovered(e, payments)) continue;
    unpaidEntries.push(e);
    totalPieces += e.count;
    totalAmount += e.totalAmount;
    if (earliestUnpaidDate === null || e.date < earliestUnpaidDate) {
      earliestUnpaidDate = e.date;
    }
  }

  return { unpaidEntries, totalPieces, totalAmount, earliestUnpaidDate };
}

/**
 * True iff there's a non-deleted SALARY-type payment whose
 * periodStart falls inside [monthStart, monthEnd). Uses periodStart
 * as the anchor (matches how we set it: midnight-UTC on the 1st of
 * the month being paid).
 */
export function isMonthSalaryPaid(
  payments: SalaryPaymentLike[],
  monthStart: Date,
  monthEnd: Date,
): boolean {
  for (const p of payments) {
    if (p.deletedAt !== null) continue;
    if (p.type !== "SALARY") continue;
    const t = p.periodStart.getTime();
    if (t >= monthStart.getTime() && t < monthEnd.getTime()) return true;
  }
  return false;
}

// --- DB aggregators --------------------------------------------------

export type OutstandingWagesForEmployee = {
  employee: SerializedEmployee;
  totalPieces: number;
  totalAmount: number; // paise, Number for JSON safety
  earliestUnpaidDate: Date | null;
  unpaidEntries: SerializedPieceEntry[];
};

export type EmployeeWagesRollup = {
  employee: SerializedEmployee;
  totalAmount: number; // paise
  totalPieces: number;
  earliestUnpaidDate: Date | null;
};

export type MissingSalaryEmployee = {
  employee: SerializedEmployee;
  monthlySalary: number; // paise (must be non-null for FIXED to appear here)
  currentMonth: string; // "May 2026"
};

export type SerializedEmployee = Omit<
  Employee,
  "monthlySalary" | "ratePerPiece"
> & {
  monthlySalary: number | null;
  ratePerPiece: number | null;
};

export type SerializedPieceEntry = Omit<
  PieceEntry,
  "ratePerPiece" | "totalAmount"
> & {
  ratePerPiece: number;
  totalAmount: number;
};

export type SerializedEmployeePayment = Omit<EmployeePayment, "amount"> & {
  amount: number;
};

function serializeEmployee(e: Employee): SerializedEmployee {
  return {
    ...e,
    monthlySalary: e.monthlySalary === null ? null : Number(e.monthlySalary),
    ratePerPiece: e.ratePerPiece === null ? null : Number(e.ratePerPiece),
  };
}

function serializePieceEntry(p: PieceEntry): SerializedPieceEntry {
  return {
    ...p,
    ratePerPiece: Number(p.ratePerPiece),
    totalAmount: Number(p.totalAmount),
  };
}

function serializeEmployeePayment(
  p: EmployeePayment,
): SerializedEmployeePayment {
  return {
    ...p,
    amount: Number(p.amount),
  };
}

/**
 * Per-employee outstanding-wages detail. Returns null if the employee
 * doesn't exist or isn't a LABOUR-type. Used by the EmployeePaymentModal
 * for pre-filling the wage amount.
 */
export async function getOutstandingWages(
  employeeId: string,
): Promise<OutstandingWagesForEmployee | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId, deletedAt: null },
    include: {
      pieceEntries: {
        where: { deletedAt: null },
        orderBy: { date: "asc" },
      },
      payments: {
        where: { deletedAt: null, type: "WAGE" },
      },
    },
  });
  if (!employee) return null;
  if (employee.type !== "LABOUR") {
    return {
      employee: serializeEmployee(employee),
      totalPieces: 0,
      totalAmount: 0,
      earliestUnpaidDate: null,
      unpaidEntries: [],
    };
  }

  const result = computeOutstandingWages(
    employee.pieceEntries,
    employee.payments,
  );

  return {
    employee: serializeEmployee(employee),
    totalPieces: result.totalPieces,
    totalAmount: Number(result.totalAmount),
    earliestUnpaidDate: result.earliestUnpaidDate,
    unpaidEntries: result.unpaidEntries.map((e) =>
      serializePieceEntry(e as PieceEntry),
    ),
  };
}

/**
 * All LABOUR employees with > 0 outstanding wages. Sorted by total
 * descending. Each row is the minimum rollup needed for the
 * /labour page's Section 2 (and the dashboard card hint).
 */
export async function listEmployeesWithOutstandingWages(): Promise<
  EmployeeWagesRollup[]
> {
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, type: "LABOUR" },
    include: {
      pieceEntries: { where: { deletedAt: null } },
      payments: { where: { deletedAt: null, type: "WAGE" } },
    },
    orderBy: { name: "asc" },
  });

  const rollups: EmployeeWagesRollup[] = [];
  for (const emp of employees) {
    const r = computeOutstandingWages(emp.pieceEntries, emp.payments);
    if (r.totalAmount === 0n) continue;
    rollups.push({
      employee: serializeEmployee(emp),
      totalAmount: Number(r.totalAmount),
      totalPieces: r.totalPieces,
      earliestUnpaidDate: r.earliestUnpaidDate,
    });
  }
  rollups.sort((a, b) => b.totalAmount - a.totalAmount);
  return rollups;
}

/**
 * All FIXED employees without a SALARY-type payment recorded for the
 * current IST calendar month. Used by /labour Section 1 + the
 * dashboard reminder card. Employees with `monthlySalary === null`
 * are skipped (salary not configured yet → can't owe a missing
 * payment).
 */
export async function listEmployeesMissingSalaryThisMonth(): Promise<
  MissingSalaryEmployee[]
> {
  const { year, month } = currentIstYearMonth();
  const monthStart = startOfMonthIST(year, month);
  const monthEnd = endOfMonthIST(year, month);
  const monthLabel = formatMonthIST(monthStart);

  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, type: "FIXED", monthlySalary: { not: null } },
    include: {
      payments: {
        where: { deletedAt: null, type: "SALARY" },
        select: {
          type: true,
          periodStart: true,
          deletedAt: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const missing: MissingSalaryEmployee[] = [];
  for (const emp of employees) {
    if (emp.monthlySalary === null) continue;
    if (isMonthSalaryPaid(emp.payments, monthStart, monthEnd)) continue;
    missing.push({
      employee: serializeEmployee(emp),
      monthlySalary: Number(emp.monthlySalary),
      currentMonth: monthLabel,
    });
  }
  return missing;
}

/**
 * Summary numbers for the dashboard cards. Aggregates across
 * `listEmployeesMissingSalaryThisMonth` and
 * `listEmployeesWithOutstandingWages` without round-tripping their
 * full result arrays.
 */
export async function getLabourSummary(): Promise<{
  missingSalaryCount: number;
  missingSalaryTotal: number; // paise
  outstandingWagesCount: number;
  outstandingWagesTotal: number; // paise
}> {
  const [missing, outstanding] = await Promise.all([
    listEmployeesMissingSalaryThisMonth(),
    listEmployeesWithOutstandingWages(),
  ]);
  return {
    missingSalaryCount: missing.length,
    missingSalaryTotal: missing.reduce((s, m) => s + m.monthlySalary, 0),
    outstandingWagesCount: outstanding.length,
    outstandingWagesTotal: outstanding.reduce((s, r) => s + r.totalAmount, 0),
  };
}

/**
 * Piece-entry count for a given day. Powers the LABOUR_MGMT
 * dashboard's "Pieces entered today" stat.
 */
export async function countPieceEntriesForIstDay(
  isoDay: string,
): Promise<number> {
  // isoDay is "YYYY-MM-DD" — convert to the same midnight-UTC convention
  // we use for storage (matches the bulk-piece-entry action).
  const [y, m, d] = isoDay.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(Date.UTC(y, m - 1, d + 1));
  return prisma.pieceEntry.count({
    where: {
      deletedAt: null,
      date: { gte: start, lt: end },
    },
  });
}

export { serializeEmployee, serializePieceEntry, serializeEmployeePayment };
