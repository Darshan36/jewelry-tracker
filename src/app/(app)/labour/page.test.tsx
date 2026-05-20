// Tests for the /labour server page. Verifies the role gate + that the
// page passes its three data sets through to the client shell.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/prisma");
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/labour-balances", () => ({
  listEmployeesMissingSalaryThisMonth: vi.fn(),
  listEmployeesWithOutstandingWages: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("./labour-page-client", () => ({
  LabourPageClient: (props: {
    pendingSalaries: unknown[];
    outstandingWages: unknown[];
    labourEmployees: unknown[];
  }) => (
    <div data-testid="labour-page-client">
      <span data-testid="pending-count">{props.pendingSalaries.length}</span>
      <span data-testid="outstanding-count">{props.outstandingWages.length}</span>
      <span data-testid="labour-emp-count">{props.labourEmployees.length}</span>
    </div>
  ),
}));

import { auth as _auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import {
  listEmployeesMissingSalaryThisMonth,
  listEmployeesWithOutstandingWages,
} from "@/lib/labour-balances";

import LabourPage from "./page";

type Role = "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT";
type Session = {
  user: { id: string; email: string; name: string; role: Role };
  expires: string;
};
const auth = _auth as unknown as () => Promise<Session | null>;

function sessionFor(role: Role): Session {
  return {
    user: { id: "u", email: "u@x", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listEmployeesMissingSalaryThisMonth).mockResolvedValue([]);
  vi.mocked(listEmployeesWithOutstandingWages).mockResolvedValue([]);
  vi.mocked(prisma.employee.findMany).mockResolvedValue([]);
});

describe("LabourPage — auth gate", () => {
  it("redirects to /auth/login when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await expect(LabourPage()).rejects.toThrow("REDIRECT:/auth/login");
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects to /dashboard when role lacks access (PURCHASE_DEPT)", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("PURCHASE_DEPT"));
    await expect(LabourPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects to /dashboard when role lacks access (CASTING_PLATING_MGMT)", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("CASTING_PLATING_MGMT"));
    await expect(LabourPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("allows ADMIN", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    const page = await LabourPage();
    render(page);
    expect(screen.getByTestId("labour-page-client")).toBeInTheDocument();
  });

  it("allows LABOUR_MGMT", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("LABOUR_MGMT"));
    const page = await LabourPage();
    render(page);
    expect(screen.getByTestId("labour-page-client")).toBeInTheDocument();
  });
});

describe("LabourPage — data flow", () => {
  it("passes the three data sets to the client shell", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    vi.mocked(listEmployeesMissingSalaryThisMonth).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { employee: { id: "f1" }, monthlySalary: 1500000, currentMonth: "May 2026" } as any,
    ]);
    vi.mocked(listEmployeesWithOutstandingWages).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { employee: { id: "l1" }, totalAmount: 50000, totalPieces: 10, earliestUnpaidDate: new Date() } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { employee: { id: "l2" }, totalAmount: 20000, totalPieces: 4, earliestUnpaidDate: new Date() } as any,
    ]);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      {
        id: "l1",
        name: "Labour One",
        phone: null,
        type: "LABOUR",
        monthlySalary: null,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "l2",
        name: "Labour Two",
        phone: null,
        type: "LABOUR",
        monthlySalary: null,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
      {
        id: "l3",
        name: "Labour Three",
        phone: null,
        type: "LABOUR",
        monthlySalary: null,
        address: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    const page = await LabourPage();
    render(page);
    expect(screen.getByTestId("pending-count").textContent).toBe("1");
    expect(screen.getByTestId("outstanding-count").textContent).toBe("2");
    expect(screen.getByTestId("labour-emp-count").textContent).toBe("3");
  });
});
