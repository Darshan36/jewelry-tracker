// Phase 21c.1 — KarigarLedgerDetail (NEW karigar khata view).
//
// Coverage focuses on the new surface (completes Phase 21b's deferred
// view layer):
//   - "Record entry" button ALWAYS visible (always-available-surface
//     pattern from 21b.1).
//   - "Settle wages" button visible ONLY when balance > 0.
//   - Balance label sign-aware: "Owed wages" / "Caught up" / "Advance held".
//   - MANUAL_PAYMENT rows show edit + delete; PIECE_ENTRY /
//     WAGE_PAYMENT (TRANSACTION_LINKED) rows show "via source" hint.
//   - Source-type chips ("Pieces" / "Wage") render on TRANSACTION_LINKED rows.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/action-modals/karigar-ledger-entry-modal", () => ({
  KarigarLedgerEntryModal: () => null,
}));

vi.mock("@/components/action-modals/employee-payment-modal", () => ({
  EmployeePaymentModal: () => null,
}));

vi.mock("@/app/(app)/labour/karigar-ledger-actions", () => ({
  softDeleteKarigarLedgerEntry: vi.fn(),
}));

import { KarigarLedgerDetail } from "./karigar-ledger-detail";
import type { LedgerEntryForClient } from "@/lib/ledger";

const employee = { id: "emp-1", name: "Karigar A" };

function makeEntry(overrides: Partial<LedgerEntryForClient> = {}): LedgerEntryForClient {
  return {
    id: "le-1",
    date: new Date("2026-05-15T00:00:00Z"),
    direction: "INCREASE",
    amount: 50000,
    description: "10 pcs @ ₹500/pc",
    entryType: "TRANSACTION_LINKED",
    sourceType: "PIECE_ENTRY",
    sourceId: "pe-1",
    runningBalance: 50000,
    ...overrides,
  };
}

describe("KarigarLedgerDetail — Record entry button ALWAYS visible (21b.1 pattern)", () => {
  it("visible when balance is positive (Owed wages)", () => {
    render(
      <KarigarLedgerDetail
        employee={employee}
        balance={50000}
        entries={[makeEntry()]}
      />,
    );
    expect(screen.getByTestId("record-entry-button")).toBeInTheDocument();
  });

  it("visible when balance is zero (Caught up)", () => {
    render(<KarigarLedgerDetail employee={employee} balance={0} entries={[]} />);
    expect(screen.getByTestId("record-entry-button")).toBeInTheDocument();
  });

  it("visible when balance is negative (Advance held)", () => {
    render(
      <KarigarLedgerDetail
        employee={employee}
        balance={-40000}
        entries={[
          makeEntry({
            id: "mp-1",
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
            sourceId: null,
            direction: "DECREASE",
            description: "Advance",
            amount: 40000,
            runningBalance: -40000,
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("record-entry-button")).toBeInTheDocument();
  });
});

describe("KarigarLedgerDetail — Settle wages button conditional on balance > 0", () => {
  it("visible when balance > 0", () => {
    render(
      <KarigarLedgerDetail
        employee={employee}
        balance={30000}
        entries={[makeEntry()]}
      />,
    );
    expect(screen.getByTestId("settle-wages-button")).toBeInTheDocument();
  });

  it("HIDDEN when balance === 0", () => {
    render(<KarigarLedgerDetail employee={employee} balance={0} entries={[]} />);
    expect(screen.queryByTestId("settle-wages-button")).not.toBeInTheDocument();
  });

  it("HIDDEN when balance < 0 (karigar holds advance)", () => {
    render(
      <KarigarLedgerDetail employee={employee} balance={-25000} entries={[]} />,
    );
    expect(screen.queryByTestId("settle-wages-button")).not.toBeInTheDocument();
  });
});

describe("KarigarLedgerDetail — sign-aware balance label", () => {
  it("balance > 0 → 'Owed wages'", () => {
    render(
      <KarigarLedgerDetail
        employee={employee}
        balance={50000}
        entries={[makeEntry()]}
      />,
    );
    expect(screen.getByText("Owed wages")).toBeInTheDocument();
    const amount = screen.getByTestId("karigar-balance");
    expect(amount).toHaveAttribute("data-signed", "50000");
  });

  it("balance === 0 → 'Caught up'", () => {
    render(<KarigarLedgerDetail employee={employee} balance={0} entries={[]} />);
    expect(screen.getByText("Caught up")).toBeInTheDocument();
  });

  it("balance < 0 → 'Advance held' + secondary tone + leading −", () => {
    render(
      <KarigarLedgerDetail employee={employee} balance={-40000} entries={[]} />,
    );
    expect(screen.getByText("Advance held")).toBeInTheDocument();
    const amount = screen.getByTestId("karigar-balance");
    expect(amount).toHaveAttribute("data-signed", "-40000");
    expect(amount.className).toContain("text-secondary");
    expect(amount.textContent).toMatch(/^[-–—−]/);
  });
});

describe("KarigarLedgerDetail — MANUAL_PAYMENT vs TRANSACTION_LINKED rows", () => {
  it("MANUAL_PAYMENT row shows edit + delete buttons", () => {
    render(
      <KarigarLedgerDetail
        employee={employee}
        balance={-20000}
        entries={[
          makeEntry({
            id: "mp-1",
            entryType: "MANUAL_PAYMENT",
            sourceType: null,
            sourceId: null,
            direction: "DECREASE",
            description: "Advance",
            amount: 20000,
            runningBalance: -20000,
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("ledger-edit-button")).toBeInTheDocument();
    expect(screen.getByTestId("ledger-delete-button")).toBeInTheDocument();
    expect(screen.queryByTestId("ledger-readonly-hint")).not.toBeInTheDocument();
  });

  it("PIECE_ENTRY (TRANSACTION_LINKED) row shows a VISIBLE 'Edit on the piece entry' explainer + 'Pieces' chip", () => {
    render(
      <KarigarLedgerDetail
        employee={employee}
        balance={50000}
        entries={[makeEntry({ sourceType: "PIECE_ENTRY" })]}
      />,
    );
    const hint = screen.getByTestId("ledger-readonly-hint");
    // Phase 22.1 — visible, source-aware explainer (was cryptic "via source"
    // + a hover-only title="" that never appeared on touch).
    expect(hint).toHaveTextContent(/edit on the piece entry/i);
    expect(hint).not.toHaveAttribute("title");
    expect(screen.getByTestId("source-chip")).toHaveTextContent(/pieces/i);
    expect(screen.queryByTestId("ledger-edit-button")).not.toBeInTheDocument();
  });

  it("WAGE_PAYMENT (TRANSACTION_LINKED) row shows 'via source' + 'Wage' chip", () => {
    render(
      <KarigarLedgerDetail
        employee={employee}
        balance={0}
        entries={[
          makeEntry({
            id: "le-wage",
            sourceType: "WAGE_PAYMENT",
            sourceId: "ep-1",
            direction: "DECREASE",
            description: "Wage payment",
            amount: 50000,
            runningBalance: 0,
          }),
        ]}
      />,
    );
    const hint = screen.getByTestId("ledger-readonly-hint");
    expect(hint).toHaveTextContent(/edit on the wage payment/i);
    expect(hint).not.toHaveAttribute("title");
    expect(screen.getByTestId("source-chip")).toHaveTextContent(/wage/i);
  });
});

describe("KarigarLedgerDetail — empty state", () => {
  it("shows empty state guiding to Record entry", () => {
    render(<KarigarLedgerDetail employee={employee} balance={0} entries={[]} />);
    expect(
      screen.getByText(/no ledger activity for this karigar yet/i),
    ).toBeInTheDocument();
    // "Record entry" appears both in the header button AND in the empty-state
    // copy ("Tap **Record entry** to log an advance…"). Use getAllByText.
    const recordEntryMentions = screen.getAllByText(/record entry/i);
    expect(recordEntryMentions.length).toBeGreaterThanOrEqual(2);
  });
});
