// Phase 21c.1 — PartyLedgerDetail (unified payable/receivable).
//
// Coverage focuses on preserving the 21a.1 functionality in the move:
//   - CTA label switches by direction ("Add payment" / "Receive Payment").
//   - MANUAL_PAYMENT rows show edit + delete buttons; TRANSACTION_LINKED
//     rows show the "via source" hint.
//   - Credit balance display (negative totalOutstanding → "Credit balance"
//     label + secondary tone).
//   - Scope footnote only renders for scoped roles (showScopeFootnote
//     true + scope !== 'all').

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/action-modals/party-ledger-payment-modal", () => ({
  PartyLedgerPaymentModal: () => null,
}));

vi.mock("@/app/(app)/parties/ledger-actions", () => ({
  softDeleteLedgerEntry: vi.fn(),
}));

import { PartyLedgerDetail } from "./party-ledger-detail";
import type { PartyLedgerEntryForClient } from "@/lib/outstanding-balances";
import type { Party } from "@/generated/prisma";

function makeParty(overrides: Partial<Party> = {}): Party {
  return {
    id: "party-1",
    name: "Test Party",
    phone: "9999999999",
    email: null,
    address: null,
    notes: null,
    isCustomer: false,
    isSupplier: true,
    isCastingVendor: false,
    isPlatingVendor: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdById: null,
    updatedById: null,
    deletedById: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PartyLedgerEntryForClient> = {}): PartyLedgerEntryForClient {
  return {
    id: "le-1",
    date: new Date("2026-05-15T00:00:00Z"),
    direction: "INCREASE",
    amount: 50000,
    description: "Purchase entry",
    entryType: "TRANSACTION_LINKED",
    sourceType: "PURCHASE",
    sourceId: "pu-1",
    runningBalance: 50000,
    ...overrides,
  };
}

describe("PartyLedgerDetail — CTA label by direction", () => {
  it("payable direction → 'Add payment'", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={50000}
        showScopeFootnote={false}
        entries={[makeEntry()]}
        scope="all"
        direction="payable"
      />,
    );
    expect(screen.getByTestId("add-payment-button")).toHaveTextContent(/add payment/i);
  });

  it("receivable direction → 'Receive Payment'", () => {
    render(
      <PartyLedgerDetail
        party={makeParty({ isCustomer: true, isSupplier: false })}
        totalOutstanding={50000}
        showScopeFootnote={false}
        entries={[makeEntry({ sourceType: "SALE" })]}
        scope="all"
        direction="receivable"
      />,
    );
    expect(screen.getByTestId("add-payment-button")).toHaveTextContent(/receive payment/i);
  });
});

describe("PartyLedgerDetail — credit balance display (21a.1 preserved)", () => {
  it("negative balance shows 'Credit balance' label + secondary tone", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={-90000}
        showScopeFootnote={false}
        entries={[makeEntry()]}
        scope="all"
        direction="payable"
      />,
    );
    const balance = screen.getByTestId("party-balance");
    expect(balance).toHaveAttribute("data-signed", "-90000");
    expect(balance.className).toContain("text-secondary");
    expect(screen.getByText("Credit balance")).toBeInTheDocument();
  });

  it("positive balance shows 'Outstanding' label", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={50000}
        showScopeFootnote={false}
        entries={[makeEntry()]}
        scope="all"
        direction="payable"
      />,
    );
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
  });
});

describe("PartyLedgerDetail — MANUAL_PAYMENT vs TRANSACTION_LINKED rows (21a.1 preserved)", () => {
  it("MANUAL_PAYMENT row shows edit + delete buttons", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={20000}
        showScopeFootnote={false}
        entries={[
          makeEntry({
            id: "mp-1",
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
            sourceId: null,
            direction: "DECREASE",
            amount: 30000,
            description: "Payment received",
          }),
        ]}
        scope="all"
        direction="receivable"
      />,
    );
    expect(screen.getByTestId("ledger-edit-button")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-delete-button")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-readonly-hint")).not.toBeInTheDocument();
  });

  it("TRANSACTION_LINKED row shows 'via source' hint, NO edit/delete", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={50000}
        showScopeFootnote={false}
        entries={[makeEntry()]}
        scope="all"
        direction="payable"
      />,
    );
    expect(screen.getByTestId("ledger-readonly-hint")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-edit-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ledger-delete-button")).not.toBeInTheDocument();
  });
});

describe("PartyLedgerDetail — scope footnote", () => {
  it("renders footnote when showScopeFootnote + scope='purchase'", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={50000}
        showScopeFootnote
        entries={[makeEntry()]}
        scope="purchase"
        direction="payable"
      />,
    );
    expect(screen.getByTestId("scope-footnote")).toHaveTextContent(
      /purchase activity only/i,
    );
  });

  it("does NOT render footnote for scope='all'", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={50000}
        showScopeFootnote
        entries={[makeEntry()]}
        scope="all"
        direction="payable"
      />,
    );
    expect(screen.queryByTestId("scope-footnote")).not.toBeInTheDocument();
  });
});

describe("PartyLedgerDetail — empty state", () => {
  it("shows empty state when no entries", () => {
    render(
      <PartyLedgerDetail
        party={makeParty()}
        totalOutstanding={0}
        showScopeFootnote={false}
        entries={[]}
        scope="all"
        direction="payable"
      />,
    );
    expect(screen.getByText(/no ledger activity/i)).toBeInTheDocument();
  });
});
