// Phase 11.2: vendors-table mobile-viewport coverage.
//
// The vendor table aggregates casting + plating counts + owed per
// vendor. The mobile card surface needs to render those derived values
// in addition to name + phone.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/vendors",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createVendor: vi.fn(),
  updateVendor: vi.fn(),
  softDeleteVendor: vi.fn(),
}));

import { VendorsTable, type VendorForClient } from "./vendors-table";
import { mockMobileViewport } from "@/test-utils/viewport";

function makeVendor(overrides: Partial<VendorForClient> = {}): VendorForClient {
  return {
    id: "ven-1",
    name: "Default Vendor",
    phone: "9876543210",
    address: null,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    castingCount: 0,
    platingCount: 0,
    owedPaise: 0,
    ...overrides,
  };
}

function threeVendors(): VendorForClient[] {
  return [
    makeVendor({
      id: "1",
      name: "Vendor A",
      phone: "1111111111",
      castingCount: 3,
      platingCount: 0,
      owedPaise: 150000,
    }),
    makeVendor({
      id: "2",
      name: "Vendor B",
      phone: "2222222222",
      castingCount: 0,
      platingCount: 5,
      owedPaise: 0,
    }),
    makeVendor({
      id: "3",
      name: "Vendor C",
      phone: "3333333333",
      castingCount: 2,
      platingCount: 2,
      owedPaise: 75000,
    }),
  ];
}

describe("VendorsTable — mobile viewport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMobileViewport();
  });

  it("renders mobile cards instead of the desktop table", () => {
    render(<VendorsTable vendors={threeVendors()} />);

    expect(screen.getByTestId("responsive-table-mobile")).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-desktop")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders one mobile card per vendor", () => {
    render(<VendorsTable vendors={threeVendors()} />);

    expect(screen.getByTestId("vendor-mobile-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("vendor-mobile-card-2")).toBeInTheDocument();
    expect(screen.getByTestId("vendor-mobile-card-3")).toBeInTheDocument();
  });

  it("shows the vendor's name + phone on each card", () => {
    render(<VendorsTable vendors={[makeVendor({ id: "x", name: "Mira Casting", phone: "9988776655" })]} />);

    const card = screen.getByTestId("vendor-mobile-card-x");
    expect(within(card).getByText("Mira Casting")).toBeInTheDocument();
    expect(within(card).getByText("9988776655")).toBeInTheDocument();
  });

  it("renders the casting + plating counts on each card", () => {
    render(<VendorsTable vendors={threeVendors()} />);

    const cardA = screen.getByTestId("vendor-mobile-card-1");
    expect(within(cardA).getByText(/3 casting · 0 plating/i)).toBeInTheDocument();

    const cardC = screen.getByTestId("vendor-mobile-card-3");
    expect(within(cardC).getByText(/2 casting · 2 plating/i)).toBeInTheDocument();
  });

  it("shows owed amount only when owedPaise > 0", () => {
    render(<VendorsTable vendors={threeVendors()} />);

    // Vendor A owes 150000 paise = ₹1,500.00.
    const cardA = screen.getByTestId("vendor-mobile-card-1");
    expect(within(cardA).getByText(/₹1,500/)).toBeInTheDocument();

    // Vendor B owes 0 — no currency line.
    const cardB = screen.getByTestId("vendor-mobile-card-2");
    expect(within(cardB).queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("shows 'no jobs yet' annotation when vendor has zero entries", () => {
    const noJobs = [
      makeVendor({
        id: "x",
        name: "Empty Vendor",
        castingCount: 0,
        platingCount: 0,
      }),
    ];
    render(<VendorsTable vendors={noJobs} />);

    const card = screen.getByTestId("vendor-mobile-card-x");
    expect(within(card).getByText(/no jobs yet/i)).toBeInTheDocument();
  });

  it("omits phone line when phone is null", () => {
    render(<VendorsTable vendors={[makeVendor({ id: "x", name: "Anonymous", phone: null })]} />);

    const card = screen.getByTestId("vendor-mobile-card-x");
    expect(within(card).getByText("Anonymous")).toBeInTheDocument();
    expect(within(card).queryByText("9876543210")).not.toBeInTheDocument();
  });

  it("does not render inline action buttons on mobile cards", () => {
    render(<VendorsTable vendors={threeVendors()} />);

    expect(screen.queryByRole("button", { name: /edit vendor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete vendor/i })).not.toBeInTheDocument();
  });

  it("tapping a mobile card opens the detail modal", async () => {
    const user = userEvent.setup();
    render(<VendorsTable vendors={[makeVendor({ id: "x", name: "Tap target Vendor" })]} />);

    await user.click(screen.getByTestId("vendor-mobile-card-x"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Tap target Vendor")).toBeInTheDocument();
    expect(within(dialog).getByText(/casting jobs/i)).toBeInTheDocument();
  });

  it("empty state still renders on mobile", () => {
    render(<VendorsTable vendors={[]} />);
    expect(screen.getByText(/No vendors yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("responsive-table-mobile")).not.toBeInTheDocument();
  });
});
