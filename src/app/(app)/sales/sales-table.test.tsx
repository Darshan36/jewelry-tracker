import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/sales",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
  softDeleteSale: vi.fn(),
}));

vi.mock("./payment-actions", () => ({
  createSalePayment: vi.fn(),
  softDeleteSalePayment: vi.fn(),
}));

vi.mock("./return-actions", () => ({
  createSaleReturn: vi.fn(),
  softDeleteSaleReturn: vi.fn(),
}));

import { SalesTable } from "./sales-table";
import type { SaleForClient } from "./sale-helpers";
import type { CustomerOption } from "./party-picker";

const customers: CustomerOption[] = [
  { id: "c1", name: "Alice", phone: "9111111111" },
];

function makeSale(overrides: Partial<SaleForClient> = {}): SaleForClient {
  return {
    id: "s-default",
    date: new Date("2026-05-10T00:00:00Z"),
    customerId: null,
    partyName: "Default Walkin",
    partyPhone: "9000000000",
    itemDescription: "Default item",
    qty: 1,
    rate: 10000,
    discount: 0,
    total: 10000,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    paidAmount: 0,
    returnTotal: 0,
    status: "pending",
    payments: [],
    returns: [],
    ...overrides,
  };
}

function mixedSales(): SaleForClient[] {
  return [
    makeSale({
      id: "s1",
      date: new Date("2026-01-01T00:00:00Z"),
      partyName: "Alice Anand",
      partyPhone: "9111111111",
      itemDescription: "Gold-plated chain",
      total: 240000,
      customerId: "c1",
      status: "pending",
    }),
    makeSale({
      id: "s2",
      date: new Date("2026-02-01T00:00:00Z"),
      partyName: "Bob Bose",
      partyPhone: "9222222222",
      itemDescription: "Silver bracelet",
      total: 150000,
      customerId: null,
      status: "pending",
    }),
    makeSale({
      id: "s3",
      date: new Date("2026-03-01T00:00:00Z"),
      partyName: "Cara Chen",
      partyPhone: null,
      itemDescription: "Earrings",
      total: 50000,
      customerId: "c1",
      status: "pending",
    }),
  ];
}

describe("SalesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty states", () => {
    it("shows 'No sales yet' when the prop is empty", () => {
      render(<SalesTable sales={[]} customers={customers} />);
      expect(
        screen.getByText(/No sales yet\. Add your first sale to get started\./i),
      ).toBeInTheDocument();
    });

    it("shows 'No sales match your search' when search filters all rows out", async () => {
      const user = userEvent.setup();
      render(
        <SalesTable
          sales={[makeSale({ partyName: "Alice", itemDescription: "Chain" })]}
          customers={customers}
        />,
      );

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "zzzz-no-match",
      );

      expect(
        screen.getByText(/No sales match your search\./i),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("renders Date, Party, Item, Total, Status column headers", () => {
      render(<SalesTable sales={mixedSales()} customers={customers} />);
      expect(
        screen.getByRole("columnheader", { name: /date/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /party/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /^item$/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /total/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("columnheader", { name: /status/i }),
      ).toBeInTheDocument();
    });

    it("renders one row per sale", () => {
      render(<SalesTable sales={mixedSales()} customers={customers} />);
      expect(screen.getByText("Alice Anand")).toBeInTheDocument();
      expect(screen.getByText("Bob Bose")).toBeInTheDocument();
      expect(screen.getByText("Cara Chen")).toBeInTheDocument();
    });

    it("renders a status chip for each row (Phase 3.1: all Pending)", () => {
      render(<SalesTable sales={mixedSales()} customers={customers} />);
      const table = screen.getByRole("table");
      expect(within(table).getAllByText("Pending")).toHaveLength(3);
    });

    it("renders the link icon for linked-customer rows, not for walk-ins", () => {
      render(<SalesTable sales={mixedSales()} customers={customers} />);
      const table = screen.getByRole("table");
      // s1 and s3 are linked (customerId: "c1"), s2 is walk-in
      const linkIcons = within(table).getAllByLabelText(/linked customer/i);
      expect(linkIcons).toHaveLength(2);
    });

    it("renders the party phone subtitle when present", () => {
      render(<SalesTable sales={mixedSales()} customers={customers} />);
      expect(screen.getByText("9111111111")).toBeInTheDocument();
      expect(screen.getByText("9222222222")).toBeInTheDocument();
      // Cara has no phone — no element with her phone
    });

    it("renders the total formatted in Indian currency (₹) with comma grouping", () => {
      render(<SalesTable sales={mixedSales()} customers={customers} />);
      // s1: 240000 paise → ₹2,400.00
      expect(screen.getByText(/₹\s*2,400\.00/)).toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("filters rows by partial partyName match", async () => {
      const user = userEvent.setup();
      render(<SalesTable sales={mixedSales()} customers={customers} />);

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "alice",
      );

      expect(screen.getByText("Alice Anand")).toBeInTheDocument();
      expect(screen.queryByText("Bob Bose")).not.toBeInTheDocument();
    });

    it("filters rows by partyPhone substring", async () => {
      const user = userEvent.setup();
      render(<SalesTable sales={mixedSales()} customers={customers} />);

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "92222",
      );

      expect(screen.getByText("Bob Bose")).toBeInTheDocument();
      expect(screen.queryByText("Alice Anand")).not.toBeInTheDocument();
    });

    it("filters rows by itemDescription substring", async () => {
      const user = userEvent.setup();
      render(<SalesTable sales={mixedSales()} customers={customers} />);

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "silver",
      );

      expect(screen.getByText("Bob Bose")).toBeInTheDocument();
      expect(screen.queryByText("Alice Anand")).not.toBeInTheDocument();
    });
  });

  describe("sort", () => {
    it("defaults to date desc (newest first)", () => {
      render(<SalesTable sales={mixedSales()} customers={customers} />);
      const html = document.body.textContent ?? "";
      // Cara (Mar) > Bob (Feb) > Alice (Jan)
      expect(html.indexOf("Cara Chen")).toBeLessThan(html.indexOf("Bob Bose"));
      expect(html.indexOf("Bob Bose")).toBeLessThan(html.indexOf("Alice Anand"));
    });

    it("clicking Date header toggles to asc", async () => {
      const user = userEvent.setup();
      render(<SalesTable sales={mixedSales()} customers={customers} />);

      await user.click(screen.getByRole("button", { name: /^date/i }));

      const html = document.body.textContent ?? "";
      // Alice (Jan) > Bob (Feb) > Cara (Mar)
      expect(html.indexOf("Alice Anand")).toBeLessThan(html.indexOf("Bob Bose"));
      expect(html.indexOf("Bob Bose")).toBeLessThan(html.indexOf("Cara Chen"));
    });
  });

  describe("row interactions", () => {
    it("renders Edit and Delete action buttons for each row", () => {
      render(
        <SalesTable
          sales={[makeSale({ partyName: "X" })]}
          customers={customers}
        />,
      );
      expect(
        screen.getByRole("button", { name: /edit sale/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /delete sale/i }),
      ).toBeInTheDocument();
    });

    it("clicking Edit does NOT fire the row click (stopPropagation works)", async () => {
      const user = userEvent.setup();
      render(
        <SalesTable
          sales={[makeSale({ partyName: "X" })]}
          customers={customers}
        />,
      );

      await user.click(screen.getByRole("button", { name: /edit sale/i }));

      // Edit modal opens → exactly ONE dialog visible. If stopPropagation
      // failed, the row click would also fire opening the detail modal → 2.
      const openDialogs = screen.getAllByRole("dialog");
      expect(openDialogs).toHaveLength(1);
      expect(screen.getByText(/edit sale/i)).toBeInTheDocument();
    });
  });
});
