// Tests for CastingTable — Phase 10.6 regression guard.
//
// Focus areas:
//   1. Empty state vs rows
//   2. Quick-action button clicks mount the right action modal with
//      `entityType="casting"` (regression guard for the Phase 10.5 mirror
//      bug class — Phase 10.6 added two more entity types).
//   3. Casting tables have TWO action buttons (Pay + Attachment), no Return.
//   4. AttachmentActionModal is mounted with both onAttach + onDetach props
//      (the FK-based attachment path that distinguishes casting/plating
//      from sales/purchases).
//   5. Row click opens the detail modal.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  softDeleteCastingEntry: vi.fn(),
  attachAttachmentToCastingEntry: vi.fn(),
  detachAttachmentFromCastingEntry: vi.fn(),
}));
vi.mock("./payment-actions", () => ({
  createCastingPayment: vi.fn(),
}));

// Capture entityType + onAttach/onDetach props passed to each action modal.
// This is the regression-guard signal for the Phase 10.5/10.6 mirror leak
// where `entityType="sale"` or `entityType="casting"` could leak between
// mirrored entity folders.
const paymentModalSpy = vi.fn();
const billModalSpy = vi.fn();
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
vi.mock("@/components/action-modals/attachment-action-modal", () => ({
  AttachmentActionModal: (props: {
    entityType: string;
    entityId: string;
    onAttach?: unknown;
    onDetach?: unknown;
  }) => {
    billModalSpy(props);
    return (
      <div
        data-testid="bill-modal-mounted"
        data-entity-type={props.entityType}
        data-entity-id={props.entityId}
        data-has-on-attach={props.onAttach !== undefined ? "yes" : "no"}
        data-has-on-detach={props.onDetach !== undefined ? "yes" : "no"}
      />
    );
  },
}));
vi.mock("./casting-detail-modal", () => ({
  CastingDetailModal: (props: {
    open: boolean;
    entry: { id: string } | null;
  }) => {
    detailModalSpy(props);
    return props.open && props.entry ? (
      <div data-testid="detail-modal-open" data-entry-id={props.entry.id} />
    ) : null;
  },
}));

import { CastingTable } from "./casting-table";
import type { CastingEntryForClient } from "./casting-helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeEntry(
  overrides: Partial<CastingEntryForClient> = {},
): CastingEntryForClient {
  return {
    id: "casting-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: null,
    partyName: "Acme Vendor",
    partyPhone: "9876543210",
    discount: 0,
    total: 100000,
    notes: null,
    attachmentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lineItems: [
      {
        id: "li-1",
        castingEntryId: "casting-1",
        materialDescription: "Brass",
        weightKg: "2.500",
        ratePerKg: 40000,
        lineTotal: 100000,
        createdAt: new Date(),
      },
    ],
    payments: [],
    paidAmount: 0,
    status: "pending",
    party: null,
    bill: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("CastingTable — render states", () => {
  it("shows empty-state copy when there are no entries", () => {
    render(<CastingTable entries={[]} />);
    expect(screen.getByText(/no casting entries yet/i)).toBeInTheDocument();
  });

  it("renders the Add casting entry link to /casting/new", () => {
    render(<CastingTable entries={[]} />);
    expect(
      screen.getByRole("link", { name: /add casting entry/i }),
    ).toHaveAttribute("href", "/casting/new");
  });

  it("renders one row per entry with party name + total", () => {
    render(<CastingTable entries={[makeEntry()]} />);
    expect(screen.getByText(/acme vendor/i)).toBeInTheDocument();
    expect(screen.getByText(/₹1,000\.00/)).toBeInTheDocument();
  });

  it("filters rows via the search input", async () => {
    const user = userEvent.setup();
    render(
      <CastingTable
        entries={[
          makeEntry({ id: "c1", partyName: "Acme Co" }),
          makeEntry({
            id: "c2",
            partyName: "Beta Ltd",
            partyPhone: "1111111111",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/acme co/i)).toBeInTheDocument();
    expect(screen.getByText(/beta ltd/i)).toBeInTheDocument();

    const search = screen.getByPlaceholderText(/search casting entries/i);
    await user.type(search, "beta");

    expect(screen.queryByText(/acme co/i)).not.toBeInTheDocument();
    expect(screen.getByText(/beta ltd/i)).toBeInTheDocument();
  });
});

// =====================================================================
// Phase 10.6 regression guard: action modal mount + entityType + FK props
// =====================================================================

describe("CastingTable — action modal mount (entityType + FK regression guard)", () => {
  it("clicking 'Add payment' mounts PaymentActionModal with entityType='casting'", async () => {
    const user = userEvent.setup();
    render(<CastingTable entries={[makeEntry({ id: "c-42" })]} />);

    await user.click(screen.getByRole("button", { name: /add payment/i }));

    const modal = await screen.findByTestId("payment-modal-mounted");
    expect(modal.getAttribute("data-entity-type")).toBe("casting");
    expect(modal.getAttribute("data-entity-id")).toBe("c-42");
  });

  it("clicking 'Manage bill' mounts BillActionModal with entityType='casting' AND FK props supplied", async () => {
    const user = userEvent.setup();
    render(<CastingTable entries={[makeEntry({ id: "c-42" })]} />);

    await user.click(screen.getByRole("button", { name: /manage bill/i }));

    const modal = await screen.findByTestId("bill-modal-mounted");
    expect(modal.getAttribute("data-entity-type")).toBe("casting");
    expect(modal.getAttribute("data-entity-id")).toBe("c-42");
    // Casting uses the FK path — onAttach + onDetach must both be supplied
    // (Sales/Purchases supply NEITHER; only Casting/Plating supply BOTH).
    expect(modal.getAttribute("data-has-on-attach")).toBe("yes");
    expect(modal.getAttribute("data-has-on-detach")).toBe("yes");
  });

  it("Casting table has NO 'Record return' button (Phase 9 decision: no returns workflow)", () => {
    render(<CastingTable entries={[makeEntry()]} />);
    expect(
      screen.queryByRole("button", { name: /record return/i }),
    ).not.toBeInTheDocument();
  });
});

describe("CastingTable — row click → detail modal", () => {
  it("clicking a row opens the detail modal with the right entry id", async () => {
    const user = userEvent.setup();
    render(<CastingTable entries={[makeEntry({ id: "c-99" })]} />);

    const partyCell = screen.getByText(/acme vendor/i);
    const row = partyCell.closest("tr");
    expect(row).not.toBeNull();
    await user.click(row!);

    const detail = await screen.findByTestId("detail-modal-open");
    expect(detail.getAttribute("data-entry-id")).toBe("c-99");
  });

  it("the action buttons stop click-event propagation (clicking 'Add payment' does NOT open the detail modal)", async () => {
    const user = userEvent.setup();
    render(<CastingTable entries={[makeEntry({ id: "c-99" })]} />);

    await user.click(screen.getByRole("button", { name: /add payment/i }));

    expect(screen.queryByTestId("detail-modal-open")).not.toBeInTheDocument();
    expect(await screen.findByTestId("payment-modal-mounted")).toBeInTheDocument();
  });
});

describe("CastingTable — delete confirmation", () => {
  it("shows the inline 'Delete?' confirm UI only after the trash button is clicked", async () => {
    const user = userEvent.setup();
    render(<CastingTable entries={[makeEntry({ id: "c-1" })]} />);

    expect(screen.queryByText(/^delete\?$/i)).not.toBeInTheDocument();

    const partyCell = screen.getByText(/acme vendor/i);
    const row = partyCell.closest("tr");
    expect(row).not.toBeNull();
    const trash = within(row!).getByRole("button", {
      name: /delete casting entry/i,
    });
    await user.click(trash);

    expect(within(row!).getByText(/^delete\?$/i)).toBeInTheDocument();
    expect(within(row!).getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(within(row!).getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });
});

// Phase 21a.1 — status chip is walk-in-only on casting too.
describe("CastingTable — status chip is walk-in-only (Phase 21a.1)", () => {
  it("renders the chip for a walk-in entry", () => {
    render(
      <CastingTable
        entries={[
          makeEntry({ id: "walk", partyId: null, status: "pending" }),
        ]}
      />,
    );
    expect(screen.getByText(/Pending/i)).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-tracked-hint")).toBeNull();
  });

  it("HIDES the chip for a party-linked entry and shows 'on ledger'", () => {
    render(
      <CastingTable
        entries={[
          makeEntry({
            id: "linked",
            partyId: "party-1",
            status: "pending",
          }),
        ]}
      />,
    );
    expect(screen.queryByText(/Pending/i)).toBeNull();
    expect(screen.getByTestId("ledger-tracked-hint")).toBeInTheDocument();
  });
});
