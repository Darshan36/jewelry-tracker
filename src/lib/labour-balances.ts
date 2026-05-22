// Outstanding-wages and missing-salary helpers (Phase 18 → 21b).
//
// "Outstanding wages" model — PHASE 21b:
//   A LABOUR employee's outstanding wages = the raw-signed balance of
//   their LedgerEntry rows (PIECE_ENTRY INCREASE entries minus
//   WAGE_PAYMENT DECREASE entries). Positive balance = shop owes
//   karigar; negative balance = karigar holds an advance against
//   future work. Source of truth is the ledger, NOT period overlap.
//
//   The Phase 18 period-overlap model (`isPieceEntryCovered`,
//   `computeOutstandingWages`, `isDateInPeriod`) is preserved as
//   `@deprecated` exports for one phase so external imports don't
//   break during the cutover — drop in 21c.
//
// "Missing salary this month" model — UNCHANGED in 21b:
//   For each FIXED employee, check if any non-deleted SALARY-type
//   EmployeePayment exists with periodStart in the current IST month.
//   FIXED-employee salary stays on the EmployeePayment rail; only the
//   LABOUR-side wage tracking moves to the ledger.

import { prisma } from "@/lib/prisma";
import type {
  Employee,
  EmployeePayment,
  PieceEntry,
} from "@/generated/prisma";
import { computeOwnerBalance } from "@/lib/ledger";
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
 * @deprecated Phase 18 period-overlap helper. The ledger is now the
 * source of truth for outstanding wages (see `computeOwnerBalance`).
 * Kept for one phase so external imports don't break; drop in 21c.
 *
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
 * @deprecated Phase 18 period-overlap coverage helper. Outstanding
 * wages now derive from the ledger; coverage is implicit in the
 * running balance. Kept for one phase; drop in 21c.
 *
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
 * @deprecated Phase 18 period-overlap aggregator. Replaced by
 * `computeOwnerBalance(employee.ledgerEntries)` from `@/lib/ledger`.
 * Kept for one phase; drop in 21c.
 *
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

export type SerializedEmployee = Omit<Employee, "monthlySalary"> & {
  monthlySalary: number | null;
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
  // Phase 21b — ledger-driven outstanding wages.
  //
  // The Phase 18 shape returned `unpaidEntries` (the list of PieceEntry
  // rows not yet covered by a WAGE period) plus aggregate totals. With
  // the ledger as source of truth, "unpaid pieces" stops being a
  // well-defined concept — coverage is no longer per-entry, it's the
  // running balance. We still surface the LABOUR employee's
  // `pieceEntries` list (read-side history) and the ledger-derived
  // `totalAmount`. `unpaidEntries` is intentionally returned as ALL
  // active piece entries (callers that need a strict unpaid filter can
  // walk the ledger directly via `listEmployeeLedger`).
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId, deletedAt: null },
    include: {
      pieceEntries: {
        where: { deletedAt: null },
        orderBy: { date: "asc" },
      },
      ledgerEntries: {
        where: { deletedAt: null },
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

  const balance = computeOwnerBalance(employee.ledgerEntries);
  // Clamp the surfaced "outstanding" to ≥0 for the existing UI contract
  // (the /labour Section 2 doesn't show advance/credit yet — that's a
  // 21c-era surface). Credit balances are still legal on the ledger;
  // they just don't show as "owed wages" here.
  const totalAmount = balance > 0n ? balance : 0n;
  const totalPieces = employee.pieceEntries.reduce((s, e) => s + e.count, 0);
  const earliestUnpaidDate = employee.pieceEntries.length > 0
    ? employee.pieceEntries[0].date
    : null;

  return {
    employee: serializeEmployee(employee),
    totalPieces,
    totalAmount: Number(totalAmount),
    earliestUnpaidDate,
    unpaidEntries: employee.pieceEntries.map((e) =>
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
  // Phase 21b — ledger-driven rollup. The existing /labour Section 2
  // surface (and the dashboard outstanding-wages card) reads this list;
  // both display "outstanding wages" as a positive number. Credit /
  // advance balances are filtered out of THIS list (negative balance
  // means karigar holds an advance — not "wages owed") but stay
  // representable on the ledger; 21c's per-karigar view will surface
  // them explicitly.
  const employees = await prisma.employee.findMany({
    where: { deletedAt: null, type: "LABOUR" },
    include: {
      pieceEntries: { where: { deletedAt: null } },
      ledgerEntries: { where: { deletedAt: null } },
    },
    orderBy: { name: "asc" },
  });

  const rollups: EmployeeWagesRollup[] = [];
  for (const emp of employees) {
    const balance = computeOwnerBalance(emp.ledgerEntries);
    if (balance <= 0n) continue;
    const totalPieces = emp.pieceEntries.reduce((s, e) => s + e.count, 0);
    const earliestUnpaidDate = emp.pieceEntries.length > 0
      ? emp.pieceEntries.reduce(
          (acc, e) => (acc === null || e.date < acc ? e.date : acc),
          null as Date | null,
        )
      : null;
    rollups.push({
      employee: serializeEmployee(emp),
      totalAmount: Number(balance),
      totalPieces,
      earliestUnpaidDate,
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
