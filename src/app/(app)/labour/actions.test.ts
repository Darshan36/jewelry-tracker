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

// Phase 21b note on the testing pattern:
//   - The shared Prisma mock at `src/lib/__mocks__/prisma.ts` provides a
//     default `$transaction(cb)` impl that invokes the callback with the
//     deep-mocked prisma client itself. That means assertions can target
//     `prisma.pieceEntry.create` / `prisma.ledgerEntry.create` directly,
//     regardless of whether the action wraps the write in $transaction.
//   - Phase 18 tests pre-21b overrode $transaction with a custom tx that
//     mocked ONLY `pieceEntry.create` / `employeePayment.create`. That
//     pattern broke once 21b added ledger writes (the override's tx had
//     no `ledgerEntry.create` mock), so this file uses the default impl
//     throughout.

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
      { id: "lab1" } as never,
      { id: "lab2" } as never,
    ]);
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "pe-mock",
    } as never);

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
      { id: "lab1" } as never,
    ]);
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "pe-mock",
    } as never);

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
      entries: [{ employeeId: "lab1", count: 0, ratePerPiece: 50 }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.created).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects submissions where no employee is valid LABOUR", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([]);

    const result = await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [{ employeeId: "ghost", count: 5, ratePerPiece: 50 }],
    });

    expect(result.ok).toBe(false);
  });

  it("computes totalAmount as count × ratePerPiece in paise (BigInt)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "lab1" } as never,
    ]);
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "pe-mock",
    } as never);

    await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [{ employeeId: "lab1", count: 10, ratePerPiece: 50 }],
    });

    expect(prisma.pieceEntry.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.pieceEntry.create).mock.calls[0][0].data;
    expect(data.ratePerPiece).toBe(5000n);
    expect(data.totalAmount).toBe(50000n);
    expect(typeof data.totalAmount).toBe("bigint");
  });

  it("persists per-row note on each PieceEntry (Phase 18.1)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "lab1" } as never,
      { id: "lab2" } as never,
    ]);
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "pe-mock",
    } as never);

    await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [
        { employeeId: "lab1", count: 5, ratePerPiece: 40, note: "polishing — rush order" },
        { employeeId: "lab2", count: 3, ratePerPiece: 80, note: "setting" },
      ],
    });

    expect(prisma.pieceEntry.create).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(prisma.pieceEntry.create).mock.calls;
    expect(calls[0][0].data.note).toBe("polishing — rush order");
    expect(calls[1][0].data.note).toBe("setting");
  });

  it("persists distinct rates per entry (dynamic, not derived from employee)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "lab1" } as never,
    ]);
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "pe-mock",
    } as never);

    await createBulkPieceEntries({
      date: new Date("2026-05-19T00:00:00Z"),
      entries: [
        { employeeId: "lab1", count: 10, ratePerPiece: 40 },
        { employeeId: "lab1", count: 5, ratePerPiece: 80 },
      ],
    });

    const calls = vi.mocked(prisma.pieceEntry.create).mock.calls;
    expect(calls[0][0].data.ratePerPiece).toBe(4000n);
    expect(calls[1][0].data.ratePerPiece).toBe(8000n);
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

  // Phase 21b — bulk create must emit a linked INCREASE ledger entry
  // per row with the right description (count + rate + note).
  it("emits a TRANSACTION_LINKED INCREASE per piece entry on the karigar ledger (Phase 21b)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "lab1" } as never,
    ]);
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "pe-new",
    } as never);

    await createBulkPieceEntries({
      date: new Date("2026-05-23T00:00:00Z"),
      entries: [
        { employeeId: "lab1", count: 50, ratePerPiece: 15, note: "polishing" },
      ],
    });

    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      employeeId: "lab1",
      partyId: null,
      direction: "INCREASE",
      amount: 75000n,
      entryType: "TRANSACTION_LINKED",
      sourceType: "PIECE_ENTRY",
      sourceId: "pe-new",
      description: "50 pcs @ ₹15/pc — polishing",
      createdById: "u1",
    });
  });

  it("emits N ledger entries for N piece entries (per-row, not per-batch)", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: "lab1" } as never,
      { id: "lab2" } as never,
    ]);
    vi.mocked(prisma.pieceEntry.create).mockResolvedValue({
      id: "pe-mock",
    } as never);

    await createBulkPieceEntries({
      date: new Date(),
      entries: [
        { employeeId: "lab1", count: 5, ratePerPiece: 40 },
        { employeeId: "lab2", count: 3, ratePerPiece: 80 },
      ],
    });
    expect(prisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
  });
});

// ---------- createPieceEntry ----------

describe("createPieceEntry", () => {
  it("happy path — LABOUR employee, ledger entry emitted with rich description", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "lab1",
      type: "LABOUR",
    } as never);
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
    } as never);

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
    // Linked INCREASE on the karigar ledger.
    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      employeeId: "lab1",
      direction: "INCREASE",
      sourceType: "PIECE_ENTRY",
      sourceId: "p1",
      description: "5 pcs @ ₹50/pc",
    });
  });

  it("rejects FIXED employee (LABOUR-only) — no ledger write", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "fix1",
      type: "FIXED",
    } as never);

    const result = await createPieceEntry({
      employeeId: "fix1",
      date: new Date("2026-05-19T00:00:00Z"),
      count: 5,
      ratePerPiece: 50,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.employeeId).toBeDefined();
    expect(prisma.pieceEntry.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects when employee not found — no ledger write", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null);
    const result = await createPieceEntry({
      employeeId: "ghost",
      date: new Date(),
      count: 5,
      ratePerPiece: 50,
    });
    expect(result.ok).toBe(false);
    expect(prisma.pieceEntry.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });
});

// ---------- createEmployeePayment ----------

describe("createEmployeePayment", () => {
  it("SALARY for FIXED employee — creates row WITHOUT emitting a ledger entry (Phase 21b SALARY untouched)", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "fix1",
      type: "FIXED",
    } as never);
    vi.mocked(prisma.employeePayment.create).mockResolvedValue({
      id: "ep-salary",
    } as never);

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
    expect(prisma.employeePayment.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.employeePayment.create).mock.calls[0][0].data;
    expect(data.type).toBe("SALARY");
    expect(data.amount).toBe(1500000n);
    // CRITICAL: SALARY path emits NO ledger entry — Phase 21b touches
    // only the LABOUR/WAGE rail. Pin to prevent regression.
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("WAGE for LABOUR employee — emits DECREASE ledger entry", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "lab1",
      type: "LABOUR",
    } as never);
    vi.mocked(prisma.employeePayment.create).mockResolvedValue({
      id: "ep-wage",
    } as never);

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
    expect(prisma.employeePayment.create).toHaveBeenCalledOnce();
    expect(prisma.ledgerEntry.create).toHaveBeenCalledOnce();
    const data = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      employeeId: "lab1",
      partyId: null,
      direction: "DECREASE",
      amount: 50000n,
      entryType: "TRANSACTION_LINKED",
      sourceType: "WAGE_PAYMENT",
      sourceId: "ep-wage",
      description: "Wage payment",
    });
  });

  it("ADVANCE — WAGE payment with note 'advance' produces 'Wage payment — advance' (data model fold)", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "lab1",
      type: "LABOUR",
    } as never);
    vi.mocked(prisma.employeePayment.create).mockResolvedValue({
      id: "ep-advance",
    } as never);

    await createEmployeePayment({
      employeeId: "lab1",
      type: "WAGE",
      paidAt: new Date("2026-05-23T00:00:00Z"),
      amount: 500,
      periodStart: new Date("2026-05-23T00:00:00Z"),
      periodEnd: new Date("2026-05-23T00:00:00Z"),
      note: "advance",
    });

    const data = vi.mocked(prisma.ledgerEntry.create).mock.calls[0][0].data;
    expect(data.description).toBe("Wage payment — advance");
    expect(data.direction).toBe("DECREASE");
  });

  it("rejects SALARY for LABOUR employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "lab1",
      type: "LABOUR",
    } as never);
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
    expect(prisma.employeePayment.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects WAGE for FIXED employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "fix1",
      type: "FIXED",
    } as never);
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
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects periodEnd before periodStart", async () => {
    const result = await createEmployeePayment({
      employeeId: "fix1",
      type: "SALARY",
      paidAt: new Date(),
      amount: 100,
      periodStart: new Date("2026-05-31T00:00:00Z"),
      periodEnd: new Date("2026-05-01T00:00:00Z"),
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
  it("sets deletedAt AND cascades soft-delete to the linked ledger entry (Phase 21b)", async () => {
    vi.mocked(prisma.pieceEntry.update).mockResolvedValue({} as never);
    vi.mocked(prisma.ledgerEntry.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await softDeletePieceEntry("p1");

    expect(prisma.pieceEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1", deletedAt: null },
      }),
    );
    const peCall = vi.mocked(prisma.pieceEntry.update).mock.calls[0][0];
    expect(peCall.data.deletedAt).toBeInstanceOf(Date);

    // Linked ledger entry tombstone — cascades atomically.
    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledOnce();
    const ledgerCall = vi.mocked(prisma.ledgerEntry.updateMany).mock.calls[0][0];
    expect(ledgerCall.where).toMatchObject({
      sourceType: "PIECE_ENTRY",
      sourceId: "p1",
      deletedAt: null,
    });
    expect(ledgerCall.data).toMatchObject({ deletedById: "u1" });
    expect(ledgerCall.data.deletedAt).toBeInstanceOf(Date);
  });
});

describe("softDeleteEmployeePayment", () => {
  it("WAGE payment soft-delete cascades to linked DECREASE ledger entry", async () => {
    vi.mocked(prisma.employeePayment.findUnique).mockResolvedValue({
      type: "WAGE",
    } as never);
    vi.mocked(prisma.employeePayment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.ledgerEntry.updateMany).mockResolvedValue({
      count: 1,
    } as never);

    await softDeleteEmployeePayment("ep-wage");

    expect(prisma.employeePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ep-wage", deletedAt: null },
      }),
    );
    expect(prisma.ledgerEntry.updateMany).toHaveBeenCalledOnce();
    const ledgerCall = vi.mocked(prisma.ledgerEntry.updateMany).mock.calls[0][0];
    expect(ledgerCall.where).toMatchObject({
      sourceType: "WAGE_PAYMENT",
      sourceId: "ep-wage",
      deletedAt: null,
    });
  });

  it("SALARY payment soft-delete does NOT touch the ledger (FIXED rail untouched)", async () => {
    vi.mocked(prisma.employeePayment.findUnique).mockResolvedValue({
      type: "SALARY",
    } as never);
    vi.mocked(prisma.employeePayment.update).mockResolvedValue({} as never);

    await softDeleteEmployeePayment("ep-salary");

    expect(prisma.employeePayment.update).toHaveBeenCalledOnce();
    expect(prisma.ledgerEntry.updateMany).not.toHaveBeenCalled();
  });
});

// ---------- Role matrix ----------

const ROLE_MATRIX = [
  ["ADMIN", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", true],
  ["CASTING_PLATING_MGMT", false],
] as const;

describe.each(ROLE_MATRIX)(
  "createBulkPieceEntries role gate — %s",
  (role, allowed) => {
    it(allowed ? `allows ${role}` : `denies ${role}`, async () => {
      if (allowed) {
        vi.mocked(requireRole).mockResolvedValueOnce({
          user: { id: "u", email: "u", name: "U", role },
          expires: "2099-12-31",
        } as never);
        vi.mocked(prisma.employee.findMany).mockResolvedValue([]);
        const r = await createBulkPieceEntries({
          date: new Date(),
          entries: [{ employeeId: "x", count: 1, ratePerPiece: 50 }],
        });
        expect(r.ok).toBe(false);
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
  },
);
