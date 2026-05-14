import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/purchases",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./return-actions", () => ({
  createPurchaseReturn: vi.fn(),
  softDeletePurchaseReturn: vi.fn(),
}));

import { ReturnPanel } from "./return-panel";
import {
  createPurchaseReturn,
  softDeletePurchaseReturn,
} from "./return-actions";
import type {
  PurchaseForClient,
  PurchaseReturnForClient,
} from "./purchase-helpers";

function makePurchase(
  overrides: Partial<PurchaseForClient> = {},
): PurchaseForClient {
  return {
    id: "p-1",
    date: new Date("2026-05-10T00:00:00Z"),
    supplierId: null,
    partyName: "Test Walkin Vendor",
    partyPhone: null,
    itemDescription: "Gold wire",
    qty: 10,
    rate: 25000,
    discount: 0,
    total: 250000,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    paidAmount: 0,
    returnTotal: 0,
    status: "pending",
    payments: [],
    returns: [],
    ...overrides,
  };
}

function makeReturn(
  overrides: Partial<PurchaseReturnForClient> = {},
): PurchaseReturnForClient {
  return {
    id: "r-default",
    purchaseId: "p-1",
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

describe("ReturnPanel (Purchases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty state", () => {
    it("renders 'Returns to supplier' header (Purchases inversion)", () => {
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      expect(screen.getByText(/returns to supplier/i)).toBeInTheDocument();
    });

    it("shows 'No returns recorded' when returns array is empty", () => {
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      expect(screen.getByText(/no returns recorded/i)).toBeInTheDocument();
    });

    it("shows + Record return to supplier button when returnable qty + value > 0", () => {
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      expect(
        screen.getByRole("button", { name: /record return to supplier/i }),
      ).toBeInTheDocument();
    });

    it("hides 'Returned: ₹X' indicator when no returns exist", () => {
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      expect(screen.queryByText(/Returned:/i)).not.toBeInTheDocument();
    });
  });

  describe("returns list rendering", () => {
    it("renders one row per return with date, qty, and refund amount", () => {
      const returns = [
        makeReturn({ id: "r1", qtyReturned: 2, refundAmount: 50000 }),
        makeReturn({ id: "r2", qtyReturned: 3, refundAmount: 75000, note: "Defective" }),
      ];
      render(<ReturnPanel purchase={makePurchase()} returns={returns} />);
      expect(screen.getByText(/₹\s*500\.00/)).toBeInTheDocument();
      expect(screen.getByText(/₹\s*750\.00/)).toBeInTheDocument();
      expect(screen.getByText("Defective")).toBeInTheDocument();
    });

    it("shows 'Returned: ₹X' indicator summarising total refunded across returns", () => {
      const returns = [
        makeReturn({ qtyReturned: 2, refundAmount: 50000 }),
        makeReturn({ id: "r2", qtyReturned: 1, refundAmount: 25000 }),
      ];
      render(
        <ReturnPanel
          purchase={makePurchase({ returnTotal: 75000 })}
          returns={returns}
        />,
      );
      const indicator = screen.getByText(/Returned:/i);
      expect(indicator.textContent).toMatch(/₹\s*750\.00/);
    });

    it("hides 'Record return to supplier' button when nothing left to return", () => {
      const purchase = makePurchase({ qty: 10, total: 250000, returnTotal: 250000 });
      const returns = [makeReturn({ qtyReturned: 10, refundAmount: 250000 })];
      render(<ReturnPanel purchase={purchase} returns={returns} />);
      expect(
        screen.queryByRole("button", { name: /record return to supplier/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Record return form", () => {
    it("clicking '+ Record return to supplier' opens the inline form with qty + refund + note inputs", async () => {
      const user = userEvent.setup();
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      await user.click(
        screen.getByRole("button", { name: /record return to supplier/i }),
      );
      expect(screen.getByLabelText(/^date/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/quantity returned/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/refund amount/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    });

    it("shows 'Up to N available to return' hint reflecting remaining qty", async () => {
      const user = userEvent.setup();
      render(
        <ReturnPanel
          purchase={makePurchase({ qty: 10 })}
          returns={[makeReturn({ qtyReturned: 3 })]}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: /record return to supplier/i }),
      );
      expect(screen.getByText(/up to 7 available to return/i)).toBeInTheDocument();
      expect(
        screen.getByText(/already returned: 3 of 10/i),
      ).toBeInTheDocument();
    });

    it("submitting calls createPurchaseReturn with form values + purchaseId", async () => {
      const user = userEvent.setup();
      vi.mocked(createPurchaseReturn).mockResolvedValueOnce({
        ok: true as const,
        return: makeReturn({ qtyReturned: 2, refundAmount: 40000 }),
      });
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      await user.click(
        screen.getByRole("button", { name: /record return to supplier/i }),
      );
      const qtyInput = screen.getByLabelText(/quantity returned/i);
      const refundInput = screen.getByLabelText(/refund amount/i);
      await user.clear(qtyInput);
      await user.type(qtyInput, "2");
      await user.type(refundInput, "400");
      const form = qtyInput.closest("form")!;
      await user.click(within(form).getByRole("button", { name: /^save$/i }));
      expect(createPurchaseReturn).toHaveBeenCalledOnce();
      const arg = vi.mocked(createPurchaseReturn).mock.calls[0][0];
      expect(arg.purchaseId).toBe("p-1");
      expect(arg.qtyReturned).toBe(2);
      expect(arg.refundAmount).toBe(400);
    });

    it("displays inline error under qtyReturned on over-qty server response", async () => {
      const user = userEvent.setup();
      vi.mocked(createPurchaseReturn).mockResolvedValueOnce({
        ok: false as const,
        errors: {
          qtyReturned: [
            "Cannot return more than the original quantity. Already returned: 0 of 10",
          ],
        },
      });
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      await user.click(
        screen.getByRole("button", { name: /record return to supplier/i }),
      );
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

    it("Cancel button (recording return) closes form without calling createPurchaseReturn", async () => {
      const user = userEvent.setup();
      render(<ReturnPanel purchase={makePurchase()} returns={[]} />);
      await user.click(
        screen.getByRole("button", { name: /record return to supplier/i }),
      );
      await user.click(
        screen.getByRole("button", { name: /cancel recording return/i }),
      );
      expect(screen.queryByLabelText(/quantity returned/i)).not.toBeInTheDocument();
      expect(createPurchaseReturn).not.toHaveBeenCalled();
    });
  });

  describe("soft-delete (reverse) flow", () => {
    it("Reverse return × → confirmation appears", async () => {
      const user = userEvent.setup();
      const returns = [makeReturn({ qtyReturned: 2, refundAmount: 50000 })];
      render(
        <ReturnPanel
          purchase={makePurchase({ returnTotal: 50000 })}
          returns={returns}
        />,
      );
      await user.click(screen.getByRole("button", { name: /reverse return/i }));
      expect(screen.getByText(/reverse\?/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^confirm$/i }),
      ).toBeInTheDocument();
    });

    it("Confirm calls softDeletePurchaseReturn with the return id", async () => {
      const user = userEvent.setup();
      vi.mocked(softDeletePurchaseReturn).mockResolvedValueOnce({
        ok: true as const,
      });
      const returns = [
        makeReturn({ id: "r-target", qtyReturned: 2, refundAmount: 50000 }),
      ];
      render(
        <ReturnPanel
          purchase={makePurchase({ returnTotal: 50000 })}
          returns={returns}
        />,
      );
      await user.click(screen.getByRole("button", { name: /reverse return/i }));
      await user.click(screen.getByRole("button", { name: /^confirm$/i }));
      expect(softDeletePurchaseReturn).toHaveBeenCalledWith("r-target");
    });

    it("Cancel reversing return hides confirmation without calling softDeletePurchaseReturn", async () => {
      const user = userEvent.setup();
      const returns = [makeReturn({ qtyReturned: 2, refundAmount: 50000 })];
      render(
        <ReturnPanel
          purchase={makePurchase({ returnTotal: 50000 })}
          returns={returns}
        />,
      );
      await user.click(screen.getByRole("button", { name: /reverse return/i }));
      await user.click(
        screen.getByRole("button", { name: /cancel reversing return/i }),
      );
      expect(screen.queryByText(/reverse\?/i)).not.toBeInTheDocument();
      expect(softDeletePurchaseReturn).not.toHaveBeenCalled();
    });
  });
});
