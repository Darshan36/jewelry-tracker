import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PartyRoleChips } from "./party-role-chips";

describe("PartyRoleChips", () => {
  it("renders nothing when all role flags are false", () => {
    const { container } = render(
      <PartyRoleChips
        party={{
          isCustomer: false,
          isSupplier: false,
          isCastingVendor: false,
          isPlatingVendor: false,
        }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one chip per active role flag", () => {
    render(
      <PartyRoleChips
        party={{
          isCustomer: true,
          isSupplier: true,
          isCastingVendor: false,
          isPlatingVendor: false,
        }}
      />,
    );
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Supplier")).toBeInTheDocument();
    expect(screen.queryByText("Casting Vendor")).not.toBeInTheDocument();
    expect(screen.queryByText("Plating Vendor")).not.toBeInTheDocument();
  });

  it("renders all four chips for a fully-roled party", () => {
    render(
      <PartyRoleChips
        party={{
          isCustomer: true,
          isSupplier: true,
          isCastingVendor: true,
          isPlatingVendor: true,
        }}
      />,
    );
    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByText("Supplier")).toBeInTheDocument();
    expect(screen.getByText("Casting Vendor")).toBeInTheDocument();
    expect(screen.getByText("Plating Vendor")).toBeInTheDocument();
  });

  it("single-role customer-only party shows only Customer chip", () => {
    render(
      <PartyRoleChips
        party={{
          isCustomer: true,
          isSupplier: false,
          isCastingVendor: false,
          isPlatingVendor: false,
        }}
      />,
    );
    const container = screen.getByTestId("party-role-chips");
    expect(container.children).toHaveLength(1);
    expect(screen.getByText("Customer")).toBeInTheDocument();
  });
});
