import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma so the DB-aggregator tests can stub findMany responses.
vi.mock("@/lib/prisma");

import { prisma } from "@/lib/prisma";
import {
  computeOutstandingWages,
  isDateInPeriod,
  isMonthSalaryPaid,
  isPieceEntryCovered,
  listEmployeesMissingSalaryThisMonth,
  listEmployeesWithOutstandingWages,
  getLabourSummary,
  countPieceEntriesForIstDay,
} from "./labour-balances";

// ---------- Pure helpers ----------

describe("isDateInPeriod", () => {
  const start = new Date("2026-05-01T00:00:00Z");
  const end = new Date("2026-05-31T00:00:00Z");

  it("returns true for a date exactly at periodStart", () => {
    expect(isDateInPeriod(new Date("2026-05-01T00:00:00Z"), start, end)).toBe(true);
  });

  it("returns true for a date exactly at periodEnd", () => {
    expect(isDateInPeriod(new Date("2026-05-31T00:00:00Z"), start, end)).toBe(true);
  });

  it("returns true for a date in the middle of the period", () => {
    expect(isDateInPeriod(new Date("2026-05-15T00:00:00Z"), start, end)).toBe(true);
  });

  it("returns false for a date one millisecond before periodStart", () => {
    expect(
      isDateInPeriod(new Date(start.getTime() - 1), start, end),
    ).toBe(false);
  });

  it("returns false for a date one millisecond after periodEnd", () => {
    expect(
      isDateInPeriod(new Date(end.getTime() + 1), start, end),
    ).toBe(false);
  });
});

describe("isPieceEntryCovered — period-overlap logic", () => {
  const entry = {
    id: "e1",
    date: new Date("2026-05-15T00:00:00Z"),
    totalAmount: 50000n,
    count: 10,
    deletedAt: null,
  };

  it("covered when a WAGE payment's period brackets the entry", () => {
    expect(
      isPieceEntryCovered(entry, [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-31T00:00:00Z"),
          deletedAt: null,
        },
      ]),
    ).toBe(true);
  });

  it("NOT covered when the period ends before the entry date", () => {
    expect(
      isPieceEntryCovered(entry, [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-10T00:00:00Z"),
          deletedAt: null,
        },
      ]),
    ).toBe(false);
  });

  it("NOT covered when the period starts after the entry date", () => {
    expect(
      isPieceEntryCovered(entry, [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-20T00:00:00Z"),
          periodEnd: new Date("2026-05-31T00:00:00Z"),
          deletedAt: null,
        },
      ]),
    ).toBe(false);
  });

  it("SALARY-type payments don't cover wage entries", () => {
    expect(
      isPieceEntryCovered(entry, [
        {
          type: "SALARY",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-31T00:00:00Z"),
          deletedAt: null,
        },
      ]),
    ).toBe(false);
  });

  it("soft-deleted payments don't count toward coverage", () => {
    expect(
      isPieceEntryCovered(entry, [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-31T00:00:00Z"),
          deletedAt: new Date("2026-05-30T00:00:00Z"),
        },
      ]),
    ).toBe(false);
  });

  it("covered if at least one of multiple WAGE payments covers it (non-contiguous payments)", () => {
    expect(
      isPieceEntryCovered(entry, [
        {
          type: "WAGE",
          periodStart: new Date("2026-04-01T00:00:00Z"),
          periodEnd: new Date("2026-04-30T00:00:00Z"),
          deletedAt: null,
        },
        {
          type: "WAGE",
          periodStart: new Date("2026-05-10T00:00:00Z"),
          periodEnd: new Date("2026-05-20T00:00:00Z"),
          deletedAt: null,
        },
      ]),
    ).toBe(true);
  });
});

describe("computeOutstandingWages", () => {
  it("returns zero totals on empty entries", () => {
    const r = computeOutstandingWages([], []);
    expect(r.totalPieces).toBe(0);
    expect(r.totalAmount).toBe(0n);
    expect(r.earliestUnpaidDate).toBeNull();
    expect(r.unpaidEntries).toEqual([]);
  });

  it("sums multiple unpaid entries", () => {
    const r = computeOutstandingWages(
      [
        {
          id: "1",
          date: new Date("2026-05-10T00:00:00Z"),
          totalAmount: 50000n,
          count: 10,
          deletedAt: null,
        },
        {
          id: "2",
          date: new Date("2026-05-12T00:00:00Z"),
          totalAmount: 30000n,
          count: 6,
          deletedAt: null,
        },
      ],
      [],
    );
    expect(r.totalPieces).toBe(16);
    expect(r.totalAmount).toBe(80000n);
    expect(r.earliestUnpaidDate).toEqual(new Date("2026-05-10T00:00:00Z"));
    expect(r.unpaidEntries.length).toBe(2);
  });

  it("excludes covered entries (period-overlap)", () => {
    const r = computeOutstandingWages(
      [
        {
          id: "1",
          date: new Date("2026-05-10T00:00:00Z"),
          totalAmount: 50000n,
          count: 10,
          deletedAt: null,
        },
        {
          id: "2",
          date: new Date("2026-05-20T00:00:00Z"),
          totalAmount: 30000n,
          count: 6,
          deletedAt: null,
        },
      ],
      [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-15T00:00:00Z"),
          deletedAt: null,
        },
      ],
    );
    expect(r.totalPieces).toBe(6);
    expect(r.totalAmount).toBe(30000n);
    expect(r.earliestUnpaidDate).toEqual(new Date("2026-05-20T00:00:00Z"));
    expect(r.unpaidEntries[0].id).toBe("2");
  });

  it("excludes soft-deleted entries", () => {
    const r = computeOutstandingWages(
      [
        {
          id: "1",
          date: new Date("2026-05-10T00:00:00Z"),
          totalAmount: 50000n,
          count: 10,
          deletedAt: new Date(),
        },
        {
          id: "2",
          date: new Date("2026-05-12T00:00:00Z"),
          totalAmount: 30000n,
          count: 6,
          deletedAt: null,
        },
      ],
      [],
    );
    expect(r.totalPieces).toBe(6);
    expect(r.totalAmount).toBe(30000n);
    expect(r.unpaidEntries.length).toBe(1);
  });

  it("returns zero when all entries are covered by an enclosing payment", () => {
    const r = computeOutstandingWages(
      [
        {
          id: "1",
          date: new Date("2026-05-10T00:00:00Z"),
          totalAmount: 50000n,
          count: 10,
          deletedAt: null,
        },
        {
          id: "2",
          date: new Date("2026-05-20T00:00:00Z"),
          totalAmount: 30000n,
          count: 6,
          deletedAt: null,
        },
      ],
      [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-31T00:00:00Z"),
          deletedAt: null,
        },
      ],
    );
    expect(r.totalPieces).toBe(0);
    expect(r.totalAmount).toBe(0n);
    expect(r.earliestUnpaidDate).toBeNull();
  });

  it("entry exactly at periodStart boundary is covered", () => {
    const r = computeOutstandingWages(
      [
        {
          id: "1",
          date: new Date("2026-05-01T00:00:00Z"),
          totalAmount: 50000n,
          count: 10,
          deletedAt: null,
        },
      ],
      [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-31T00:00:00Z"),
          deletedAt: null,
        },
      ],
    );
    expect(r.unpaidEntries.length).toBe(0);
  });

  it("entry exactly at periodEnd boundary is covered", () => {
    const r = computeOutstandingWages(
      [
        {
          id: "1",
          date: new Date("2026-05-31T00:00:00Z"),
          totalAmount: 50000n,
          count: 10,
          deletedAt: null,
        },
      ],
      [
        {
          type: "WAGE",
          periodStart: new Date("2026-05-01T00:00:00Z"),
          periodEnd: new Date("2026-05-31T00:00:00Z"),
          deletedAt: null,
        },
      ],
    );
    expect(r.unpaidEntries.length).toBe(0);
  });
});

describe("isMonthSalaryPaid", () => {
  const monthStart = new Date("2026-05-01T00:00:00Z");
  const monthEnd = new Date("2026-06-01T00:00:00Z"); // exclusive

  it("returns true when a SALARY payment exists with periodStart in the month", () => {
    expect(
      isMonthSalaryPaid(
        [
          {
            type: "SALARY",
            periodStart: new Date("2026-05-01T00:00:00Z"),
            deletedAt: null,
          },
        ],
        monthStart,
        monthEnd,
      ),
    ).toBe(true);
  });

  it("returns false when periodStart is the previous month", () => {
    expect(
      isMonthSalaryPaid(
        [
          {
            type: "SALARY",
            periodStart: new Date("2026-04-01T00:00:00Z"),
            deletedAt: null,
          },
        ],
        monthStart,
        monthEnd,
      ),
    ).toBe(false);
  });

  it("returns false when periodStart is the next month", () => {
    expect(
      isMonthSalaryPaid(
        [
          {
            type: "SALARY",
            periodStart: new Date("2026-06-01T00:00:00Z"),
            deletedAt: null,
          },
        ],
        monthStart,
        monthEnd,
      ),
    ).toBe(false);
  });

  it("ignores WAGE-type payments", () => {
    expect(
      isMonthSalaryPaid(
        [
          {
            type: "WAGE",
            periodStart: new Date("2026-05-01T00:00:00Z"),
            deletedAt: null,
          },
        ],
        monthStart,
        monthEnd,
      ),
    ).toBe(false);
  });

  it("ignores soft-deleted payments", () => {
    expect(
      isMonthSalaryPaid(
        [
          {
            type: "SALARY",
            periodStart: new Date("2026-05-01T00:00:00Z"),
            deletedAt: new Date(),
          },
        ],
        monthStart,
        monthEnd,
      ),
    ).toBe(false);
  });
});

// ---------- DB aggregators ----------

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listEmployeesWithOutstandingWages", () => {
  it("only returns LABOUR employees with > 0 outstanding wages, sorted desc", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "a",
        name: "Alice",
        type: "LABOUR",
        phone: null,
        monthlySalary: null,
        ratePerPiece: 5000n,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        pieceEntries: [
          {
            id: "p1",
            date: new Date("2026-05-10T00:00:00Z"),
            totalAmount: 30000n,
            count: 6,
            deletedAt: null,
          },
        ],
        payments: [],
      },
      {
        id: "b",
        name: "Bob",
        type: "LABOUR",
        phone: null,
        monthlySalary: null,
        ratePerPiece: 5000n,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        pieceEntries: [
          {
            id: "p2",
            date: new Date("2026-05-12T00:00:00Z"),
            totalAmount: 50000n,
            count: 10,
            deletedAt: null,
          },
        ],
        payments: [],
      },
      {
        id: "c",
        name: "Cara",
        type: "LABOUR",
        phone: null,
        monthlySalary: null,
        ratePerPiece: 5000n,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        pieceEntries: [],
        payments: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const result = await listEmployeesWithOutstandingWages();
    expect(result.length).toBe(2);
    expect(result[0].employee.id).toBe("b");
    expect(result[0].totalAmount).toBe(50000);
    expect(result[1].employee.id).toBe("a");
    expect(result[1].totalAmount).toBe(30000);
  });

  it("returns empty array when no LABOUR employees have unpaid pieces", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([]);
    const result = await listEmployeesWithOutstandingWages();
    expect(result).toEqual([]);
  });
});

describe("listEmployeesMissingSalaryThisMonth", () => {
  beforeEach(() => {
    // Pin "now" to May 19, 2026 IST.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"));
  });

  it("returns FIXED employees who have no SALARY payment with periodStart in May 2026", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "f1",
        name: "Fixed One",
        type: "FIXED",
        phone: null,
        monthlySalary: 1500000n,
        ratePerPiece: null,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        payments: [], // no salary payment this month
      },
      {
        id: "f2",
        name: "Fixed Two",
        type: "FIXED",
        phone: null,
        monthlySalary: 2000000n,
        ratePerPiece: null,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        payments: [
          {
            type: "SALARY",
            periodStart: new Date("2026-05-01T00:00:00Z"),
            deletedAt: null,
          },
        ],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const result = await listEmployeesMissingSalaryThisMonth();
    expect(result.length).toBe(1);
    expect(result[0].employee.id).toBe("f1");
    expect(result[0].monthlySalary).toBe(1500000);
    expect(result[0].currentMonth).toBe("May 2026");
  });

  it("excludes employees with monthlySalary === null", async () => {
    // Prisma already filters by { monthlySalary: { not: null } } at the
    // query layer, so an unconfigured FIXED employee never reaches the
    // results.
    vi.mocked(prisma.employee.findMany).mockResolvedValue([]);
    const result = await listEmployeesMissingSalaryThisMonth();
    expect(result).toEqual([]);
  });
});

describe("getLabourSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"));
  });

  it("aggregates counts and totals across both rollups", async () => {
    // First call: listEmployeesMissingSalaryThisMonth — return one FIXED missing
    // Second call: listEmployeesWithOutstandingWages — return two LABOUR
    vi.mocked(prisma.employee.findMany)
      .mockResolvedValueOnce([
        {
          id: "f1",
          name: "Fixed",
          type: "FIXED",
          phone: null,
          monthlySalary: 1500000n,
          ratePerPiece: null,
          address: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          payments: [],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any)
      .mockResolvedValueOnce([
        {
          id: "l1",
          name: "Labour",
          type: "LABOUR",
          phone: null,
          monthlySalary: null,
          ratePerPiece: 5000n,
          address: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          pieceEntries: [
            {
              id: "p",
              date: new Date("2026-05-10T00:00:00Z"),
              totalAmount: 50000n,
              count: 10,
              deletedAt: null,
            },
          ],
          payments: [],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);

    const r = await getLabourSummary();
    expect(r.missingSalaryCount).toBe(1);
    expect(r.missingSalaryTotal).toBe(1500000);
    expect(r.outstandingWagesCount).toBe(1);
    expect(r.outstandingWagesTotal).toBe(50000);
  });
});

describe("countPieceEntriesForIstDay", () => {
  it("queries with a half-open UTC day range matching IST midnight", async () => {
    vi.mocked(prisma.pieceEntry.count).mockResolvedValue(7);
    const n = await countPieceEntriesForIstDay("2026-05-19");
    expect(n).toBe(7);
    const call = vi.mocked(prisma.pieceEntry.count).mock.calls[0][0];
    expect(call?.where?.date).toEqual({
      gte: new Date(Date.UTC(2026, 4, 19)),
      lt: new Date(Date.UTC(2026, 4, 20)),
    });
  });
});
