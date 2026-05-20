// Phase 18 — tests for the EmployeeDetailModal Pieces history + Payment
// history sections.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));
vi.mock("./actions", () => ({
  softDeleteEmployee: vi.fn(),
}));
vi.mock("@/app/(app)/labour/actions", () => ({
  getEmployeeHistory: vi.fn(),
}));

import { getEmployeeHistory } from "@/app/(app)/labour/actions";
import { EmployeeDetailModal } from "./employee-detail-modal";
import type { EmployeeForClient } from "./types";

function makeEmployee(
  overrides: Partial<EmployeeForClient> = {},
): EmployeeForClient {
  return {
    id: "emp1",
    name: "Test Employee",
    phone: null,
    type: "LABOUR",
    monthlySalary: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getEmployeeHistory).mockReset();
  vi.mocked(getEmployeeHistory).mockResolvedValue({
    pieceEntries: [],
    payments: [],
  });
});

describe("EmployeeDetailModal — Pieces history (LABOUR only)", () => {
  it("renders Pieces history section for LABOUR employees", async () => {
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("pieces-history-section")).toBeInTheDocument();
    });
  });

  it("does NOT render Pieces history section for FIXED employees", async () => {
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({
          type: "FIXED",
          monthlySalary: 1500000,
        })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId("pieces-history-section")).toBeNull();
    });
  });

  it("renders piece entries with date, count, rate, total", async () => {
    vi.mocked(getEmployeeHistory).mockResolvedValue({
      pieceEntries: [
        {
          id: "p1",
          date: "2026-05-15T00:00:00.000Z",
          count: 10,
          ratePerPiece: 5000,
          totalAmount: 50000,
          note: null,
        },
      ],
      payments: [],
    });
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/10 ×/)).toBeInTheDocument();
    });
  });

  // Phase 18.1 — per-entry note surfaces in pieces history.
  it("renders the per-entry note when present", async () => {
    vi.mocked(getEmployeeHistory).mockResolvedValue({
      pieceEntries: [
        {
          id: "p1",
          date: "2026-05-15T00:00:00.000Z",
          count: 10,
          ratePerPiece: 4000,
          totalAmount: 40000,
          note: "polishing — rush order",
        },
      ],
      payments: [],
    });
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("piece-history-note-p1"),
      ).toHaveTextContent("polishing — rush order");
    });
  });

  it("omits the note element when entry note is null", async () => {
    vi.mocked(getEmployeeHistory).mockResolvedValue({
      pieceEntries: [
        {
          id: "p2",
          date: "2026-05-15T00:00:00.000Z",
          count: 10,
          ratePerPiece: 4000,
          totalAmount: 40000,
          note: null,
        },
      ],
      payments: [],
    });
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/10 ×/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("piece-history-note-p2")).toBeNull();
  });

  it("shows 'No piece entries yet' empty state when none loaded", async () => {
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No piece entries yet/i)).toBeInTheDocument();
    });
  });
});

describe("EmployeeDetailModal — Payment history (both types)", () => {
  it("renders Payment history section for any employee", async () => {
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "FIXED", monthlySalary: 1500000 })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("payment-history-section")).toBeInTheDocument();
    });
  });

  it("renders SALARY payments with the Salary label", async () => {
    vi.mocked(getEmployeeHistory).mockResolvedValue({
      pieceEntries: [],
      payments: [
        {
          id: "ep1",
          type: "SALARY",
          paidAt: "2026-05-19T00:00:00.000Z",
          amount: 1500000,
          periodStart: "2026-05-01T00:00:00.000Z",
          periodEnd: "2026-05-31T00:00:00.000Z",
          note: null,
        },
      ],
    });
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({
          type: "FIXED",
          monthlySalary: 1500000,
        })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      const section = screen.getByTestId("payment-history-section");
      expect(section.textContent).toMatch(/Salary/);
    });
  });

  it("renders WAGE payments with the Wage label", async () => {
    vi.mocked(getEmployeeHistory).mockResolvedValue({
      pieceEntries: [],
      payments: [
        {
          id: "ep1",
          type: "WAGE",
          paidAt: "2026-05-19T00:00:00.000Z",
          amount: 50000,
          periodStart: "2026-05-10T00:00:00.000Z",
          periodEnd: "2026-05-19T00:00:00.000Z",
          note: null,
        },
      ],
    });
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      const section = screen.getByTestId("payment-history-section");
      expect(section.textContent).toMatch(/Wage/);
    });
  });

  it("shows 'No payments yet' empty state", async () => {
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/No payments yet/i)).toBeInTheDocument();
    });
  });
});

describe("EmployeeDetailModal — history fetch", () => {
  it("calls getEmployeeHistory on open with employee id", async () => {
    render(
      <EmployeeDetailModal
        open
        onOpenChange={() => {}}
        employee={makeEmployee({ id: "specific-id", type: "LABOUR" })}
        onEdit={() => {}}
      />,
    );
    await waitFor(() => {
      expect(getEmployeeHistory).toHaveBeenCalledWith("specific-id");
    });
  });
});
