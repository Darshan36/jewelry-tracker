// Tests for PurchasesTable — basic render + per-row action wiring.
//
// The TanStack Table internals are exercised by the library's own
// tests; we focus on:
//   1. Empty state vs rows
//   2. Quick-action button clicks mount the right action modal with
//      `entityType="purchase"` (regression guard for the Phase 10.5 mirror
//      bug where the entityType string leaked through as "sale" in
//      string-literal JSX).
//   3. Row click opens the detail modal.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  softDeletePurchase: vi.fn(),
}));
vi.mock("./payment-actions", () => ({
  createPurchasePayment: vi.fn(),
}));
vi.mock("./return-actions", () => ({
  createPurchaseReturn: vi.fn(),
}));

// Capture entityType prop passed to each action modal — this is the
// regression-guard signal for the Phase 10.5 mirror-script bug where
// `entityType="sale"` literals leaked into purchases-table.tsx.
const paymentModalSpy = vi.fn();
const billModalSpy = vi.fn();
const returnModalSpy = vi.fn();
const detailModalSpy = vi.fn();

vi.mock("@/components/action-modals/payment-action-modal", () => ({
  PaymentActionModal: (props: { entityType: string; entityId: string }) => {
    paymentModalSpy(props);
    return (
      <div
        data-testid="payment-modal-mounted"
        data-entity-type={props.entityType}
        data-entity-id={props.entityId}
      />
    );
  },
}));
vi.mock("@/components/action-modals/bill-action-modal", () => ({
  BillActionModal: (props: { entityType: string; entityId: string }) => {
    billModalSpy(props);
    return (
      <div
        data-testid="bill-modal-mounted"
        data-entity-type={props.entityType}
        data-entity-id={props.entityId}
      />
    );
  },
}));
vi.mock("@/components/action-modals/return-action-modal", () => ({
  ReturnActionModal: (props: { entityType: string; entityId: string }) => {
    returnModalSpy(props);
    return (
      <div
        data-testid="return-modal-mounted"
        data-entity-type={props.entityType}
        data-entity-id={props.entityId}
      />
    );
  },
}));
vi.mock("./purchase-detail-modal", () => ({
  PurchaseDetailModal: (props: {
    open: boolean;
    purchase: { id: string } | null;
  }) => {
    detailModalSpy(props);
    return props.open && props.purchase ? (
      <div data-testid="detail-modal-open" data-purchase-id={props.purchase.id} />
    ) : null;
  },
}));

import { PurchasesTable } from "./purchases-table";
import type { PurchaseForClient } from "./purchase-helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

function makePurchase(
  overrides: Partial<PurchaseForClient> = {},
): PurchaseForClient {
  return {
    id: "purchase-1",
    date: new Date("2026-05-10T00:00:00Z"),
    supplierId: null,
    partyName: "Acme Supplier",
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
        purchaseId: "purchase-1",
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
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("PurchasesTable — render states", () => {
  it("shows empty-state copy when there are no purchases", () => {
    render(<PurchasesTable purchases={[]} />);
    expect(screen.getByText(/no purchases yet/i)).toBeInTheDocument();
  });

  it("renders the Add purchase link to /purchases/new", () => {
    render(<PurchasesTable purchases={[]} />);
    expect(
      screen.getByRole("link", { name: /add purchase/i }),
    ).toHaveAttribute("href", "/purchases/new");
  });

  it("renders one row per purchase with party name + total", () => {
    render(<PurchasesTable purchases={[makePurchase()]} />);
    expect(screen.getByText(/acme supplier/i)).toBeInTheDocument();
    // Party phone shown as secondary line
    expect(screen.getByText("9876543210")).toBeInTheDocument();
    // formatCurrency formats paise → "₹1,000.00"
    expect(screen.getByText(/₹1,000\.00/)).toBeInTheDocument();
  });

  it("filters rows via the search input", async () => {
    const user = userEvent.setup();
    render(
      <PurchasesTable
        purchases={[
          makePurchase({ id: "p1", partyName: "Acme Co" }),
          makePurchase({
            id: "p2",
            partyName: "Beta Ltd",
            partyPhone: "1111111111",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/acme co/i)).toBeInTheDocument();
    expect(screen.getByText(/beta ltd/i)).toBeInTheDocument();

    const search = screen.getByPlaceholderText(/search by party/i);
    await user.type(search, "beta");

    expect(screen.queryByText(/acme co/i)).not.toBeInTheDocument();
    expect(screen.getByText(/beta ltd/i)).toBeInTheDocument();
  });

  it("shows no-matches copy when search filters out all rows", async () => {
    const user = userEvent.setup();
    render(<PurchasesTable purchases={[makePurchase()]} />);

    await user.type(screen.getByPlaceholderText(/search by party/i), "nope");
    expect(screen.getByText(/no purchases match your search/i)).toBeInTheDocument();
  });
});

// =====================================================================
// Regression-guard: every action modal must mount with entityType="purchase"
// =====================================================================

describe("PurchasesTable — action modal mount (entityType regression guard)", () => {
  it("clicking the 'Add payment' quick-action mounts PaymentActionModal with entityType='purchase'", async () => {
    const user = userEvent.setup();
    render(<PurchasesTable purchases={[makePurchase({ id: "p-42" })]} />);

    await user.click(screen.getByRole("button", { name: /add payment/i }));

    const modal = await screen.findByTestId("payment-modal-mounted");
    expect(modal.getAttribute("data-entity-type")).toBe("purchase");
    expect(modal.getAttribute("data-entity-id")).toBe("p-42");
  });

  it("clicking the 'Manage bill' quick-action mounts BillActionModal with entityType='purchase'", async () => {
    const user = userEvent.setup();
    render(<PurchasesTable purchases={[makePurchase({ id: "p-42" })]} />);

    await user.click(screen.getByRole("button", { name: /manage bill/i }));

    const modal = await screen.findByTestId("bill-modal-mounted");
    expect(modal.getAttribute("data-entity-type")).toBe("purchase");
    expect(modal.getAttribute("data-entity-id")).toBe("p-42");
  });

  it("clicking the 'Record return' quick-action mounts ReturnActionModal with entityType='purchase'", async () => {
    const user = userEvent.setup();
    render(<PurchasesTable purchases={[makePurchase({ id: "p-42" })]} />);

    await user.click(screen.getByRole("button", { name: /record return/i }));

    const modal = await screen.findByTestId("return-modal-mounted");
    expect(modal.getAttribute("data-entity-type")).toBe("purchase");
    expect(modal.getAttribute("data-entity-id")).toBe("p-42");
  });
});

describe("PurchasesTable — row click → detail modal", () => {
  it("clicking a row opens the detail modal with the right purchase id", async () => {
    const user = userEvent.setup();
    render(<PurchasesTable purchases={[makePurchase({ id: "p-99" })]} />);

    // The row text "Acme Supplier" is inside a <td> inside a <tr>; clicking
    // the party-name cell triggers the row's onClick.
    const partyCell = screen.getByText(/acme supplier/i);
    const row = partyCell.closest("tr");
    expect(row).not.toBeNull();
    await user.click(row!);

    const detail = await screen.findByTestId("detail-modal-open");
    expect(detail.getAttribute("data-purchase-id")).toBe("p-99");
  });

  it("the action buttons stop click-event propagation (clicking 'Add payment' does NOT open the detail modal)", async () => {
    const user = userEvent.setup();
    render(<PurchasesTable purchases={[makePurchase({ id: "p-99" })]} />);

    await user.click(screen.getByRole("button", { name: /add payment/i }));

    expect(screen.queryByTestId("detail-modal-open")).not.toBeInTheDocument();
    expect(await screen.findByTestId("payment-modal-mounted")).toBeInTheDocument();
  });
});

describe("PurchasesTable — delete confirmation", () => {
  it("shows the inline 'Delete?' confirm UI only after the trash button is clicked", async () => {
    const user = userEvent.setup();
    render(<PurchasesTable purchases={[makePurchase({ id: "p-1" })]} />);

    // Default state: no "Delete?" label visible.
    expect(screen.queryByText(/^delete\?$/i)).not.toBeInTheDocument();

    // The trash button is labelled aria-label="Delete purchase" per RowActions.
    const partyCell = screen.getByText(/acme supplier/i);
    const row = partyCell.closest("tr");
    expect(row).not.toBeNull();
    const trash = within(row!).getByRole("button", { name: /delete purchase/i });
    await user.click(trash);

    // After click: inline confirm appears with "Delete?" label + Cancel + Delete.
    expect(within(row!).getByText(/^delete\?$/i)).toBeInTheDocument();
    expect(within(row!).getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(within(row!).getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });
});
