// Phase 21c.1.1 — dashboard per-category boxes.
//
// Coverage:
//   - Renders one clickable box per LedgerBox prop.
//   - Each box links to /ledger?tab=<slug> via ledgerHrefForBox().
//   - Per-role visible-box count: ADMIN 4 / scoped 1.
//   - Credit-styled totals (negative box) shown with "−" prefix and
//     secondary tone (mirrors the /ledger page's box rendering).
//   - DRIFT-PROOF same-source: the boxes prop IS the listLedgerHome
//     output — no recomputation in this component. The test pins this
//     by passing fixture boxes and asserting the displayed numbers
//     exactly match the input (no transformation, no aggregation).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LedgerBoxesGrid } from "./ledger-boxes-grid";
import type { LedgerBox } from "@/lib/ledger-home";

function box(
  key: LedgerBox["key"],
  total: number,
  count: number,
  label?: string,
): LedgerBox {
  return {
    key,
    label: label ?? `${key} label`,
    total,
    count,
    anchor: "#owners",
  };
}

describe("LedgerBoxesGrid — render shape", () => {
  it("ADMIN: renders 4 boxes, each linking to its /ledger?tab=<slug>", () => {
    const boxes: LedgerBox[] = [
      box("receivables", 500000, 3, "Receivables"),
      box("purchase_payables", 5800000, 2, "Purchase payables"),
      box("casting_plating_payables", 7000000, 1, "Casting/Plating payables"),
      box("karigar", 100000, 2, "Karigar wages"),
    ];
    render(<LedgerBoxesGrid boxes={boxes} />);
    const cards = screen.getAllByTestId("dashboard-ledger-box");
    expect(cards).toHaveLength(4);
    expect(cards[0].getAttribute("href")).toBe("/ledger?tab=sales");
    expect(cards[1].getAttribute("href")).toBe("/ledger?tab=purchase");
    expect(cards[2].getAttribute("href")).toBe("/ledger?tab=casting-plating");
    expect(cards[3].getAttribute("href")).toBe("/ledger?tab=karigar");
  });

  it("PURCHASE_DEPT scoped role: 1 box, linking to /ledger?tab=purchase", () => {
    render(
      <LedgerBoxesGrid boxes={[box("purchase_payables", 5000000, 1)]} />,
    );
    const cards = screen.getAllByTestId("dashboard-ledger-box");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("href")).toBe("/ledger?tab=purchase");
    expect(cards[0].getAttribute("data-box-key")).toBe("purchase_payables");
  });

  it("LABOUR_MGMT scoped role: 1 box, linking to /ledger?tab=karigar", () => {
    render(<LedgerBoxesGrid boxes={[box("karigar", 100000, 2)]} />);
    const cards = screen.getAllByTestId("dashboard-ledger-box");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("href")).toBe("/ledger?tab=karigar");
  });

  it("empty boxes → renders nothing", () => {
    const { container } = render(<LedgerBoxesGrid boxes={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("dashboard-ledger-box")).not.toBeInTheDocument();
  });
});

describe("LedgerBoxesGrid — DRIFT-PROOF same-source rendering", () => {
  it("displays the box.total VERBATIM (no recomputation, no aggregation)", () => {
    // The pin: pass a fixture with specific totals; assert those exact
    // values render. Confirms this component is purely a presentation
    // layer over listLedgerHome's output — the only way the displayed
    // numbers can differ from listLedgerHome is if THIS component does
    // its own math, which it must not.
    const boxes: LedgerBox[] = [
      box("receivables", 123456, 1, "Receivables"), // ₹1,234.56
      box("purchase_payables", 7654321, 5, "Purchase payables"), // ₹76,543.21
    ];
    render(<LedgerBoxesGrid boxes={boxes} />);
    const cards = screen.getAllByTestId("dashboard-ledger-box");
    expect(cards[0].textContent).toContain("1,234.56");
    expect(cards[1].textContent).toContain("76,543.21");
  });

  it("credit balance (negative total) → '−' prefix + count hint includes 'credit'", () => {
    render(
      <LedgerBoxesGrid boxes={[box("receivables", -250000, 1, "Receivables")]} />,
    );
    const card = screen.getByTestId("dashboard-ledger-box");
    const balanceP = card.querySelector("p.font-display");
    expect(balanceP?.textContent).toMatch(/^[-–—−]/);
    expect(balanceP?.textContent).toContain("2,500.00");
    expect(card.textContent).toContain("credit");
  });

  it("zero balance → 'Settled' hint", () => {
    render(<LedgerBoxesGrid boxes={[box("karigar", 0, 0)]} />);
    const card = screen.getByTestId("dashboard-ledger-box");
    expect(card.textContent).toContain("Settled");
  });

  it("count hint pluralisation (1 owner vs N owners)", () => {
    render(
      <LedgerBoxesGrid
        boxes={[
          box("receivables", 10000, 1, "Receivables"),
          box("purchase_payables", 20000, 2, "Purchase payables"),
        ]}
      />,
    );
    const cards = screen.getAllByTestId("dashboard-ledger-box");
    expect(cards[0].textContent).toContain("1 owner");
    expect(cards[0].textContent).not.toContain("1 owners");
    expect(cards[1].textContent).toContain("2 owners");
  });
});
