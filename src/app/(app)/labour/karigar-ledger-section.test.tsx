import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KarigarLedgerSection } from "./karigar-ledger-section";
import type { KarigarBalanceRow } from "@/lib/labour-balances";

function makeRow(
  overrides?: Partial<KarigarBalanceRow["employee"]> & { balance?: number },
): KarigarBalanceRow {
  const { balance = 0, ...emp } = overrides ?? {};
  return {
    employee: {
      id: "lab1",
      name: "Ajay Bhai",
      phone: null,
      type: "LABOUR",
      monthlySalary: null,
      address: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...emp,
    },
    balance,
  };
}

let payClicks: KarigarBalanceRow[];
let recordClicks: KarigarBalanceRow[];

beforeEach(() => {
  payClicks = [];
  recordClicks = [];
});

function renderWith(rows: KarigarBalanceRow[]) {
  render(
    <KarigarLedgerSection
      rows={rows}
      onPayClick={(row) => payClicks.push(row)}
      onRecordEntryClick={(row) => recordClicks.push(row)}
    />,
  );
}

describe("KarigarLedgerSection — rendering", () => {
  it("renders the empty-state message when no karigars", () => {
    renderWith([]);
    expect(
      screen.getByText(/no labour employees/i),
    ).toBeInTheDocument();
  });

  it("renders one row per karigar (positive, zero, negative)", () => {
    renderWith([
      makeRow({ id: "a", name: "Ajay", balance: 500000 }),
      makeRow({ id: "b", name: "Bharat", balance: 0 }),
      makeRow({ id: "c", name: "Chirag", balance: -300000 }),
    ]);
    const rows = screen.getAllByTestId("karigar-ledger-row");
    expect(rows).toHaveLength(3);
    expect(screen.getByText("Ajay")).toBeInTheDocument();
    expect(screen.getByText("Bharat")).toBeInTheDocument();
    expect(screen.getByText("Chirag")).toBeInTheDocument();
  });

  it("labels positive balance as 'Owed wages'", () => {
    renderWith([makeRow({ balance: 500000 })]);
    expect(screen.getByTestId("balance-label-owed")).toBeInTheDocument();
  });

  it("labels zero balance as 'Caught up'", () => {
    renderWith([makeRow({ balance: 0 })]);
    expect(screen.getByTestId("balance-label-zero")).toBeInTheDocument();
  });

  it("labels negative balance as 'Advance held' with credit styling", () => {
    renderWith([makeRow({ balance: -300000 })]);
    expect(screen.getByTestId("balance-label-credit")).toBeInTheDocument();
    const amount = screen.getByTestId("balance-amount-credit");
    expect(amount.textContent).toMatch(/−/);
  });
});

describe("KarigarLedgerSection — actions", () => {
  it("shows 'Record entry' button on every row regardless of balance", () => {
    renderWith([
      makeRow({ id: "a", balance: 100 }),
      makeRow({ id: "b", balance: 0 }),
      makeRow({ id: "c", balance: -100 }),
    ]);
    const buttons = screen.getAllByTestId("record-entry-button");
    expect(buttons).toHaveLength(3);
  });

  it("shows 'Pay' button ONLY when balance > 0", () => {
    renderWith([
      makeRow({ id: "a", name: "Ajay", balance: 100 }),
      makeRow({ id: "b", name: "Bharat", balance: 0 }),
      makeRow({ id: "c", name: "Chirag", balance: -100 }),
    ]);
    const pays = screen.getAllByTestId("pay-wage-button");
    expect(pays).toHaveLength(1);
  });

  it("calls onRecordEntryClick with the right karigar", async () => {
    const user = userEvent.setup();
    renderWith([makeRow({ id: "a", name: "Ajay", balance: -100 })]);
    await user.click(screen.getByTestId("record-entry-button"));
    expect(recordClicks).toHaveLength(1);
    expect(recordClicks[0].employee.id).toBe("a");
  });

  it("calls onPayClick with the right karigar", async () => {
    const user = userEvent.setup();
    renderWith([makeRow({ id: "a", name: "Ajay", balance: 500 })]);
    await user.click(screen.getByTestId("pay-wage-button"));
    expect(payClicks).toHaveLength(1);
    expect(payClicks[0].employee.id).toBe("a");
  });
});
