import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/purchases",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./payment-actions", () => ({
  createPurchasePayment: vi.fn(),
  softDeletePurchasePayment: vi.fn(),
}));

import { PaymentPanel } from "./payment-panel";
import {
  createPurchasePayment,
  softDeletePurchasePayment,
} from "./payment-actions";
import type {
  PurchaseForClient,
  PurchasePaymentForClient,
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
    discount: 10000,
    total: 240000,
    notes: null,
    createdAt: new Date("2026-05-10T12:00:00Z"),
    updatedAt: new Date("2026-05-10T12:00:00Z"),
    deletedAt: null,
    lineItems: [
      {
        id: "line-1",
        purchaseId: "p-1",
        itemDescription: "Gold wire",
        qty: 10,
        rate: 25000,
        createdAt: new Date("2026-05-10T12:00:00Z"),
      },
    ],
    paidAmount: 0,
    returnTotal: 0,
    status: "pending",
    payments: [],
    returns: [],
    ...overrides,
  };
}

function makePayment(
  overrides: Partial<PurchasePaymentForClient> = {},
): PurchasePaymentForClient {
  return {
    id: "p-default",
    purchaseId: "p-1",
    date: new Date("2026-05-12T00:00:00Z"),
    amount: 50000,
    type: "PAYMENT",
    note: null,
    createdAt: new Date("2026-05-12T12:00:00Z"),
    updatedAt: new Date("2026-05-12T12:00:00Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("PaymentPanel (Purchases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty state", () => {
    it("shows 'No payments yet' when payments array is empty", () => {
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      expect(screen.getByText(/no payments yet/i)).toBeInTheDocument();
    });

    it("shows + Record payment button when owed-to-supplier > 0", () => {
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      expect(
        screen.getByRole("button", { name: /record payment/i }),
      ).toBeInTheDocument();
    });
  });

  describe("owed-to-supplier indicator (Purchases inversion)", () => {
    it("renders 'Owed to supplier: ₹2,400.00' when paidAmount is 0 (NOT 'Outstanding')", () => {
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      const indicator = screen.getByText(/owed to supplier:/i);
      expect(indicator.textContent).toMatch(/₹\s*2,400\.00/);
      // The Sales-direction label should NOT appear in Purchases
      expect(screen.queryByText(/^outstanding:/i)).not.toBeInTheDocument();
    });

    it("renders 'Owed to supplier: ₹1,900.00' when paidAmount is 50000 paise", () => {
      const purchase = makePurchase({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      const indicator = screen.getByText(/owed to supplier:/i);
      expect(indicator.textContent).toMatch(/₹\s*1,900\.00/);
    });

    it("renders 'Owed to supplier: ₹0.00' when fully paid", () => {
      const purchase = makePurchase({ paidAmount: 240000, status: "completed" });
      const payments = [makePayment({ amount: 240000 })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      const indicator = screen.getByText(/owed to supplier:/i);
      expect(indicator.textContent).toMatch(/₹\s*0\.00/);
    });

    it("hides the + Record payment button when owed is 0 and not refund_due", () => {
      const purchase = makePurchase({ paidAmount: 240000, status: "completed" });
      const payments = [makePayment({ amount: 240000 })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      expect(
        screen.queryByRole("button", { name: /record payment/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("payment list rendering", () => {
    it("renders one row per payment with date and amount", () => {
      const purchase = makePurchase({ paidAmount: 80000, status: "partial" });
      const payments = [
        makePayment({ id: "p1", amount: 50000, date: new Date("2026-05-11T00:00:00Z") }),
        makePayment({ id: "p2", amount: 30000, date: new Date("2026-05-12T00:00:00Z"), note: "Cash" }),
      ];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      expect(screen.getByText(/₹\s*500\.00/)).toBeInTheDocument();
      expect(screen.getByText(/₹\s*300\.00/)).toBeInTheDocument();
      expect(screen.getByText("Cash")).toBeInTheDocument();
    });

    it("renders '—' for null notes", () => {
      const purchase = makePurchase({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000, note: null })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      const paymentList = screen.getByRole("list");
      expect(within(paymentList).getByText("—")).toBeInTheDocument();
    });
  });

  describe("Record payment form", () => {
    it("clicking '+ Record payment' opens the inline form", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      expect(screen.getByLabelText(/^date/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^amount/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /pay full balance/i }),
      ).toBeInTheDocument();
    });

    it("date input defaults to today's YYYY-MM-DD in the form", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      const dateInput = screen.getByLabelText(/^date/i) as HTMLInputElement;
      const today = new Date();
      const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      expect(dateInput.value).toBe(expected);
    });

    it("'Pay full balance' fills amount input with the remaining rupees", async () => {
      const user = userEvent.setup();
      const purchase = makePurchase({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      await user.click(screen.getByRole("button", { name: /pay full balance/i }));
      const amountInput = screen.getByLabelText(/^amount/i) as HTMLInputElement;
      expect(Number(amountInput.value)).toBe(1900);
    });

    it("submitting calls createPurchasePayment with form values + purchaseId", async () => {
      const user = userEvent.setup();
      vi.mocked(createPurchasePayment).mockResolvedValueOnce({
        ok: true as const,
        payment: makePayment({ amount: 50000 }),
      });
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      const amountInput = screen.getByLabelText(/^amount/i);
      await user.type(amountInput, "500");
      const dialogForm = amountInput.closest("form")!;
      const saveBtn = within(dialogForm).getByRole("button", { name: /^save$/i });
      await user.click(saveBtn);
      expect(createPurchasePayment).toHaveBeenCalledOnce();
      const callArg = vi.mocked(createPurchasePayment).mock.calls[0][0];
      expect(callArg.purchaseId).toBe("p-1");
      expect(callArg.amount).toBe(500);
    });

    it("displays inline error under amount when server returns overpayment", async () => {
      const user = userEvent.setup();
      vi.mocked(createPurchasePayment).mockResolvedValueOnce({
        ok: false as const,
        errors: {
          amount: ["Exceeds remaining balance. Owed to supplier: ₹1,900.00"],
        },
      });
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      await user.type(screen.getByLabelText(/^amount/i), "5000");
      const form = screen.getByLabelText(/^amount/i).closest("form")!;
      await user.click(within(form).getByRole("button", { name: /^save$/i }));
      expect(
        screen.getByText(/exceeds remaining balance.*₹\s*1,900\.00/i),
      ).toBeInTheDocument();
      expect(within(form).getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    });

    it("Cancel button closes the form without calling createPurchasePayment", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel purchase={makePurchase()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      await user.click(
        screen.getByRole("button", { name: /cancel recording payment/i }),
      );
      expect(screen.queryByLabelText(/^amount/i)).not.toBeInTheDocument();
      expect(createPurchasePayment).not.toHaveBeenCalled();
    });
  });

  describe("refund mode (Phase 4 supplier-direction inversion)", () => {
    function refundDuePurchase(overrides: Partial<PurchaseForClient> = {}) {
      // total 240000, paid 240000, returnTotal 40000 → effective 200000.
      // Status refund_due: shop paid 240000 > effective 200000 → ₹400 owed back from supplier.
      return makePurchase({
        total: 240000,
        paidAmount: 240000,
        returnTotal: 40000,
        status: "refund_due",
        ...overrides,
      });
    }

    it("button label switches to 'Record refund received' when status === refund_due (NOT 'Issue refund')", () => {
      render(<PaymentPanel purchase={refundDuePurchase()} payments={[]} />);
      expect(
        screen.getByRole("button", { name: /record refund received/i }),
      ).toBeInTheDocument();
      // Sales-direction trigger label should NOT appear
      expect(
        screen.queryByRole("button", { name: /^issue refund$/i }),
      ).not.toBeInTheDocument();
    });

    it("indicator label = 'Refund expected' in text-secondary (BLUE, NOT text-error red)", () => {
      render(<PaymentPanel purchase={refundDuePurchase()} payments={[]} />);
      const indicator = screen.getByText(/refund expected:/i);
      expect(indicator.textContent).toMatch(/₹\s*400\.00/);
      // Purchases inversion: text-secondary (blue), NOT text-error (red)
      expect(indicator).toHaveClass("text-secondary");
      expect(indicator).not.toHaveClass("text-error");
      // Sales-direction label should NOT appear
      expect(screen.queryByText(/refund owed:/i)).not.toBeInTheDocument();
    });

    it("'Refund full amount' autofill button + fills with refund-expected rupees", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel purchase={refundDuePurchase()} payments={[]} />);
      await user.click(
        screen.getByRole("button", { name: /record refund received/i }),
      );
      const autofillBtn = screen.getByRole("button", {
        name: /refund full amount/i,
      });
      expect(autofillBtn).toBeInTheDocument();
      await user.click(autofillBtn);
      const amountInput = screen.getByLabelText(/^amount/i) as HTMLInputElement;
      expect(Number(amountInput.value)).toBe(400);
    });

    it("submitting the refund form sends type=REFUND to createPurchasePayment", async () => {
      const user = userEvent.setup();
      vi.mocked(createPurchasePayment).mockResolvedValueOnce({
        ok: true as const,
        payment: makePayment({ type: "REFUND", amount: 40000 }),
      });
      render(<PaymentPanel purchase={refundDuePurchase()} payments={[]} />);
      await user.click(
        screen.getByRole("button", { name: /record refund received/i }),
      );
      await user.click(
        screen.getByRole("button", { name: /refund full amount/i }),
      );
      const form = screen.getByLabelText(/^amount/i).closest("form")!;
      await user.click(within(form).getByRole("button", { name: /^save$/i }));
      expect(createPurchasePayment).toHaveBeenCalledOnce();
      const arg = vi.mocked(createPurchasePayment).mock.calls[0][0];
      expect(arg.type).toBe("REFUND");
      expect(arg.amount).toBe(400);
    });

    it("REFUND-type payment row renders with BLUE 'Refund received' badge + '+' prefix (NOT red, NOT minus)", () => {
      const purchase = makePurchase({
        paidAmount: 200000,
        status: "completed",
      });
      const payments = [
        makePayment({ id: "p1", amount: 240000, type: "PAYMENT" }),
        makePayment({ id: "p2", amount: 40000, type: "REFUND" }),
      ];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      const list = screen.getByRole("list");
      // "Refund received" badge (Purchases-specific label) in text-secondary
      const refundBadge = within(list).getByText(/^Refund received$/i);
      expect(refundBadge).toHaveClass("text-secondary");
      // Should NOT be styled with text-error (the Sales convention)
      expect(refundBadge).not.toHaveClass("text-error");
      // The amount cell for the REFUND row has text-secondary class (blue, NOT red)
      const refundRow = refundBadge.closest("li")!;
      const amountCell = within(refundRow).getByText(
        (content) => /\+\s*₹\s*400\.00/.test(content),
      );
      expect(amountCell).toHaveClass("text-secondary");
      expect(amountCell).not.toHaveClass("text-error");
      // Plus prefix (Purchases convention) — money IN to shop
      expect(amountCell.textContent).toMatch(/\+\s*₹/);
    });
  });

  describe("soft-delete (reverse) flow", () => {
    it("clicking × on a payment shows 'Reverse?' confirmation", async () => {
      const user = userEvent.setup();
      const purchase = makePurchase({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      const reverseBtn = screen.getByRole("button", {
        name: /reverse payment/i,
      });
      await user.click(reverseBtn);
      expect(screen.getByText(/reverse\?/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^confirm$/i })).toBeInTheDocument();
    });

    it("Confirm calls softDeletePurchasePayment with the payment id", async () => {
      const user = userEvent.setup();
      vi.mocked(softDeletePurchasePayment).mockResolvedValueOnce({
        ok: true as const,
      });
      const purchase = makePurchase({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ id: "p-target", amount: 50000 })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      await user.click(screen.getByRole("button", { name: /reverse payment/i }));
      await user.click(screen.getByRole("button", { name: /^confirm$/i }));
      expect(softDeletePurchasePayment).toHaveBeenCalledWith("p-target");
    });

    it("Cancel hides the confirmation without calling softDeletePurchasePayment", async () => {
      const user = userEvent.setup();
      const purchase = makePurchase({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel purchase={purchase} payments={payments} />);
      await user.click(screen.getByRole("button", { name: /reverse payment/i }));
      await user.click(
        screen.getByRole("button", { name: /cancel reversing payment/i }),
      );
      expect(screen.queryByText(/reverse\?/i)).not.toBeInTheDocument();
      expect(softDeletePurchasePayment).not.toHaveBeenCalled();
    });
  });
});
