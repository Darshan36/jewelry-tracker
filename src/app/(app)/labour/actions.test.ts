import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma");
vi.mock("@/lib/auth-guards", () => ({
  requireRole: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-guards";
import { revalidatePath } from "next/cache";

import {
  createBulkPieceEntries,
  createEmployeePayment,
  createPieceEntry,
  softDeleteEmployeePayment,
  softDeletePieceEntry,
} from "./actions";

const adminSession = {
  user: {
    id: "u1",
    email: "admin@test",
    name: "Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(adminSession);
  vi.mocked(revalidatePath).mockClear();
});

// ---------- createBulkPieceEntries ----------

describe("createBulkPieceEntries", () => {
  it("creates entries for valid LABOUR employees only", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab2" } as any,
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = {
        pieceEntry: {
          create: vi.fn().mockResolvedValue({}),
        },
      } as any;
      await fn(tx);
      return tx;
    });

    const result = await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [
        { employeeId: "lab1", count: 10, ratePerPiece: 50 },
        { employeeId: "lab2", count: 5, ratePerPiece: 50 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created).toBe(2);
    expect(revalidatePath).toHaveBeenCalledWith("/labour");
  });

  it("filters out zero-count rows", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1" } as any,
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { pieceEntry: { create: vi.fn().mockResolvedValue({}) } } as any;
      await fn(tx);
      return tx;
    });

    const result = await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [
        { employeeId: "lab1", count: 10, ratePerPiece: 50 },
        { employeeId: "lab2", count: 0, ratePerPiece: 50 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created).toBe(1);
  });

  it("returns no-op when all rows are zero-count (not an error)", async () => {
    const result = await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [
        { employeeId: "lab1", count: 0, ratePerPiece: 50 },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects submissions where no employee is valid LABOUR", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([]); // no matches

    const result = await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [{ employeeId: "ghost", count: 5, ratePerPiece: 50 }],
    });

    expect(result.ok).toBe(false);
  });

  it("computes totalAmount as count × ratePerPiece in paise (BigInt)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1" } as any,
    ]);
    const createMock = vi.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { pieceEntry: { create: createMock } } as any;
      await fn(tx);
      return tx;
    });

    await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [{ employeeId: "lab1", count: 10, ratePerPiece: 50 }],
    });

    expect(createMock).toHaveBeenCalledOnce();
    const data = createMock.mock.calls[0][0].data;
    expect(data.ratePerPiece).toBe(5000n); // 50 rupees → 5000 paise
    expect(data.totalAmount).toBe(50000n); // 10 × 5000
    expect(typeof data.totalAmount).toBe("bigint");
  });

  // Phase 18.1 — per-row note passes through to PieceEntry.note.
  it("persists per-row note on each PieceEntry", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab2" } as any,
    ]);
    const createMock = vi.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { pieceEntry: { create: createMock } } as any;
      await fn(tx);
      return tx;
    });

    await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [
        {
          employeeId: "lab1",
          count: 5,
          ratePerPiece: 40,
          note: "polishing — rush order",
        },
        {
          employeeId: "lab2",
          count: 3,
          ratePerPiece: 80,
          note: "setting",
        },
      ],
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].data.note).toBe(
      "polishing — rush order",
    );
    expect(createMock.mock.calls[1][0].data.note).toBe("setting");
  });

  // Phase 18.1 — different rates for the same worker on the same day
  // are persisted as written; rate is dynamic per entry.
  it("persists distinct rates per entry (dynamic, not derived from employee)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1" } as any,
    ]);
    const createMock = vi.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { pieceEntry: { create: createMock } } as any;
      await fn(tx);
      return tx;
    });

    await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [
        { employeeId: "lab1", count: 10, ratePerPiece: 40 },
        { employeeId: "lab1", count: 5, ratePerPiece: 80 },
      ],
    });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].data.ratePerPiece).toBe(4000n);
    expect(createMock.mock.calls[1][0].data.ratePerPiece).toBe(8000n);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      createBulkPieceEntries({
        date: new Date("2026-05-19T00:00:00Z"),
        entries: [{ employeeId: "lab1", count: 1, ratePerPiece: 50 }],
      }),
    ).rejects.toThrow("Forbidden");
  });
});

// ---------- createPieceEntry ----------

describe("createPieceEntry", () => {
  it("happy path — LABOUR employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1", type: "LABOUR" } as any,
    );
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "p1",
      employeeId: "lab1",
      date: new Date("2026-05-19T00:00:00Z"),
      count: 5,
      ratePerPiece: 5000n,
      totalAmount: 25000n,
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      createdById: null,
      updatedById: null,
      deletedById: null,
    });

    const result = await createPieceEntry({
      employeeId: "lab1",
      date: new Date("2026-05-19T00:00:00Z"),
      count: 5,
      ratePerPiece: 50,
      note: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.totalAmount).toBe(25000);
      expect(typeof result.entry.ratePerPiece).toBe("number");
    }
  });

  it("rejects FIXED employee (LABOUR-only)", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "fix1", type: "FIXED" } as any,
    );

    const result = await createPieceEntry({
      employeeId: "fix1",
      date: new Date("2026-05-19T00:00:00Z"),
      count: 5,
      ratePerPiece: 50,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.employeeId).toBeDefined();
    expect(prisma.pieceEntry.create).not.toHaveBeenCalled();
  });

  it("rejects when employee not found", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null);
    const result = await createPieceEntry({
      employeeId: "ghost",
      date: new Date(),
      count: 5,
      ratePerPiece: 50,
    });
    expect(result.ok).toBe(false);
    expect(prisma.pieceEntry.create).not.toHaveBeenCalled();
  });
});

// ---------- createEmployeePayment ----------

describe("createEmployeePayment", () => {
  it("SALARY for FIXED employee — creates row in transaction", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "fix1", type: "FIXED" } as any,
    );
    const createMock = vi.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { employeePayment: { create: createMock } } as any;
      await fn(tx);
      return tx;
    });

    const result = await createEmployeePayment({
      employeeId: "fix1",
      type: "SALARY",
      paidAt: new Date("2026-05-19T00:00:00Z"),
      amount: 15000,
      periodStart: new Date("2026-05-01T00:00:00Z"),
      periodEnd: new Date("2026-05-31T00:00:00Z"),
      note: null,
    });

    expect(result.ok).toBe(true);
    expect(createMock).toHaveBeenCalledOnce();
    const data = createMock.mock.calls[0][0].data;
    expect(data.type).toBe("SALARY");
    expect(data.amount).toBe(1500000n); // 15000 rupees → 1500000 paise
  });

  it("WAGE for LABOUR employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1", type: "LABOUR" } as any,
    );
    const createMock = vi.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = { employeePayment: { create: createMock } } as any;
      await fn(tx);
      return tx;
    });

    const result = await createEmployeePayment({
      employeeId: "lab1",
      type: "WAGE",
      paidAt: new Date("2026-05-19T00:00:00Z"),
      amount: 500,
      periodStart: new Date("2026-05-10T00:00:00Z"),
      periodEnd: new Date("2026-05-19T00:00:00Z"),
      note: null,
    });

    expect(result.ok).toBe(true);
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("rejects SALARY for LABOUR employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "lab1", type: "LABOUR" } as any,
    );
    const result = await createEmployeePayment({
      employeeId: "lab1",
      type: "SALARY",
      paidAt: new Date(),
      amount: 100,
      periodStart: new Date("2026-05-01T00:00:00Z"),
      periodEnd: new Date("2026-05-31T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.type).toBeDefined();
  });

  it("rejects WAGE for FIXED employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "fix1", type: "FIXED" } as any,
    );
    const result = await createEmployeePayment({
      employeeId: "fix1",
      type: "WAGE",
      paidAt: new Date(),
      amount: 100,
      periodStart: new Date("2026-05-01T00:00:00Z"),
      periodEnd: new Date("2026-05-31T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.type).toBeDefined();
  });

  it("rejects periodEnd before periodStart", async () => {
    const result = await createEmployeePayment({
      employeeId: "fix1",
      type: "SALARY",
      paidAt: new Date(),
      amount: 100,
      periodStart: new Date("2026-05-31T00:00:00Z"),
      periodEnd: new Date("2026-05-01T00:00:00Z"), // backwards
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.periodEnd).toBeDefined();
  });

  it("rejects zero or negative amount", async () => {
    const result = await createEmployeePayment({
      employeeId: "fix1",
      type: "SALARY",
      paidAt: new Date(),
      amount: 0,
      periodStart: new Date("2026-05-01T00:00:00Z"),
      periodEnd: new Date("2026-05-31T00:00:00Z"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.amount).toBeDefined();
  });
});

// ---------- softDelete ----------

describe("softDeletePieceEntry", () => {
  it("sets deletedAt with where.deletedAt:null", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.pieceEntry.update).mockResolvedValue({} as any);
    await softDeletePieceEntry("p1");
    expect(prisma.pieceEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1", deletedAt: null },
      }),
    );
    const call = vi.mocked(prisma.pieceEntry.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });
});

describe("softDeleteEmployeePayment", () => {
  it("sets deletedAt", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.employeePayment.update).mockResolvedValue({} as any);
    await softDeleteEmployeePayment("ep1");
    const call = vi.mocked(prisma.employeePayment.update).mock.calls[0][0];
    expect(call.where).toEqual({ id: "ep1", deletedAt: null });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });
});

// ---------- Role matrix ----------

const ROLE_MATRIX = [
  ["ADMIN", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", true],
  ["CASTING_PLATING_MGMT", false],
] as const;

describe.each(ROLE_MATRIX)("createBulkPieceEntries role gate — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role}`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce({
        user: { id: "u", email: "u", name: "U", role },
        expires: "2099-12-31",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      vi.mocked(prisma.employee.findMany).mockResolvedValue([]);
      const r = await createBulkPieceEntries({
        date: new Date(),
        entries: [{ employeeId: "x", count: 1, ratePerPiece: 50 }],
      });
      expect(r.ok).toBe(false); // (no valid employees), but auth passed
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(
        createBulkPieceEntries({
          date: new Date(),
          entries: [{ employeeId: "x", count: 1, ratePerPiece: 50 }],
        }),
      ).rejects.toThrow("Forbidden");
    }
  });
});
