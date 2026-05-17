import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mocks must be declared before the imports of the modules they replace.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  softDeleteCustomer: vi.fn(),
}));

import type { Customer } from "@/generated/prisma";

import { CustomersTable } from "./customers-table";

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cust-1",
    name: "Default Customer",
    phone: "9876543210",
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

// Three customers with distinct names + dates for sort tests.
function threeCustomers(): Customer[] {
  return [
    makeCustomer({
      id: "1",
      name: "Alice",
      phone: "1111111111",
      email: "alice@example.com",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }),
    makeCustomer({
      id: "2",
      name: "Bob",
      phone: "2222222222",
      email: "bob@example.com",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    }),
    makeCustomer({
      id: "3",
      name: "Cara",
      phone: "3333333333",
      email: "cara@example.com",
      createdAt: new Date("2026-03-01T00:00:00Z"),
    }),
  ];
}

function rowOrder(): string[] {
  // All <tr> with role="row" — skip the first one (header).
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const nameCell = within(row).getAllByRole("cell")[0];
      return nameCell?.textContent ?? "";
    });
}

describe("CustomersTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty states", () => {
    it("shows 'No customers yet' when customers prop is empty", () => {
      render(<CustomersTable customers={[]} />);
      expect(
        screen.getByText(
          /No customers yet\. Add your first customer to get started\./i,
        ),
      ).toBeInTheDocument();
    });

    it("shows 'No customers match your search' when search filters all rows out", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={[makeCustomer({ name: "Alice" })]} />);

      await user.type(
        screen.getByPlaceholderText(/Search customers/i),
        "zzzzz",
      );

      expect(
        screen.getByText(/No customers match your search\./i),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("renders one row per customer", () => {
      render(<CustomersTable customers={threeCustomers()} />);
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Cara")).toBeInTheDocument();
    });

    it("renders Name, Phone, and Created column headers", () => {
      render(<CustomersTable customers={threeCustomers()} />);
      expect(
        screen.getByRole("columnheader", { name: /name/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /phone/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /created/i }),
      ).toBeInTheDocument();
    });

    it("displays — for null phone", () => {
      render(
        <CustomersTable
          customers={[makeCustomer({ name: "NoPhone", phone: null })]}
        />,
      );
      const row = screen.getByText("NoPhone").closest("tr")!;
      expect(within(row).getByText("—")).toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("filters rows by partial name match", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={threeCustomers()} />);

      await user.type(screen.getByPlaceholderText(/Search customers/i), "ali");

      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();
      expect(screen.queryByText("Cara")).not.toBeInTheDocument();
    });

    it("filters case-insensitively", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={threeCustomers()} />);

      await user.type(screen.getByPlaceholderText(/Search customers/i), "ALICE");

      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    });

    it("filters by phone number", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={threeCustomers()} />);

      await user.type(
        screen.getByPlaceholderText(/Search customers/i),
        "2222",
      );

      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.queryByText("Cara")).not.toBeInTheDocument();
    });

    it("restores all rows when search is cleared", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={threeCustomers()} />);

      const input = screen.getByPlaceholderText(/Search customers/i);
      await user.type(input, "ali");
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();

      await user.clear(input);
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Cara")).toBeInTheDocument();
    });
  });

  describe("sort", () => {
    it("defaults to createdAt desc (newest first)", () => {
      render(<CustomersTable customers={threeCustomers()} />);
      // Cara (Mar) > Bob (Feb) > Alice (Jan)
      expect(rowOrder()).toEqual(["Cara", "Bob", "Alice"]);
    });

    it("clicking Name header sorts ascending alphabetically", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={threeCustomers()} />);

      await user.click(screen.getByRole("button", { name: /^name/i }));

      expect(rowOrder()).toEqual(["Alice", "Bob", "Cara"]);
    });

    it("clicking Name header twice sorts descending alphabetically", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={threeCustomers()} />);

      const nameHeader = screen.getByRole("button", { name: /^name/i });
      await user.click(nameHeader); // asc
      await user.click(nameHeader); // desc

      expect(rowOrder()).toEqual(["Cara", "Bob", "Alice"]);
    });
  });

  describe("row interactions", () => {
    it("renders Edit and Delete action buttons for each row (queryable in DOM)", () => {
      render(<CustomersTable customers={[makeCustomer({ name: "Test" })]} />);

      expect(
        screen.getByRole("button", { name: /edit customer/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /delete customer/i }),
      ).toBeInTheDocument();
    });

    it("clicking the Edit icon does NOT fire the row click (stopPropagation works)", async () => {
      const user = userEvent.setup();
      render(<CustomersTable customers={[makeCustomer({ name: "Test" })]} />);

      await user.click(
        screen.getByRole("button", { name: /edit customer/i }),
      );

      // The Edit modal opened — exactly ONE dialog. If stopPropagation
      // failed, the row click would also fire and open the detail modal,
      // producing TWO open dialogs.
      const openDialogs = screen.getAllByRole("dialog");
      expect(openDialogs).toHaveLength(1);

      // And the one open dialog is the Edit form, not the detail view.
      expect(screen.getByText(/edit customer/i)).toBeInTheDocument();
    });
  });
});

// =====================================================================
// Mobile viewport — Phase 11.2.
// =====================================================================
//
// `useIsMobile()` reads `window.matchMedia` once on mount; the global
// vitest.setup.ts stub returns `matches: false` (desktop), so the tests
// above all execute the desktop table branch. This block flips the stub
// to `matches: true` so ResponsiveTable's mobile branch renders, then
// asserts the mobile-card surface — not the desktop <table>.
import { mockMobileViewport } from "@/test-utils/viewport";

describe("CustomersTable — mobile viewport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMobileViewport();
  });

  it("renders mobile cards instead of the desktop table", () => {
    render(<CustomersTable customers={threeCustomers()} />);

    expect(screen.getByTestId("responsive-table-mobile")).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-desktop")).not.toBeInTheDocument();
    // No <table> on mobile.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders one mobile card per customer", () => {
    render(<CustomersTable customers={threeCustomers()} />);

    expect(screen.getByTestId("customer-mobile-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("customer-mobile-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("customer-mobile-card-3")).toBeInTheDocument();
  });

  it("each mobile card shows the customer's name + phone", () => {
    render(<CustomersTable customers={[makeCustomer({ id: "x", name: "Mira", phone: "9988776655" })]} />);

    const card = screen.getByTestId("customer-mobile-card-x");
    expect(within(card).getByText("Mira")).toBeInTheDocument();
    expect(within(card).getByText("9988776655")).toBeInTheDocument();
  });

  it("omits the phone line when phone is null", () => {
    render(<CustomersTable customers={[makeCustomer({ id: "x", name: "NoPhone", phone: null })]} />);

    const card = screen.getByTestId("customer-mobile-card-x");
    expect(within(card).getByText("NoPhone")).toBeInTheDocument();
    expect(within(card).queryByText("9876543210")).not.toBeInTheDocument();
  });

  it("does not render inline action buttons on mobile cards (mutations go through detail modal Edit)", () => {
    render(<CustomersTable customers={threeCustomers()} />);

    // No per-card edit/delete icon buttons — that surface is desktop-only
    // for master data. The cards themselves are tap targets opening the
    // detail modal.
    expect(screen.queryByRole("button", { name: /edit customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete customer/i })).not.toBeInTheDocument();
  });

  it("tapping a mobile card opens the customer detail modal", async () => {
    const user = userEvent.setup();
    render(<CustomersTable customers={[makeCustomer({ id: "x", name: "Tap target" })]} />);

    await user.click(screen.getByTestId("customer-mobile-card-x"));

    // Detail modal opened — scope to the dialog and verify the name + a
    // unique-to-detail field (Created label).
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Tap target")).toBeInTheDocument();
    expect(within(dialog).getByText(/created/i)).toBeInTheDocument();
  });

  it("empty state still renders on mobile (no cards block when zero customers)", () => {
    render(<CustomersTable customers={[]} />);
    expect(
      screen.getByText(/No customers yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-mobile")).not.toBeInTheDocument();
  });
});
