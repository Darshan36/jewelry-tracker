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
  createKarigarLedgerEntry,
  updateKarigarLedgerEntry,
  softDeleteKarigarLedgerEntry,
} from "./karigar-ledger-actions";

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

// ---------- createKarigarLedgerEntry ----------

describe("createKarigarLedgerEntry", () => {
  function validInput(overrides?: Partial<{
    employeeId: string;
    date: Date;
    amount: number;
    direction: "INCREASE" | "DECREASE";
    description: string;
  }>) {
    return {
      employeeId: "lab1",
      date: new Date("2026-05-23T00:00:00Z"),
      amount: 6000,
      direction: "DECREASE" as const,
      description: "advance for next week",
      ...overrides,
    };
  }

  it("posts a MANUAL_PAYMENT entry owned by the employee (DECREASE — advance)", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "lab1",
      type: "LABOUR",
    } as never);
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
      id: "le-1",
    } as never);

    const result = await createKarigarLedgerEntry(validInput());

    expect(result.ok).toBe(true);
    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        employeeId: "lab1",
        partyId: null,
        direction: "DECREASE",
        amount: 600000n, // ₹6000 → paise
        description: "advance for next week",
        entryType: "MANUAL_PAYMENT",
        sourceType: null,
        sourceId: null,
        createdById: "u1",
        updatedById: "u1",
      }),
    });
  });

  it("posts INCREASE when the user picks adjustment direction", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "lab1",
      type: "LABOUR",
    } as never);
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
      id: "le-2",
    } as never);

    await createKarigarLedgerEntry(
      validInput({ direction: "INCREASE", description: "opening — prior work" }),
    );

    expect(prisma.ledgerEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "INCREASE",
        description: "opening — prior work",
      }),
    });
  });

  it("rejects when description is empty / whitespace-only", async () => {
    const result = await createKarigarLedgerEntry(
      validInput({ description: "   " }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.description?.[0]).toMatch(/required/i);
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects when amount is zero or negative", async () => {
    const r1 = await createKarigarLedgerEntry(validInput({ amount: 0 }));
    expect(r1.ok).toBe(false);
    const r2 = await createKarigarLedgerEntry(validInput({ amount: -100 }));
    expect(r2.ok).toBe(false);
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects when the employee is not found", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null);
    const result = await createKarigarLedgerEntry(validInput());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.employeeId?.[0]).toMatch(/not found/i);
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects when the employee is FIXED (SALARY rail stays untouched)", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "fix1",
      type: "FIXED",
    } as never);
    const result = await createKarigarLedgerEntry(
      validInput({ employeeId: "fix1" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.employeeId?.[0]).toMatch(/LABOUR/);
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it("revalidates /labour after a successful create", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      id: "lab1",
      type: "LABOUR",
    } as never);
    vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
      id: "le-1",
    } as never);

    await createKarigarLedgerEntry(validInput());
    expect(revalidatePath).toHaveBeenCalledWith("/labour");
  });
});

// ---------- updateKarigarLedgerEntry ----------

describe("updateKarigarLedgerEntry", () => {
  it("edits a MANUAL_PAYMENT karigar entry in place (amount + direction + description)", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "le-1",
      entryType: "MANUAL_PAYMENT",
      employeeId: "lab1",
    } as never);

    const result = await updateKarigarLedgerEntry({
      id: "le-1",
      date: new Date("2026-05-23T00:00:00Z"),
      amount: 4000,
      direction: "DECREASE",
      description: "advance — reduced from 6000",
    });

    expect(result.ok).toBe(true);
    expect(prisma.ledgerEntry.update).toHaveBeenCalledWith({
      where: { id: "le-1" },
      data: expect.objectContaining({
        amount: 400000n,
        direction: "DECREASE",
        description: "advance — reduced from 6000",
        updatedById: "u1",
      }),
    });
  });

  it("rejects when editing a TRANSACTION_LINKED entry", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "le-piece",
      entryType: "TRANSACTION_LINKED",
      employeeId: "lab1",
    } as never);

    const result = await updateKarigarLedgerEntry({
      id: "le-piece",
      date: new Date("2026-05-23T00:00:00Z"),
      amount: 1000,
      direction: "INCREASE",
      description: "trying to edit a piece-entry ledger row",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.message).toMatch(/TRANSACTION_LINKED/);
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
  });

  it("rejects when the entry has no employee owner (party-side row)", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "le-party",
      entryType: "MANUAL_PAYMENT",
      employeeId: null,
    } as never);

    const result = await updateKarigarLedgerEntry({
      id: "le-party",
      date: new Date("2026-05-23T00:00:00Z"),
      amount: 1000,
      direction: "DECREASE",
      description: "wrong action for party entries",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.message).toMatch(/not karigar-owned/i);
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
  });

  it("rejects when the entry is not found", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue(null);
    const result = await updateKarigarLedgerEntry({
      id: "missing",
      date: new Date(),
      amount: 100,
      direction: "DECREASE",
      description: "nope",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty description on update", async () => {
    const result = await updateKarigarLedgerEntry({
      id: "le-1",
      date: new Date(),
      amount: 100,
      direction: "DECREASE",
      description: "  ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.description?.[0]).toMatch(/required/i);
  });
});

// ---------- softDeleteKarigarLedgerEntry ----------

describe("softDeleteKarigarLedgerEntry", () => {
  it("soft-deletes a MANUAL_PAYMENT karigar entry", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "le-1",
      entryType: "MANUAL_PAYMENT",
      employeeId: "lab1",
    } as never);

    const result = await softDeleteKarigarLedgerEntry("le-1");

    expect(result.ok).toBe(true);
    expect(prisma.ledgerEntry.update).toHaveBeenCalledWith({
      where: { id: "le-1" },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        deletedById: "u1",
      }),
    });
  });

  it("rejects when soft-deleting a TRANSACTION_LINKED entry", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "le-piece",
      entryType: "TRANSACTION_LINKED",
      employeeId: "lab1",
    } as never);

    const result = await softDeleteKarigarLedgerEntry("le-piece");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.message).toMatch(/TRANSACTION_LINKED/);
    expect(prisma.ledgerEntry.update).not.toHaveBeenCalled();
  });

  it("rejects when the entry is party-owned (wrong action)", async () => {
    vi.mocked(prisma.ledgerEntry.findUnique).mockResolvedValue({
      id: "le-party",
      entryType: "MANUAL_PAYMENT",
      employeeId: null,
    } as never);

    const result = await softDeleteKarigarLedgerEntry("le-party");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.errors.message).toMatch(/not karigar-owned/i);
  });
});

// ---------- Role gating ----------

const ROLE_MATRIX: Array<{
  role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT";
  allowed: boolean;
}> = [
  { role: "ADMIN", allowed: true },
  { role: "LABOUR_MGMT", allowed: true },
  { role: "PURCHASE_DEPT", allowed: false },
  { role: "CASTING_PLATING_MGMT", allowed: false },
];

describe.each(ROLE_MATRIX)(
  "createKarigarLedgerEntry role gate ($role)",
  ({ role, allowed }) => {
    it(`${allowed ? "allows" : "rejects"} ${role}`, async () => {
      if (allowed) {
        vi.mocked(requireRole).mockResolvedValueOnce({
          user: { id: "u", email: "u@x", name: "U", role },
          expires: "2099-12-31T00:00:00.000Z",
        });
        vi.mocked(prisma.employee.findUnique).mockResolvedValue({
          id: "lab1",
          type: "LABOUR",
        } as never);
        vi.mocked(prisma.ledgerEntry.create).mockResolvedValue({
          id: "le-1",
        } as never);
        const result = await createKarigarLedgerEntry({
          employeeId: "lab1",
          date: new Date("2026-05-23T00:00:00Z"),
          amount: 100,
          direction: "DECREASE",
          description: "test",
        });
        expect(result.ok).toBe(true);
      } else {
        vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
        await expect(
          createKarigarLedgerEntry({
            employeeId: "lab1",
            date: new Date("2026-05-23T00:00:00Z"),
            amount: 100,
            direction: "DECREASE",
            description: "test",
          }),
        ).rejects.toThrow("Forbidden");
        expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
      }
    });
  },
);
