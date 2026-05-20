// Tests for SalesTable — focused on Phase 12c photo-count badge.
//
// The table's interactive surfaces (search filter, action-modal mounting,
// row click → detail modal) are exercised end-to-end via the production
// Playwright walkthroughs. This file is net-new for Phase 12c and stays
// scoped to the photo-count indicator the phase adds.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  softDeleteSale: vi.fn(),
}));
vi.mock("./payment-actions", () => ({
  createSalePayment: vi.fn(),
}));
vi.mock("./return-actions", () => ({
  createSaleReturn: vi.fn(),
}));

// Action modals + detail modal — mocked as inert markers so the test
// stays focused on the table cell rendering, not modal mount semantics.
vi.mock("@/components/action-modals/payment-action-modal", () => ({
  PaymentActionModal: () => null,
}));
vi.mock("@/components/action-modals/attachment-action-modal", () => ({
  AttachmentActionModal: () => null,
}));
vi.mock("@/components/action-modals/return-action-modal", () => ({
  ReturnActionModal: () => null,
}));
vi.mock("./sale-detail-modal", () => ({
  SaleDetailModal: () => null,
}));

import { SalesTable } from "./sales-table";
import type { SaleForClient } from "./sale-helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeSale(overrides: Partial<SaleForClient> = {}): SaleForClient {
  return {
    id: "sale-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: null,
    partyName: "Acme Customer",
    partyPhone: "9876543210",
    discount: 0,
    total: 100000,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lineItems: [
      {
        id: "li-1",
        saleId: "sale-1",
        itemDescription: "Test item",
        qty: 1,
        rate: 100000,
        createdAt: new Date(),
      },
    ],
    payments: [],
    returns: [],
    paidAmount: 0,
    returnTotal: 0,
    status: "pending",
    photoCount: 0,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// =====================================================================
// Photo count badge (Phase 12c) — mirror of purchases-table.test.tsx
// =====================================================================

describe("SalesTable — photo count badge", () => {
  it("renders the badge when photoCount > 0", () => {
    render(<SalesTable sales={[makeSale({ photoCount: 3 })]} />);
    const badge = screen.getByTestId("photo-count-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute("data-count")).toBe("3");
    expect(badge).toHaveAccessibleName(/3 photos/i);
  });

  it("does NOT render the badge when photoCount === 0", () => {
    render(<SalesTable sales={[makeSale({ photoCount: 0 })]} />);
    expect(screen.queryByTestId("photo-count-badge")).toBeNull();
  });

  it("singular accessible-name for photoCount === 1", () => {
    render(<SalesTable sales={[makeSale({ photoCount: 1 })]} />);
    const badge = screen.getByTestId("photo-count-badge");
    expect(badge).toHaveAccessibleName(/1 photo/i);
    // And does NOT match the plural form.
    expect(badge).not.toHaveAccessibleName(/photos/i);
  });
});

// Phase 20 — Print bill trigger button (desktop row + mobile card).
describe("SalesTable — Print bill trigger (Phase 20)", () => {
  it("renders a Print bill anchor in the desktop row pointing to /sales/[id]/bill", () => {
    render(<SalesTable sales={[makeSale({ id: "sale-abc" })]} />);
    const printAnchor = screen.getByTestId("print-bill-sale-abc");
    expect(printAnchor).toBeInTheDocument();
    expect(printAnchor.tagName).toBe("A");
    expect(printAnchor).toHaveAttribute("href", "/sales/sale-abc/bill");
    expect(printAnchor).toHaveAttribute("target", "_blank");
    expect(printAnchor).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("Print bill is DISTINCT from the Paperclip 'Manage invoice attachment' button", () => {
    render(<SalesTable sales={[makeSale({ id: "sale-1" })]} />);
    const printBtn = screen.getByTestId("print-bill-sale-1");
    const attachBtn = screen.getByRole("button", {
      name: /manage invoice attachment/i,
    });
    expect(printBtn).not.toBe(attachBtn);
    // Print is an <a target=_blank>; attachment is a <button>.
    expect(printBtn.tagName).toBe("A");
    expect(attachBtn.tagName).toBe("BUTTON");
  });

  it("Print bill title attribute reads 'Print bill'", () => {
    render(<SalesTable sales={[makeSale({ id: "sale-x" })]} />);
    const printAnchor = screen.getByTestId("print-bill-sale-x");
    expect(printAnchor).toHaveAttribute("title", "Print bill");
  });
});
