// Phase 21c.1 — LedgerClient smoke tests.
//
// Coverage:
//   - Boxes render (count + key for each provided box).
//   - Owner rows render (party + karigar both, with appropriate hrefs).
//   - Credit badge on negative-balance owner; Caught up badge on
//     zero-balance karigar.
//   - Walk-in section conditional on having walk-ins.
//   - Search filter narrows owners + walk-ins.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/action-modals/payment-action-modal", () => ({
  PaymentActionModal: () => null,
}));

vi.mock("@/app/(app)/purchases/payment-actions", () => ({
  createPurchasePayment: vi.fn(),
}));
vi.mock("@/app/(app)/casting/payment-actions", () => ({
  createCastingPayment: vi.fn(),
}));
vi.mock("@/app/(app)/plating/payment-actions", () => ({
  createPlatingPayment: vi.fn(),
}));
vi.mock("@/app/(app)/sales/payment-actions", () => ({
  createSalePayment: vi.fn(),
}));

import { LedgerClient } from "./ledger-client";
import type { LedgerBox, LedgerOwnerRow } from "@/lib/ledger-home";
import type {
  WalkInPayable,
  WalkInReceivable,
} from "@/lib/outstanding-balances";

const sampleBoxes: LedgerBox[] = [
  {
    key: "receivables",
    label: "Receivables",
    total: 25000,
    count: 1,
    anchor: "#owners",
  },
  {
    key: "purchase_payables",
    label: "Purchase payables",
    total: 50000,
    count: 1,
    anchor: "#owners",
  },
];

const sampleOwners: LedgerOwnerRow[] = [
  {
    kind: "party",
    id: "party-1",
    name: "Supplier A",
    phone: "9111111111",
    balance: 50000,
    href: "/ledger/party/party-1",
  },
  {
    kind: "party",
    id: "party-credit",
    name: "Overpaid Customer",
    phone: null,
    balance: -25000,
    href: "/ledger/party/party-credit",
  },
  {
    kind: "karigar",
    id: "emp-1",
    name: "Karigar A",
    phone: null,
    balance: 30000,
    href: "/ledger/karigar/emp-1",
  },
  {
    kind: "karigar",
    id: "emp-zero",
    name: "Karigar Caught Up",
    phone: null,
    balance: 0,
    href: "/ledger/karigar/emp-zero",
  },
];

describe("LedgerClient — boxes", () => {
  it("renders each provided box", () => {
    render(
      <LedgerClient
        boxes={sampleBoxes}
        owners={[]}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const boxes = screen.getAllByTestId("ledger-box");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toHaveAttribute("data-box-key", "receivables");
    expect(boxes[1]).toHaveAttribute("data-box-key", "purchase_payables");
  });

  it("does not render the boxes grid when no boxes provided", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={[]}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    expect(screen.queryByTestId("ledger-boxes")).not.toBeInTheDocument();
  });
});

describe("LedgerClient — owner list", () => {
  it("renders both party and karigar rows with hrefs to khata views", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(4);

    // hrefs are correct
    const supplierLink = screen.getByRole("link", { name: /supplier a/i });
    expect(supplierLink).toHaveAttribute("href", "/ledger/party/party-1");
    const karigarLink = screen.getByRole("link", { name: /karigar a/i });
    expect(karigarLink).toHaveAttribute("href", "/ledger/karigar/emp-1");
  });

  it("credit badge appears on negative-balance party row", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const creditBadges = screen.getAllByTestId("credit-badge");
    expect(creditBadges).toHaveLength(1);
  });

  it("'Caught up' badge appears on zero-balance karigar row", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    expect(screen.getByTestId("zero-badge")).toBeInTheDocument();
  });

  it("empty state when no owners", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={[]}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    expect(screen.getByText(/no owners in scope yet/i)).toBeInTheDocument();
  });
});

describe("LedgerClient — walk-in section", () => {
  const walkInPayable: WalkInPayable = {
    kind: "PURCHASE",
    id: "pu-1",
    partyName: "Walk-in supplier",
    partyPhone: null,
    date: new Date("2026-05-15"),
    total: 100000,
    paidAmount: 0,
    outstanding: 100000,
    hasAttachment: false,
  };

  const walkInReceivable: WalkInReceivable = {
    kind: "SALE",
    id: "s-1",
    partyName: "Walk-in customer",
    partyPhone: null,
    date: new Date("2026-05-15"),
    total: 50000,
    paidAmount: 0,
    outstanding: 50000,
    hasAttachment: true,
  };

  it("does not render walk-in section when no walk-ins", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    expect(screen.queryByTestId("ledger-walkin-row")).not.toBeInTheDocument();
  });

  it("renders walk-in payables + receivables both", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={[]}
        walkInPayables={[walkInPayable]}
        walkInReceivables={[walkInReceivable]}
      />,
    );
    const rows = screen.getAllByTestId("ledger-walkin-row");
    expect(rows).toHaveLength(2);
    const kinds = rows.map((r) => r.getAttribute("data-walkin-kind"));
    expect(kinds).toContain("purchase");
    expect(kinds).toContain("sale");
  });

  it("missing-attachment badge appears on walk-in without attachment", () => {
    render(
      <LedgerClient
        boxes={[]}
        owners={[]}
        walkInPayables={[walkInPayable]}
        walkInReceivables={[walkInReceivable]}
      />,
    );
    const badges = screen.getAllByTestId("missing-attachment-badge");
    expect(badges).toHaveLength(1);
  });
});

describe("LedgerClient — search filter", () => {
  it("narrows owners by name", async () => {
    const user = userEvent.setup();
    render(
      <LedgerClient
        boxes={[]}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const input = screen.getByPlaceholderText(/search by name or phone/i);
    await user.type(input, "Karigar A");
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(1);
    expect(screen.getByText(/karigar a/i)).toBeInTheDocument();
  });

  it("narrows by phone", async () => {
    const user = userEvent.setup();
    render(
      <LedgerClient
        boxes={[]}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const input = screen.getByPlaceholderText(/search by name or phone/i);
    await user.type(input, "9111");
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(1);
    expect(screen.getByText("Supplier A")).toBeInTheDocument();
  });
});
