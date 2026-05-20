import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/employees",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  softDeleteEmployee: vi.fn(),
}));

// Phase 18: detail modal imports getEmployeeHistory from the labour
// actions file, which transitively pulls in auth-guards → next-auth →
// next/server. Mock the labour action to break that chain at test time.
vi.mock("@/app/(app)/labour/actions", () => ({
  getEmployeeHistory: vi.fn().mockResolvedValue({
    pieceEntries: [],
    payments: [],
  }),
}));

import { EmployeesTable } from "./employees-table";
import type { EmployeeForClient } from "./types";

function makeEmployee(
  overrides: Partial<EmployeeForClient> = {},
): EmployeeForClient {
  return {
    id: "emp-1",
    name: "Default Employee",
    phone: "9876543210",
    type: "LABOUR",
    monthlySalary: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

function mixedEmployees(): EmployeeForClient[] {
  return [
    makeEmployee({
      id: "1",
      name: "Alice Karigar",
      phone: "1111111111",
      type: "LABOUR",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }),
    makeEmployee({
      id: "2",
      name: "Bob Salaried",
      phone: "2222222222",
      type: "FIXED",
      monthlySalary: 1800000,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    }),
    makeEmployee({
      id: "3",
      name: "Cara Karigar",
      phone: "3333333333",
      type: "LABOUR",
      createdAt: new Date("2026-03-01T00:00:00Z"),
    }),
    makeEmployee({
      id: "4",
      name: "Dan Salaried",
      phone: "4444444444",
      type: "FIXED",
      monthlySalary: 2500000,
      createdAt: new Date("2026-04-01T00:00:00Z"),
    }),
  ];
}

describe("EmployeesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty states", () => {
    it("shows 'No employees yet' when employees prop is empty", () => {
      render(<EmployeesTable employees={[]} />);
      expect(
        screen.getByText(
          /No employees yet\. Add your first employee to get started\./i,
        ),
      ).toBeInTheDocument();
    });

    it("shows 'No employees match your search' when search filters all rows out", async () => {
      const user = userEvent.setup();
      render(
        <EmployeesTable employees={[makeEmployee({ name: "Alice" })]} />,
      );

      await user.type(
        screen.getByPlaceholderText(/Search employees/i),
        "zzzzz",
      );

      expect(
        screen.getByText(/No employees match your search\./i),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("renders one row per employee", () => {
      render(<EmployeesTable employees={mixedEmployees()} />);
      expect(screen.getByText("Alice Karigar")).toBeInTheDocument();
      expect(screen.getByText("Bob Salaried")).toBeInTheDocument();
      expect(screen.getByText("Cara Karigar")).toBeInTheDocument();
      expect(screen.getByText("Dan Salaried")).toBeInTheDocument();
    });

    it("renders Name, Phone, Type, and Created column headers", () => {
      render(<EmployeesTable employees={mixedEmployees()} />);
      expect(
        screen.getByRole("columnheader", { name: /name/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /phone/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /type/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /created/i }),
      ).toBeInTheDocument();
    });

    it("renders Type chips (Fixed/Labour) in the Type column for each row", () => {
      render(<EmployeesTable employees={mixedEmployees()} />);
      // Scope to the table body — the filter pills above the table also
      // render the words 'Fixed' and 'Labour' as button labels.
      const table = screen.getByRole("table");
      expect(within(table).getAllByText("Fixed")).toHaveLength(2);
      expect(within(table).getAllByText("Labour")).toHaveLength(2);
    });
  });

  describe("search", () => {
    it("filters rows by partial name match", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={mixedEmployees()} />);

      await user.type(
        screen.getByPlaceholderText(/Search employees/i),
        "alice",
      );

      expect(screen.getByText("Alice Karigar")).toBeInTheDocument();
      expect(screen.queryByText("Bob Salaried")).not.toBeInTheDocument();
      expect(screen.queryByText("Cara Karigar")).not.toBeInTheDocument();
    });

    it("filters rows by phone number", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={mixedEmployees()} />);

      await user.type(
        screen.getByPlaceholderText(/Search employees/i),
        "3333",
      );

      expect(screen.queryByText("Alice Karigar")).not.toBeInTheDocument();
      expect(screen.getByText("Cara Karigar")).toBeInTheDocument();
    });

    it("restores all rows when search is cleared", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={mixedEmployees()} />);

      const input = screen.getByPlaceholderText(/Search employees/i);
      await user.type(input, "alice");
      expect(screen.queryByText("Bob Salaried")).not.toBeInTheDocument();

      await user.clear(input);
      expect(screen.getByText("Alice Karigar")).toBeInTheDocument();
      expect(screen.getByText("Bob Salaried")).toBeInTheDocument();
      expect(screen.getByText("Cara Karigar")).toBeInTheDocument();
      expect(screen.getByText("Dan Salaried")).toBeInTheDocument();
    });
  });

  describe("sort", () => {
    it("defaults to createdAt desc (newest first)", () => {
      render(<EmployeesTable employees={mixedEmployees()} />);
      const html = document.body.textContent ?? "";
      // Dan (Apr) > Cara (Mar) > Bob (Feb) > Alice (Jan)
      expect(html.indexOf("Dan Salaried")).toBeLessThan(
        html.indexOf("Cara Karigar"),
      );
      expect(html.indexOf("Cara Karigar")).toBeLessThan(
        html.indexOf("Bob Salaried"),
      );
      expect(html.indexOf("Bob Salaried")).toBeLessThan(
        html.indexOf("Alice Karigar"),
      );
    });

    it("clicking Name header sorts ascending alphabetically", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={mixedEmployees()} />);

      await user.click(screen.getByRole("button", { name: /^name/i }));

      const html = document.body.textContent ?? "";
      // Alice < Bob < Cara < Dan
      expect(html.indexOf("Alice Karigar")).toBeLessThan(
        html.indexOf("Bob Salaried"),
      );
      expect(html.indexOf("Bob Salaried")).toBeLessThan(
        html.indexOf("Cara Karigar"),
      );
      expect(html.indexOf("Cara Karigar")).toBeLessThan(
        html.indexOf("Dan Salaried"),
      );
    });
  });

  describe("filter pills", () => {
    it("clicking 'Fixed' pill shows only FIXED employees", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={mixedEmployees()} />);

      // Scope to the radiogroup to avoid matching other 'Fixed' text.
      const filterGroup = screen.getByRole("radiogroup", {
        name: /filter by type/i,
      });
      await user.click(within(filterGroup).getByRole("radio", { name: /^fixed$/i }));

      expect(screen.getByText("Bob Salaried")).toBeInTheDocument();
      expect(screen.getByText("Dan Salaried")).toBeInTheDocument();
      expect(screen.queryByText("Alice Karigar")).not.toBeInTheDocument();
      expect(screen.queryByText("Cara Karigar")).not.toBeInTheDocument();
    });

    it("clicking 'Labour' pill shows only LABOUR employees", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={mixedEmployees()} />);

      const filterGroup = screen.getByRole("radiogroup", {
        name: /filter by type/i,
      });
      await user.click(within(filterGroup).getByRole("radio", { name: /^labour$/i }));

      expect(screen.getByText("Alice Karigar")).toBeInTheDocument();
      expect(screen.getByText("Cara Karigar")).toBeInTheDocument();
      expect(screen.queryByText("Bob Salaried")).not.toBeInTheDocument();
      expect(screen.queryByText("Dan Salaried")).not.toBeInTheDocument();
    });

    it("clicking 'All' pill restores all rows", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={mixedEmployees()} />);

      const filterGroup = screen.getByRole("radiogroup", {
        name: /filter by type/i,
      });
      await user.click(within(filterGroup).getByRole("radio", { name: /^fixed$/i }));
      expect(screen.queryByText("Alice Karigar")).not.toBeInTheDocument();

      await user.click(within(filterGroup).getByRole("radio", { name: /^all$/i }));
      expect(screen.getByText("Alice Karigar")).toBeInTheDocument();
      expect(screen.getByText("Bob Salaried")).toBeInTheDocument();
      expect(screen.getByText("Cara Karigar")).toBeInTheDocument();
      expect(screen.getByText("Dan Salaried")).toBeInTheDocument();
    });
  });

  describe("row interactions", () => {
    it("renders Edit and Delete action buttons for each row (queryable in DOM)", () => {
      render(<EmployeesTable employees={[makeEmployee({ name: "Test" })]} />);

      expect(
        screen.getByRole("button", { name: /edit employee/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /delete employee/i }),
      ).toBeInTheDocument();
    });

    it("clicking the Edit icon does NOT fire the row click (stopPropagation works)", async () => {
      const user = userEvent.setup();
      render(<EmployeesTable employees={[makeEmployee({ name: "Test" })]} />);

      await user.click(
        screen.getByRole("button", { name: /edit employee/i }),
      );

      // Edit modal opens → exactly ONE dialog. If stopPropagation failed,
      // the row click would also fire, opening the detail modal too.
      const openDialogs = screen.getAllByRole("dialog");
      expect(openDialogs).toHaveLength(1);
      expect(screen.getByText(/edit employee/i)).toBeInTheDocument();
    });
  });
});

// =====================================================================
// Mobile viewport — Phase 11.2.
// =====================================================================
import { mockMobileViewport } from "@/test-utils/viewport";

describe("EmployeesTable — mobile viewport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMobileViewport();
  });

  it("renders mobile cards instead of the desktop table", () => {
    render(<EmployeesTable employees={mixedEmployees()} />);

    expect(screen.getByTestId("responsive-table-mobile")).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-desktop")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders one mobile card per employee", () => {
    render(<EmployeesTable employees={mixedEmployees()} />);

    expect(screen.getByTestId("employee-mobile-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("employee-mobile-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("employee-mobile-card-3")).toBeInTheDocument();
    expect(screen.getByTestId("employee-mobile-card-4")).toBeInTheDocument();
  });

  it("shows the type chip on every card", () => {
    render(<EmployeesTable employees={mixedEmployees()} />);

    const fixedCard = screen.getByTestId("employee-mobile-card-2");
    expect(within(fixedCard).getByText(/fixed/i)).toBeInTheDocument();

    const labourCard = screen.getByTestId("employee-mobile-card-1");
    expect(within(labourCard).getByText(/labour/i)).toBeInTheDocument();
  });

  it("shows monthly salary line for FIXED employees only", () => {
    render(<EmployeesTable employees={mixedEmployees()} />);

    // FIXED — Bob's salary 1800000 paise = ₹18,000. The "/ month" suffix
    // is unique to the mobile card's salary line.
    const bobCard = screen.getByTestId("employee-mobile-card-2");
    expect(within(bobCard).getByText(/\/ month/i)).toBeInTheDocument();

    // LABOUR — Alice has no salary line.
    const aliceCard = screen.getByTestId("employee-mobile-card-1");
    expect(within(aliceCard).queryByText(/\/ month/i)).not.toBeInTheDocument();
  });

  it("omits salary line for FIXED with null monthlySalary", () => {
    const noSalary = [
      makeEmployee({
        id: "x",
        name: "FixedNoSalary",
        type: "FIXED",
        monthlySalary: null,
      }),
    ];
    render(<EmployeesTable employees={noSalary} />);

    const card = screen.getByTestId("employee-mobile-card-x");
    expect(within(card).queryByText(/\/ month/i)).not.toBeInTheDocument();
  });

  it("does not render inline action buttons on mobile cards", () => {
    render(<EmployeesTable employees={mixedEmployees()} />);

    expect(screen.queryByRole("button", { name: /edit employee/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete employee/i })).not.toBeInTheDocument();
  });

  it("tapping a mobile card opens the detail modal", async () => {
    const user = userEvent.setup();
    render(<EmployeesTable employees={[makeEmployee({ id: "x", name: "Tap target" })]} />);

    await user.click(screen.getByTestId("employee-mobile-card-x"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Tap target")).toBeInTheDocument();
  });

  it("type filter pills still work on mobile (filter pre-applies before cards render)", async () => {
    const user = userEvent.setup();
    render(<EmployeesTable employees={mixedEmployees()} />);

    // Filter to FIXED — only Bob + Dan cards should render.
    await user.click(screen.getByRole("radio", { name: /^fixed$/i }));

    expect(screen.queryByTestId("employee-mobile-card-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("employee-mobile-card-2")).toBeInTheDocument();
    expect(screen.queryByTestId("employee-mobile-card-3")).not.toBeInTheDocument();
    expect(screen.getByTestId("employee-mobile-card-4")).toBeInTheDocument();
  });

  it("empty state still renders on mobile (no card block when zero employees)", () => {
    render(<EmployeesTable employees={[]} />);
    expect(screen.getByText(/No employees yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-mobile")).not.toBeInTheDocument();
  });
});
