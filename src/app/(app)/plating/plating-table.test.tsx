// Tests for PlatingTable — Phase 10.6 regression guard.
//
// Focus areas:
//   1. Empty state vs rows
//   2. Quick-action button clicks mount the right action modal with
//      `entityType="plating"` (regression guard for the Phase 10.5 mirror
//      bug class — Phase 10.6 added two more entity types).
//   3. Plating tables have TWO action buttons (Pay + Attachment), no Return.
//   4. AttachmentActionModal is mounted with both onAttach + onDetach props
//      (the FK-based attachment path that distinguishes plating/plating
//      from sales/purchases).
//   5. Row click opens the detail modal.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  softDeletePlatingEntry: vi.fn(),
  attachAttachmentToPlatingEntry: vi.fn(),
  detachAttachmentFromPlatingEntry: vi.fn(),
}));
vi.mock("./payment-actions", () => ({
  createPlatingPayment: vi.fn(),
}));

// Capture entityType + onAttach/onDetach props passed to each action modal.
// This is the regression-guard signal for the Phase 10.5/10.6 mirror leak
// where `entityType="sale"` or `entityType="plating"` could leak between
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
vi.mock("./plating-detail-modal", () => ({
  PlatingDetailModal: (props: {
    open: boolean;
    entry: { id: string } | null;
  }) => {
    detailModalSpy(props);
    return props.open && props.entry ? (
      <div data-testid="detail-modal-open" data-entry-id={props.entry.id} />
    ) : null;
  },
}));

import { PlatingTable } from "./plating-table";
import type { PlatingEntryForClient } from "./plating-helpers";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeEntry(
  overrides: Partial<PlatingEntryForClient> = {},
): PlatingEntryForClient {
  return {
    id: "plating-1",
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
        platingEntryId: "plating-1",
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

describe("PlatingTable — render states", () => {
  it("shows empty-state copy when there are no entries", () => {
    render(<PlatingTable entries={[]} />);
    expect(screen.getByText(/no plating entries yet/i)).toBeInTheDocument();
  });

  it("renders the Add plating entry link to /plating/new", () => {
    render(<PlatingTable entries={[]} />);
    expect(
      screen.getByRole("link", { name: /add plating entry/i }),
    ).toHaveAttribute("href", "/plating/new");
  });

  it("renders one row per entry with party name + total", () => {
    render(<PlatingTable entries={[makeEntry()]} />);
    expect(screen.getByText(/acme vendor/i)).toBeInTheDocument();
    expect(screen.getByText(/₹1,000\.00/)).toBeInTheDocument();
  });

  it("filters rows via the search input", async () => {
    const user = userEvent.setup();
    render(
      <PlatingTable
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

    const search = screen.getByPlaceholderText(/search plating entries/i);
    await user.type(search, "beta");

    expect(screen.queryByText(/acme co/i)).not.toBeInTheDocument();
    expect(screen.getByText(/beta ltd/i)).toBeInTheDocument();
  });
});

// =====================================================================
// Phase 10.6 regression guard: action modal mount + entityType + FK props
// =====================================================================

describe("PlatingTable — action modal mount (entityType + FK regression guard)", () => {
  it("clicking 'Add payment' mounts PaymentActionModal with entityType='plating'", async () => {
    const user = userEvent.setup();
    render(<PlatingTable entries={[makeEntry({ id: "c-42" })]} />);

    await user.click(screen.getByRole("button", { name: /add payment/i }));

    const modal = await screen.findByTestId("payment-modal-mounted");
    expect(modal.getAttribute("data-entity-type")).toBe("plating");
    expect(modal.getAttribute("data-entity-id")).toBe("c-42");
  });

  it("clicking 'Manage bill' mounts BillActionModal with entityType='plating' AND FK props supplied", async () => {
    const user = userEvent.setup();
    render(<PlatingTable entries={[makeEntry({ id: "c-42" })]} />);

    await user.click(screen.getByRole("button", { name: /manage bill/i }));

    const modal = await screen.findByTestId("bill-modal-mounted");
    expect(modal.getAttribute("data-entity-type")).toBe("plating");
    expect(modal.getAttribute("data-entity-id")).toBe("c-42");
    // Plating uses the FK path — onAttach + onDetach must both be supplied
    // (Sales/Purchases supply NEITHER; only Plating/Plating supply BOTH).
    expect(modal.getAttribute("data-has-on-attach")).toBe("yes");
    expect(modal.getAttribute("data-has-on-detach")).toBe("yes");
  });

  it("Plating table has NO 'Record return' button (Phase 9 decision: no returns workflow)", () => {
    render(<PlatingTable entries={[makeEntry()]} />);
    expect(
      screen.queryByRole("button", { name: /record return/i }),
    ).not.toBeInTheDocument();
  });
});

describe("PlatingTable — row click → detail modal", () => {
  it("clicking a row opens the detail modal with the right entry id", async () => {
    const user = userEvent.setup();
    render(<PlatingTable entries={[makeEntry({ id: "c-99" })]} />);

    const partyCell = screen.getByText(/acme vendor/i);
    const row = partyCell.closest("tr");
    expect(row).not.toBeNull();
    await user.click(row!);

    const detail = await screen.findByTestId("detail-modal-open");
    expect(detail.getAttribute("data-entry-id")).toBe("c-99");
  });

  it("the action buttons stop click-event propagation (clicking 'Add payment' does NOT open the detail modal)", async () => {
    const user = userEvent.setup();
    render(<PlatingTable entries={[makeEntry({ id: "c-99" })]} />);

    await user.click(screen.getByRole("button", { name: /add payment/i }));

    expect(screen.queryByTestId("detail-modal-open")).not.toBeInTheDocument();
    expect(await screen.findByTestId("payment-modal-mounted")).toBeInTheDocument();
  });
});

describe("PlatingTable — delete confirmation", () => {
  it("shows the inline 'Delete?' confirm UI only after the trash button is clicked", async () => {
    const user = userEvent.setup();
    render(<PlatingTable entries={[makeEntry({ id: "c-1" })]} />);

    expect(screen.queryByText(/^delete\?$/i)).not.toBeInTheDocument();

    const partyCell = screen.getByText(/acme vendor/i);
    const row = partyCell.closest("tr");
    expect(row).not.toBeNull();
    const trash = within(row!).getByRole("button", {
      name: /delete plating entry/i,
    });
    await user.click(trash);

    expect(within(row!).getByText(/^delete\?$/i)).toBeInTheDocument();
    expect(within(row!).getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(within(row!).getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
  });
});

// Phase 22.1 — desktop QuickActions carry VISIBLE text labels (icon-only +
// hover-only title is illegible on no-hover touch tablets).
describe("PlatingTable — QuickActions have visible labels (Phase 22.1)", () => {
  it("renders visible Pay / Bill labels and drops the title attribute", () => {
    render(<PlatingTable entries={[makeEntry({ id: "p-lbl", partyId: null })]} />);
    expect(screen.getByText("Pay")).toBeInTheDocument();
    expect(screen.getByText("Bill")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add payment/i }),
    ).not.toHaveAttribute("title");
  });
});

// Phase 21a.1 — status chip is walk-in-only on plating too.
describe("PlatingTable — status chip is walk-in-only (Phase 21a.1)", () => {
  it("renders the chip for a walk-in entry", () => {
    render(
      <PlatingTable
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
      <PlatingTable
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
