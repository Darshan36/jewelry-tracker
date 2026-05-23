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
    // Pure supplier — only purchase_payables slice.
    slices: { purchase_payables: 50000 },
  },
  {
    kind: "party",
    id: "party-credit",
    name: "Overpaid Customer",
    phone: null,
    balance: -25000,
    href: "/ledger/party/party-credit",
    // Pure customer with credit balance — only receivables slice.
    slices: { receivables: -25000 },
  },
  {
    kind: "karigar",
    id: "emp-1",
    name: "Karigar A",
    phone: null,
    balance: 30000,
    href: "/ledger/karigar/emp-1",
    slices: { karigar: 30000 },
  },
  {
    kind: "karigar",
    id: "emp-zero",
    name: "Karigar Caught Up",
    phone: null,
    balance: 0,
    href: "/ledger/karigar/emp-zero",
    // Zero karigar still gets slice (always-available-surface — appears
    // under Karigar tab).
    slices: { karigar: 0 },
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

// --- Phase 21c.1.1 — category tab bar -----------------------------------

const adminBoxes: LedgerBox[] = [
  { key: "receivables", label: "Receivables", total: -25000, count: 1, anchor: "#owners" },
  { key: "purchase_payables", label: "Purchase payables", total: 50000, count: 1, anchor: "#owners" },
  { key: "casting_plating_payables", label: "Casting/Plating payables", total: 0, count: 0, anchor: "#owners" },
  { key: "karigar", label: "Karigar wages", total: 30000, count: 1, anchor: "#owners" },
];

// Balances are PAISE (not rupees). ₹18,000 = 1,800,000p; ₹10,000 = 1,000,000p;
// ₹8,000 = 800,000p. formatCurrency renders Indian comma grouping → "18,000.00".
const dualRoleOwner: LedgerOwnerRow = {
  kind: "party",
  id: "dual-1",
  name: "Dual Role Party",
  phone: null,
  balance: 1_800_000, // ADMIN full balance = ₹18,000
  href: "/ledger/party/dual-1",
  // ₹10,000 receivable + ₹8,000 payable
  slices: { receivables: 1_000_000, purchase_payables: 800_000 },
};

describe("LedgerClient — category tabs (Phase 21c.1.1)", () => {
  it("ADMIN-shape (4 boxes) renders the 5-tab bar with 'All' default active", () => {
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const bar = screen.getByTestId("ledger-tab-bar");
    expect(bar).toBeInTheDocument();
    const tabs = screen.getAllByTestId("ledger-tab");
    expect(tabs).toHaveLength(5);
    const keys = tabs.map((t) => t.getAttribute("data-tab-key"));
    expect(keys).toEqual([
      "all",
      "receivables",
      "purchase_payables",
      "casting_plating_payables",
      "karigar",
    ]);
    const active = tabs.filter((t) => t.getAttribute("data-active") === "true");
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute("data-tab-key")).toBe("all");
  });

  it("scoped-role shape (1 box) hides the tab bar entirely", () => {
    const oneBox: LedgerBox[] = [
      { key: "purchase_payables", label: "Purchase payables", total: 50000, count: 1, anchor: "#owners" },
    ];
    render(
      <LedgerClient
        boxes={oneBox}
        owners={[sampleOwners[0]]}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    expect(screen.queryByTestId("ledger-tab-bar")).not.toBeInTheDocument();
    // Owner list still renders (1 row).
    expect(screen.getAllByTestId("ledger-owner-row")).toHaveLength(1);
  });

  it("clicking Sales tab filters to receivables owners only", async () => {
    const user = userEvent.setup();
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const salesTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "receivables",
    )!;
    await user.click(salesTab);
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-owner-id")).toBe("party-credit");
  });

  it("clicking Purchase tab filters to purchase owners only", async () => {
    const user = userEvent.setup();
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const purchTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "purchase_payables",
    )!;
    await user.click(purchTab);
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-owner-id")).toBe("party-1");
  });

  it("clicking Karigar tab filters to karigar owners (incl. zero-balance)", async () => {
    const user = userEvent.setup();
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const karTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "karigar",
    )!;
    await user.click(karTab);
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(2); // owed + zero
    expect(screen.getByTestId("zero-badge")).toBeInTheDocument();
  });

  it("clicking Casting/Plating tab shows empty-state when no owners contribute", async () => {
    const user = userEvent.setup();
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );
    const cpTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "casting_plating_payables",
    )!;
    await user.click(cpTab);
    expect(screen.queryAllByTestId("ledger-owner-row")).toHaveLength(0);
    expect(screen.getByText(/no owners under casting\/plating yet/i)).toBeInTheDocument();
  });

  it("dual-role party appears under BOTH Sales and Purchase with per-tab slice as displayed balance", async () => {
    const user = userEvent.setup();
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={[dualRoleOwner]}
        walkInPayables={[]}
        walkInReceivables={[]}
      />,
    );

    // Sales tab → row shows the receivable slice (₹10,000), not full balance (₹18,000).
    const salesTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "receivables",
    )!;
    await user.click(salesTab);
    let row = screen.getByTestId("ledger-owner-row");
    expect(row.getAttribute("data-owner-id")).toBe("dual-1");
    // The displayed balance cell uses Math.abs + formatCurrency; check for the slice value.
    expect(row.textContent).toContain("10,000");
    expect(row.textContent).not.toContain("18,000");

    // Purchase tab → row shows the payable slice (₹8,000).
    const purchTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "purchase_payables",
    )!;
    await user.click(purchTab);
    row = screen.getByTestId("ledger-owner-row");
    expect(row.getAttribute("data-owner-id")).toBe("dual-1");
    expect(row.textContent).toContain("8,000");
    expect(row.textContent).not.toContain("10,000");
    expect(row.textContent).not.toContain("18,000");

    // All tab → row shows the full balance (₹18,000).
    const allTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "all",
    )!;
    await user.click(allTab);
    row = screen.getByTestId("ledger-owner-row");
    expect(row.textContent).toContain("18,000");
  });

  it("initialTab='receivables' pre-selects Sales tab on mount (deep-link)", () => {
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
        initialTab="receivables"
      />,
    );
    const tabs = screen.getAllByTestId("ledger-tab");
    const salesTab = tabs.find((t) => t.getAttribute("data-tab-key") === "receivables");
    expect(salesTab?.getAttribute("data-active")).toBe("true");
    // And the owner list is already filtered to Sales (one customer).
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-owner-id")).toBe("party-credit");
  });

  it("initialTab='karigar' pre-selects Karigar tab on mount", () => {
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
        initialTab="karigar"
      />,
    );
    const active = screen
      .getAllByTestId("ledger-tab")
      .find((t) => t.getAttribute("data-active") === "true");
    expect(active?.getAttribute("data-tab-key")).toBe("karigar");
  });

  it("initialTab without showTabs (scoped role): tab bar hidden, list renders full data", () => {
    // Scoped role shape — 1 box; initialTab from a stray URL param
    // (e.g. dashboard click from a different role context) must NOT
    // empty the owner list. effectiveTab clamps to "all" when tabs
    // aren't rendered.
    const oneBox: LedgerBox[] = [
      { key: "purchase_payables", label: "Purchase payables", total: 50000, count: 1, anchor: "#owners" },
    ];
    // Simulate a PURCHASE_DEPT owner shape (only purchase_payables slice).
    const scopedOwners: LedgerOwnerRow[] = [
      {
        kind: "party",
        id: "sup-1",
        name: "Supplier",
        phone: null,
        balance: 50000,
        href: "/ledger/party/sup-1",
        slices: { purchase_payables: 50000 },
      },
    ];
    render(
      <LedgerClient
        boxes={oneBox}
        owners={scopedOwners}
        walkInPayables={[]}
        walkInReceivables={[]}
        initialTab="karigar" /* deliberately a tab this role can't see */
      />,
    );
    expect(screen.queryByTestId("ledger-tab-bar")).not.toBeInTheDocument();
    const rows = screen.getAllByTestId("ledger-owner-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-owner-id")).toBe("sup-1");
  });

  it("walk-in section is UNAFFECTED by tab changes (stays standalone)", async () => {
    const user = userEvent.setup();
    const walkIn: WalkInPayable = {
      kind: "PURCHASE",
      id: "pu-1",
      partyName: "Walk-in",
      partyPhone: null,
      date: new Date("2026-05-15"),
      total: 1000,
      paidAmount: 0,
      outstanding: 1000,
      hasAttachment: false,
    };
    render(
      <LedgerClient
        boxes={adminBoxes}
        owners={sampleOwners}
        walkInPayables={[walkIn]}
        walkInReceivables={[]}
      />,
    );
    expect(screen.getByTestId("ledger-walkin-row")).toBeInTheDocument();
    // Switch to Karigar tab — walk-in row still there.
    const karTab = screen.getAllByTestId("ledger-tab").find(
      (t) => t.getAttribute("data-tab-key") === "karigar",
    )!;
    await user.click(karTab);
    expect(screen.getByTestId("ledger-walkin-row")).toBeInTheDocument();
  });
});
