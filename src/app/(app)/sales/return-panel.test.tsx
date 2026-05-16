import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/sales",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./return-actions", () => ({
  createSaleReturn: vi.fn(),
  softDeleteSaleReturn: vi.fn(),
}));

import { ReturnPanel } from "./return-panel";
import { createSaleReturn, softDeleteSaleReturn } from "./return-actions";
import type {
  SaleForClient,
  SaleReturnForClient,
} from "./sale-helpers";

// Phase 7: legacy `qty` overrides are translated to a single-line lineItems
// fixture so the "available to return" maths still uses `qty` from a known
// line. Tests that explicitly pass `lineItems` short-circuit this default.
function makeSale(
  overrides: Partial<SaleForClient> & { qty?: number } = {},
): SaleForClient {
  const { qty, lineItems, ...rest } = overrides;
  const defaultLineItems =
    lineItems ??
    [
      {
        id: "line-1",
        saleId: "s-1",
        itemDescription: "Gold chain",
        qty: qty ?? 10,
        rate: 25000,
        createdAt: new Date("2026-05-10T12:00:00Z"),
      },
    ];
  return {
    id: "s-1",
    date: new Date("2026-05-10T00:00:00Z"),
    customerId: null,
    partyName: "Test Walkin",
    partyPhone: null,
    discount: 0,
    total: 250000,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    lineItems: defaultLineItems,
    paidAmount: 0,
    returnTotal: 0,
    status: "pending",
    payments: [],
    returns: [],
    ...rest,
  };
}

function makeReturn(
  overrides: Partial<SaleReturnForClient> = {},
): SaleReturnForClient {
  return {
    id: "r-default",
    saleId: "s-1",
    date: new Date("2026-05-12T00:00:00Z"),
    qtyReturned: 1,
    refundAmount: 25000,
    note: null,
    createdAt: new Date("2026-05-12T12:00:00Z"),
    updatedAt: new Date("2026-05-12T12:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("ReturnPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty state", () => {
    it("shows 'No returns recorded' when returns array is empty", () => {
      render(<ReturnPanel sale={makeSale()} returns={[]} />);
      expect(screen.getByText(/no returns recorded/i)).toBeInTheDocument();
    });

    it("shows + Record return button when returnable qty + value remaining > 0", () => {
      render(<ReturnPanel sale={makeSale()} returns={[]} />);
      expect(
        screen.getByRole("button", { name: /record return/i }),
      ).toBeInTheDocument();
    });

    it("hides 'Returned: ₹X' indicator when no returns exist", () => {
      render(<ReturnPanel sale={makeSale()} returns={[]} />);
      expect(screen.queryByText(/Returned:/i)).not.toBeInTheDocument();
    });
  });

  describe("returns list rendering", () => {
    it("renders one row per return with date, qty, and refund amount", () => {
      const returns = [
        makeReturn({ id: "r1", qtyReturned: 2, refundAmount: 50000 }),
        makeReturn({ id: "r2", qtyReturned: 3, refundAmount: 75000, note: "Damaged" }),
      ];
      render(<ReturnPanel sale={makeSale()} returns={returns} />);
      expect(screen.getByText(/₹\s*500\.00/)).toBeInTheDocument();
      expect(screen.getByText(/₹\s*750\.00/)).toBeInTheDocument();
      expect(screen.getByText("Damaged")).toBeInTheDocument();
    });

    it("shows 'Returned: ₹X' indicator summarising total refunded across returns", () => {
      const returns = [
        makeReturn({ qtyReturned: 2, refundAmount: 50000 }),
        makeReturn({ id: "r2", qtyReturned: 1, refundAmount: 25000 }),
      ];
      render(
        <ReturnPanel
          sale={makeSale({ returnTotal: 75000 })}
          returns={returns}
        />,
      );
      const indicator = screen.getByText(/Returned:/i);
      expect(indicator.textContent).toMatch(/₹\s*750\.00/);
    });

    it("hides 'Record return' button when nothing left to return", () => {
      // sale.qty = 10, fully returned (10 qty + full total)
      const sale = makeSale({ qty: 10, total: 250000, returnTotal: 250000 });
      const returns = [makeReturn({ qtyReturned: 10, refundAmount: 250000 })];
      render(<ReturnPanel sale={sale} returns={returns} />);
      expect(
        screen.queryByRole("button", { name: /record return/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Record return form", () => {
    it("clicking '+ Record return' opens the inline form with qty + refund + note inputs", async () => {
      const user = userEvent.setup();
      render(<ReturnPanel sale={makeSale()} returns={[]} />);
      await user.click(screen.getByRole("button", { name: /record return/i }));
      expect(screen.getByLabelText(/^date/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/quantity returned/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/refund amount/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    });

    it("shows 'Up to N available to return' hint reflecting remaining qty", async () => {
      const user = userEvent.setup();
      render(
        <ReturnPanel
          sale={makeSale({ qty: 10 })}
          returns={[makeReturn({ qtyReturned: 3 })]}
        />,
      );
      await user.click(screen.getByRole("button", { name: /record return/i }));
      // remaining = 10 - 3 = 7
      expect(screen.getByText(/up to 7 available to return/i)).toBeInTheDocument();
      // also shows the parenthetical with current state
      expect(
        screen.getByText(/already returned: 3 of 10/i),
      ).toBeInTheDocument();
    });

    it("submitting calls createSaleReturn with form values + saleId", async () => {
      const user = userEvent.setup();
      vi.mocked(createSaleReturn).mockResolvedValueOnce({
        ok: true as const,
        return: makeReturn({ qtyReturned: 2, refundAmount: 40000 }),
      });
      render(<ReturnPanel sale={makeSale()} returns={[]} />);
      await user.click(screen.getByRole("button", { name: /record return/i }));
      const qtyInput = screen.getByLabelText(/quantity returned/i);
      const refundInput = screen.getByLabelText(/refund amount/i);
      // Default qty is 1 from emptyDefaults; overwrite to 2
      await user.clear(qtyInput);
      await user.type(qtyInput, "2");
      await user.type(refundInput, "400");
      const form = qtyInput.closest("form")!;
      await user.click(within(form).getByRole("button", { name: /^save$/i }));
      expect(createSaleReturn).toHaveBeenCalledOnce();
      const arg = vi.mocked(createSaleReturn).mock.calls[0][0];
      expect(arg.saleId).toBe("s-1");
      expect(arg.qtyReturned).toBe(2);
      expect(arg.refundAmount).toBe(400);
    });

    it("displays inline error under qtyReturned on over-qty server response", async () => {
      const user = userEvent.setup();
      vi.mocked(createSaleReturn).mockResolvedValueOnce({
        ok: false as const,
        errors: {
          qtyReturned: [
            "Cannot return more than the original quantity. Already returned: 0 of 10",
          ],
        },
      });
      render(<ReturnPanel sale={makeSale()} returns={[]} />);
      await user.click(screen.getByRole("button", { name: /record return/i }));
      const qty = screen.getByLabelText(/quantity returned/i);
      await user.clear(qty);
      await user.type(qty, "11");
      await user.type(screen.getByLabelText(/refund amount/i), "100");
      const form = qty.closest("form")!;
      await user.click(within(form).getByRole("button", { name: /^save$/i }));
      expect(
        screen.getByText(/cannot return more than the original quantity/i),
      ).toBeInTheDocument();
    });

    it("Cancel button (recording return) closes form without calling createSaleReturn", async () => {
      const user = userEvent.setup();
      render(<ReturnPanel sale={makeSale()} returns={[]} />);
      await user.click(screen.getByRole("button", { name: /record return/i }));
      await user.click(
        screen.getByRole("button", { name: /cancel recording return/i }),
      );
      expect(screen.queryByLabelText(/quantity returned/i)).not.toBeInTheDocument();
      expect(createSaleReturn).not.toHaveBeenCalled();
    });
  });

  describe("soft-delete (reverse) flow", () => {
    it("Reverse return × → confirmation appears", async () => {
      const user = userEvent.setup();
      const returns = [makeReturn({ qtyReturned: 2, refundAmount: 50000 })];
      render(
        <ReturnPanel
          sale={makeSale({ returnTotal: 50000 })}
          returns={returns}
        />,
      );
      await user.click(screen.getByRole("button", { name: /reverse return/i }));
      expect(screen.getByText(/reverse\?/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^confirm$/i }),
      ).toBeInTheDocument();
    });

    it("Confirm calls softDeleteSaleReturn with the return id", async () => {
      const user = userEvent.setup();
      vi.mocked(softDeleteSaleReturn).mockResolvedValueOnce({
        ok: true as const,
      });
      const returns = [
        makeReturn({ id: "r-target", qtyReturned: 2, refundAmount: 50000 }),
      ];
      render(
        <ReturnPanel
          sale={makeSale({ returnTotal: 50000 })}
          returns={returns}
        />,
      );
      await user.click(screen.getByRole("button", { name: /reverse return/i }));
      await user.click(screen.getByRole("button", { name: /^confirm$/i }));
      expect(softDeleteSaleReturn).toHaveBeenCalledWith("r-target");
    });

    it("Cancel reversing return hides confirmation without calling softDeleteSaleReturn", async () => {
      const user = userEvent.setup();
      const returns = [makeReturn({ qtyReturned: 2, refundAmount: 50000 })];
      render(
        <ReturnPanel
          sale={makeSale({ returnTotal: 50000 })}
          returns={returns}
        />,
      );
      await user.click(screen.getByRole("button", { name: /reverse return/i }));
      await user.click(
        screen.getByRole("button", { name: /cancel reversing return/i }),
      );
      expect(screen.queryByText(/reverse\?/i)).not.toBeInTheDocument();
      expect(softDeleteSaleReturn).not.toHaveBeenCalled();
    });
  });
});
