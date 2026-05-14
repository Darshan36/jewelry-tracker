import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/purchases",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
  softDeletePurchase: vi.fn(),
}));

vi.mock("./payment-actions", () => ({
  createPurchasePayment: vi.fn(),
  softDeletePurchasePayment: vi.fn(),
}));

vi.mock("./return-actions", () => ({
  createPurchaseReturn: vi.fn(),
  softDeletePurchaseReturn: vi.fn(),
}));

import { PurchasesTable } from "./purchases-table";
import type { PurchaseForClient } from "./purchase-helpers";
import type { SupplierOption } from "./party-picker";

const suppliers: SupplierOption[] = [
  { id: "s1", name: "Acme Metals", phone: "9111111111" },
];

function makePurchase(
  overrides: Partial<PurchaseForClient> = {},
): PurchaseForClient {
  return {
    id: "p-default",
    date: new Date("2026-05-10T00:00:00Z"),
    supplierId: null,
    partyName: "Default Walkin Vendor",
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

function mixedPurchases(): PurchaseForClient[] {
  return [
    makePurchase({
      id: "p1",
      date: new Date("2026-01-01T00:00:00Z"),
      partyName: "Acme Metals",
      partyPhone: "9111111111",
      itemDescription: "Gold wire",
      total: 240000,
      supplierId: "s1",
      status: "pending",
    }),
    makePurchase({
      id: "p2",
      date: new Date("2026-02-01T00:00:00Z"),
      partyName: "Bombay Tools",
      partyPhone: "9222222222",
      itemDescription: "Silver casting",
      total: 150000,
      supplierId: null,
      status: "pending",
    }),
    makePurchase({
      id: "p3",
      date: new Date("2026-03-01T00:00:00Z"),
      partyName: "Crown Polish",
      partyPhone: null,
      itemDescription: "Polish chemicals",
      total: 50000,
      supplierId: "s1",
      status: "pending",
    }),
  ];
}

describe("PurchasesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty states", () => {
    it("shows 'No purchases yet' when the prop is empty", () => {
      render(<PurchasesTable purchases={[]} suppliers={suppliers} />);
      expect(
        screen.getByText(/No purchases yet\. Add your first purchase to get started\./i),
      ).toBeInTheDocument();
    });

    it("shows 'No purchases match your search' when search filters all rows out", async () => {
      const user = userEvent.setup();
      render(
        <PurchasesTable
          purchases={[makePurchase({ partyName: "Acme", itemDescription: "Wire" })]}
          suppliers={suppliers}
        />,
      );

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "zzzz-no-match",
      );

      expect(
        screen.getByText(/No purchases match your search\./i),
      ).toBeInTheDocument();
    });
  });

  describe("rendering", () => {
    it("renders Date, Party, Item, Total, Status column headers", () => {
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);
      expect(screen.getByRole("columnheader", { name: /date/i })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /party/i })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /^item$/i })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /total/i })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /status/i })).toBeInTheDocument();
    });

    it("renders one row per purchase", () => {
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);
      expect(screen.getByText("Acme Metals")).toBeInTheDocument();
      expect(screen.getByText("Bombay Tools")).toBeInTheDocument();
      expect(screen.getByText("Crown Polish")).toBeInTheDocument();
    });

    it("renders a status chip for each row (all Pending here)", () => {
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);
      const table = screen.getByRole("table");
      expect(within(table).getAllByText("Pending")).toHaveLength(3);
    });

    it("renders the link icon for linked-supplier rows, not for walk-ins", () => {
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);
      const table = screen.getByRole("table");
      // p1 and p3 are linked (supplierId: "s1"), p2 is walk-in
      const linkIcons = within(table).getAllByLabelText(/linked supplier/i);
      expect(linkIcons).toHaveLength(2);
    });

    it("renders the party phone subtitle when present", () => {
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);
      expect(screen.getByText("9111111111")).toBeInTheDocument();
      expect(screen.getByText("9222222222")).toBeInTheDocument();
    });

    it("renders the total formatted in Indian currency (₹) with comma grouping", () => {
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);
      expect(screen.getByText(/₹\s*2,400\.00/)).toBeInTheDocument();
    });
  });

  describe("search", () => {
    it("filters rows by partial partyName match", async () => {
      const user = userEvent.setup();
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "acme",
      );

      expect(screen.getByText("Acme Metals")).toBeInTheDocument();
      expect(screen.queryByText("Bombay Tools")).not.toBeInTheDocument();
    });

    it("filters rows by partyPhone substring", async () => {
      const user = userEvent.setup();
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "92222",
      );

      expect(screen.getByText("Bombay Tools")).toBeInTheDocument();
      expect(screen.queryByText("Acme Metals")).not.toBeInTheDocument();
    });

    it("filters rows by itemDescription substring", async () => {
      const user = userEvent.setup();
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);

      await user.type(
        screen.getByPlaceholderText(/Search by party, phone, or item/i),
        "silver",
      );

      expect(screen.getByText("Bombay Tools")).toBeInTheDocument();
      expect(screen.queryByText("Acme Metals")).not.toBeInTheDocument();
    });
  });

  describe("sort", () => {
    it("defaults to date desc (newest first)", () => {
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);
      const html = document.body.textContent ?? "";
      // p3 (Mar) > p2 (Feb) > p1 (Jan)
      expect(html.indexOf("Crown Polish")).toBeLessThan(html.indexOf("Bombay Tools"));
      expect(html.indexOf("Bombay Tools")).toBeLessThan(html.indexOf("Acme Metals"));
    });

    it("clicking Date header toggles to asc", async () => {
      const user = userEvent.setup();
      render(<PurchasesTable purchases={mixedPurchases()} suppliers={suppliers} />);

      await user.click(screen.getByRole("button", { name: /^date/i }));

      const html = document.body.textContent ?? "";
      expect(html.indexOf("Acme Metals")).toBeLessThan(html.indexOf("Bombay Tools"));
      expect(html.indexOf("Bombay Tools")).toBeLessThan(html.indexOf("Crown Polish"));
    });
  });

  describe("row interactions", () => {
    it("renders Edit and Delete action buttons for each row", () => {
      render(
        <PurchasesTable
          purchases={[makePurchase({ partyName: "X" })]}
          suppliers={suppliers}
        />,
      );
      expect(
        screen.getByRole("button", { name: /edit purchase/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /delete purchase/i }),
      ).toBeInTheDocument();
    });

    it("clicking Edit does NOT fire the row click (stopPropagation works)", async () => {
      const user = userEvent.setup();
      render(
        <PurchasesTable
          purchases={[makePurchase({ partyName: "X" })]}
          suppliers={suppliers}
        />,
      );

      await user.click(screen.getByRole("button", { name: /edit purchase/i }));

      const openDialogs = screen.getAllByRole("dialog");
      expect(openDialogs).toHaveLength(1);
      expect(screen.getByText(/edit purchase/i)).toBeInTheDocument();
    });
  });
});
