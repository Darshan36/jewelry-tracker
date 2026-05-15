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
  createEmployee,
  softDeleteEmployee,
  updateEmployee,
} from "./actions";

const fakeSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    name: "Test Admin",
    role: "ADMIN" as const,
  },
  expires: "2099-12-31T00:00:00.000Z",
};

function makeEmployee(
  overrides: Partial<{
    id: string;
    name: string;
    phone: string | null;
    type: "FIXED" | "LABOUR";
    monthlySalary: bigint | null;
    address: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {},
) {
  return {
    id: "cuid-test",
    name: "Test Employee",
    phone: null,
    type: "LABOUR" as const,
    monthlySalary: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(requireRole).mockReset();
  vi.mocked(requireRole).mockResolvedValue(fakeSession);
  vi.mocked(revalidatePath).mockClear();
});

describe("createEmployee", () => {
  it("FIXED happy path — converts rupees to BigInt paise before Prisma write", async () => {
    vi.mocked(prisma.employee.create).mockResolvedValue(
      makeEmployee({ id: "new", type: "FIXED", monthlySalary: 1800000n }),
    );

    await createEmployee({
      name: "Test Salaried",
      phone: null,
      type: "FIXED",
      monthlySalary: 18000, // rupees
      address: null,
      notes: null,
    });

    expect(prisma.employee.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.employee.create).mock.calls[0][0];
    // The action's toPrismaData converts 18000 rupees → 1800000 paise BigInt.
    expect(call.data.monthlySalary).toBe(1800000n);
    expect(typeof call.data.monthlySalary).toBe("bigint");
    expect(revalidatePath).toHaveBeenCalledWith("/employees");
  });

  it("LABOUR happy path — passes null salary to Prisma", async () => {
    vi.mocked(prisma.employee.create).mockResolvedValue(
      makeEmployee({ type: "LABOUR", monthlySalary: null }),
    );

    await createEmployee({
      name: "Test Karigar",
      phone: null,
      type: "LABOUR",
      monthlySalary: null,
      address: null,
      notes: null,
    });

    const call = vi.mocked(prisma.employee.create).mock.calls[0][0];
    expect(call.data.monthlySalary).toBeNull();
  });

  it("rejects empty name — DB not touched", async () => {
    const result = await createEmployee({
      name: "",
      phone: null,
      type: "LABOUR",
      monthlySalary: null,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects LABOUR + salary with refinement error on monthlySalary field", async () => {
    const result = await createEmployee({
      name: "Test",
      phone: null,
      type: "LABOUR",
      monthlySalary: 18000,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.monthlySalary).toContain(
        "Monthly salary applies only to fixed-salary employees.",
      );
    }
    expect(prisma.employee.create).not.toHaveBeenCalled();
  });

  it("returned employee.monthlySalary is a Number (paise), not BigInt", async () => {
    vi.mocked(prisma.employee.create).mockResolvedValue(
      makeEmployee({ type: "FIXED", monthlySalary: 1800000n }),
    );

    const result = await createEmployee({
      name: "Test",
      phone: null,
      type: "FIXED",
      monthlySalary: 18000,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.employee.monthlySalary).toBe("number");
      expect(result.employee.monthlySalary).toBe(1800000);
    }
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      createEmployee({
        name: "Test",
        phone: null,
        type: "LABOUR",
        monthlySalary: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");

    expect(prisma.employee.create).not.toHaveBeenCalled();
  });
});

describe("updateEmployee", () => {
  it("happy path — Prisma update called with where.deletedAt=null + BigInt salary", async () => {
    vi.mocked(prisma.employee.update).mockResolvedValue(
      makeEmployee({ id: "abc", type: "FIXED", monthlySalary: 2500000n }),
    );

    await updateEmployee("abc", {
      name: "Updated",
      phone: null,
      type: "FIXED",
      monthlySalary: 25000,
      address: null,
      notes: null,
    });

    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
        data: expect.objectContaining({ monthlySalary: 2500000n }),
      }),
    );
  });

  it("switching FIXED→LABOUR clears salary — Prisma receives null", async () => {
    vi.mocked(prisma.employee.update).mockResolvedValue(makeEmployee());

    await updateEmployee("abc", {
      name: "Test",
      phone: null,
      type: "LABOUR",
      monthlySalary: null,
      address: null,
      notes: null,
    });

    const call = vi.mocked(prisma.employee.update).mock.calls[0][0];
    expect(call.data.monthlySalary).toBeNull();
  });

  it("rejects LABOUR + salary — DB not touched", async () => {
    const result = await updateEmployee("abc", {
      name: "Test",
      phone: null,
      type: "LABOUR",
      monthlySalary: 18000,
      address: null,
      notes: null,
    });

    expect(result.ok).toBe(false);
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(
      updateEmployee("abc", {
        name: "Test",
        phone: null,
        type: "LABOUR",
        monthlySalary: null,
        address: null,
        notes: null,
      }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("softDeleteEmployee", () => {
  it("happy path — Prisma update called with where.deletedAt=null + data.deletedAt=<Date>", async () => {
    vi.mocked(prisma.employee.update).mockResolvedValue(
      makeEmployee({ deletedAt: new Date() }),
    );

    const result = await softDeleteEmployee("abc");

    expect(result.ok).toBe(true);
    expect(prisma.employee.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/employees");
  });

  it("deletedAt is a Date instance, not a string or number", async () => {
    vi.mocked(prisma.employee.update).mockResolvedValue(makeEmployee());

    await softDeleteEmployee("abc");

    const call = vi.mocked(prisma.employee.update).mock.calls[0][0];
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it("propagates auth failure", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"));

    await expect(softDeleteEmployee("abc")).rejects.toThrow("Unauthorized");

    expect(prisma.employee.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Phase 5 RBAC — parameterised role matrix.
// Employees: ADMIN and LABOUR_MGMT allowed; PURCHASE_DEPT and
// CASTING_PLATING_MGMT must be rejected at the guard.
// 3 actions × 4 roles = 12 tests.
// =====================================================================

const EMPLOYEE_ROLE_MATRIX = [
  ["ADMIN", true],
  ["PURCHASE_DEPT", false],
  ["LABOUR_MGMT", true],
  ["CASTING_PLATING_MGMT", false],
] as const;

const validEmployeeInput = {
  name: "Role Test",
  phone: null,
  type: "LABOUR" as const,
  monthlySalary: null,
  address: null,
  notes: null,
};

function sessionFor(role: "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT") {
  return {
    user: { id: "u", email: "u@example.com", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

describe.each(EMPLOYEE_ROLE_MATRIX)("createEmployee role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.employee.create).mockResolvedValue(makeEmployee());
      const r = await createEmployee(validEmployeeInput);
      expect(r.ok).toBe(true);
      expect(prisma.employee.create).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(createEmployee(validEmployeeInput)).rejects.toThrow("Forbidden");
      expect(prisma.employee.create).not.toHaveBeenCalled();
    }
  });
});

describe.each(EMPLOYEE_ROLE_MATRIX)("updateEmployee role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.employee.update).mockResolvedValue(makeEmployee());
      const r = await updateEmployee("abc", validEmployeeInput);
      expect(r.ok).toBe(true);
      expect(prisma.employee.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(updateEmployee("abc", validEmployeeInput)).rejects.toThrow("Forbidden");
      expect(prisma.employee.update).not.toHaveBeenCalled();
    }
  });
});

describe.each(EMPLOYEE_ROLE_MATRIX)("softDeleteEmployee role access — %s", (role, allowed) => {
  it(allowed ? `allows ${role}` : `denies ${role} (Forbidden)`, async () => {
    if (allowed) {
      vi.mocked(requireRole).mockResolvedValueOnce(sessionFor(role));
      vi.mocked(prisma.employee.update).mockResolvedValue(makeEmployee({ deletedAt: new Date() }));
      const r = await softDeleteEmployee("abc");
      expect(r.ok).toBe(true);
      expect(prisma.employee.update).toHaveBeenCalledOnce();
    } else {
      vi.mocked(requireRole).mockRejectedValueOnce(new Error("Forbidden"));
      await expect(softDeleteEmployee("abc")).rejects.toThrow("Forbidden");
      expect(prisma.employee.update).not.toHaveBeenCalled();
    }
  });
});
