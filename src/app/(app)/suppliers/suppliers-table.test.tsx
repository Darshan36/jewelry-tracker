// Phase 11.2: suppliers-table mobile-viewport coverage.
//
// Phase 2 didn't ship a suppliers-table.test.tsx (the customers test
// covered the equivalent flow, and the implementations were a near-clone
// pair). Phase 11.2 needs to lock in the mobile-card surface for
// suppliers specifically — adding here rather than expanding customers'
// scope makes the per-entity test boundary cleaner.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/suppliers",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  softDeleteSupplier: vi.fn(),
}));

import type { Party as Supplier } from "@/generated/prisma";

import { SuppliersTable } from "./suppliers-table";
import { mockMobileViewport } from "@/test-utils/viewport";

function makeParty(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: "sup-1",
    name: "Default Supplier",
    phone: "9876543210",
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    isCustomer: false,
    isSupplier: false,
    isCastingVendor: false,
    isPlatingVendor: false,
    createdById: null,
    updatedById: null,
    deletedById: null,
    ...overrides,
  };
}

function threeSuppliers(): Supplier[] {
  return [
    makeParty({ id: "1", name: "Alpha Metals", phone: "1111111111" }),
    makeParty({ id: "2", name: "Bravo Casting", phone: "2222222222" }),
    makeParty({ id: "3", name: "Charlie Polish", phone: "3333333333" }),
  ];
}

describe("SuppliersTable — mobile viewport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMobileViewport();
  });

  it("renders mobile cards instead of the desktop table", () => {
    render(<SuppliersTable parties={threeSuppliers()} />);

    expect(screen.getByTestId("responsive-table-mobile")).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-desktop")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders one mobile card per supplier", () => {
    render(<SuppliersTable parties={threeSuppliers()} />);

    expect(screen.getByTestId("supplier-mobile-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("supplier-mobile-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("supplier-mobile-card-3")).toBeInTheDocument();
  });

  it("each mobile card shows the supplier's name + phone", () => {
    render(<SuppliersTable parties={[makeParty({ id: "x", name: "Mira Metals", phone: "9988776655" })]} />);

    const card = screen.getByTestId("supplier-mobile-card-x");
    expect(within(card).getByText("Mira Metals")).toBeInTheDocument();
    expect(within(card).getByText("9988776655")).toBeInTheDocument();
  });

  it("omits the phone line when phone is null", () => {
    render(<SuppliersTable parties={[makeParty({ id: "x", name: "NoPhone Co", phone: null })]} />);

    const card = screen.getByTestId("supplier-mobile-card-x");
    expect(within(card).getByText("NoPhone Co")).toBeInTheDocument();
    expect(within(card).queryByText("9876543210")).not.toBeInTheDocument();
  });

  it("does not render inline action buttons on mobile cards", () => {
    render(<SuppliersTable parties={threeSuppliers()} />);

    expect(screen.queryByRole("button", { name: /edit supplier/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete supplier/i })).not.toBeInTheDocument();
  });

  it("tapping a mobile card opens the detail modal", async () => {
    const user = userEvent.setup();
    render(<SuppliersTable parties={[makeParty({ id: "x", name: "Tap target Co" })]} />);

    await user.click(screen.getByTestId("supplier-mobile-card-x"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Tap target Co")).toBeInTheDocument();
    expect(within(dialog).getByText(/created/i)).toBeInTheDocument();
  });

  it("empty state still renders on mobile", () => {
    render(<SuppliersTable parties={[]} />);
    expect(screen.getByText(/No suppliers yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-mobile")).not.toBeInTheDocument();
  });
});
