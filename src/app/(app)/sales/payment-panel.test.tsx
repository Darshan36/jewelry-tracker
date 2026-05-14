import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/sales",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./payment-actions", () => ({
  createSalePayment: vi.fn(),
  softDeleteSalePayment: vi.fn(),
}));

import { PaymentPanel } from "./payment-panel";
import { createSalePayment, softDeleteSalePayment } from "./payment-actions";
import type {
  SaleForClient,
  SalePaymentForClient,
} from "./sale-helpers";

function makeSale(overrides: Partial<SaleForClient> = {}): SaleForClient {
  return {
    id: "s-1",
    date: new Date("2026-05-10T00:00:00Z"),
    customerId: null,
    partyName: "Test Walkin",
    partyPhone: null,
    itemDescription: "Gold chain",
    qty: 10,
    rate: 25000,
    discount: 10000,
    total: 240000,
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

function makePayment(
  overrides: Partial<SalePaymentForClient> = {},
): SalePaymentForClient {
  return {
    id: "p-default",
    saleId: "s-1",
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

describe("PaymentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("empty state", () => {
    it("shows 'No payments yet' when payments array is empty", () => {
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      expect(screen.getByText(/no payments yet/i)).toBeInTheDocument();
    });

    it("shows + Record payment button when outstanding > 0", () => {
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      expect(
        screen.getByRole("button", { name: /record payment/i }),
      ).toBeInTheDocument();
    });
  });

  describe("outstanding balance display", () => {
    it("renders 'Outstanding: ₹2,400.00' when paidAmount is 0", () => {
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      const outstanding = screen.getByText(/outstanding:/i);
      expect(outstanding.textContent).toMatch(/₹\s*2,400\.00/);
    });

    it("renders 'Outstanding: ₹1,900.00' when paidAmount is 50000 paise", () => {
      const sale = makeSale({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      const outstanding = screen.getByText(/outstanding:/i);
      expect(outstanding.textContent).toMatch(/₹\s*1,900\.00/);
    });

    it("renders 'Outstanding: ₹0.00' when fully paid", () => {
      const sale = makeSale({ paidAmount: 240000, status: "completed" });
      const payments = [makePayment({ amount: 240000 })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      const outstanding = screen.getByText(/outstanding:/i);
      expect(outstanding.textContent).toMatch(/₹\s*0\.00/);
    });

    it("hides the + Record payment button when outstanding is 0", () => {
      const sale = makeSale({ paidAmount: 240000, status: "completed" });
      const payments = [makePayment({ amount: 240000 })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      expect(
        screen.queryByRole("button", { name: /record payment/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("payment list rendering", () => {
    it("renders one row per payment with date and amount", () => {
      const sale = makeSale({ paidAmount: 80000, status: "partial" });
      const payments = [
        makePayment({ id: "p1", amount: 50000, date: new Date("2026-05-11T00:00:00Z") }),
        makePayment({ id: "p2", amount: 30000, date: new Date("2026-05-12T00:00:00Z"), note: "Cash" }),
      ];
      render(<PaymentPanel sale={sale} payments={payments} />);
      // Both amounts should be visible (formatted)
      expect(screen.getByText(/₹\s*500\.00/)).toBeInTheDocument();
      expect(screen.getByText(/₹\s*300\.00/)).toBeInTheDocument();
      // Note for p2
      expect(screen.getByText("Cash")).toBeInTheDocument();
    });

    it("renders '—' for null notes", () => {
      const sale = makeSale({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000, note: null })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      // The dash should appear in the note column. There could be other —s in
      // the doc, scope to the payment list (li elements).
      const paymentList = screen.getByRole("list");
      expect(within(paymentList).getByText("—")).toBeInTheDocument();
    });
  });

  describe("Record payment form", () => {
    it("clicking '+ Record payment' opens the inline form", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      expect(screen.getByLabelText(/^date/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^amount/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /pay full balance/i }),
      ).toBeInTheDocument();
    });

    it("date input defaults to today's YYYY-MM-DD in the form", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      const dateInput = screen.getByLabelText(/^date/i) as HTMLInputElement;
      const today = new Date();
      const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      expect(dateInput.value).toBe(expected);
    });

    it("'Pay full balance' button fills amount input with the remaining rupees", async () => {
      const user = userEvent.setup();
      const sale = makeSale({ paidAmount: 50000, status: "partial" }); // remaining 190000 paise = 1900 rupees
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      await user.click(screen.getByRole("button", { name: /pay full balance/i }));
      const amountInput = screen.getByLabelText(/^amount/i) as HTMLInputElement;
      expect(Number(amountInput.value)).toBe(1900);
    });

    it("submitting calls createSalePayment with form values + saleId", async () => {
      const user = userEvent.setup();
      vi.mocked(createSalePayment).mockResolvedValueOnce({
        ok: true as const,
        payment: makePayment({ amount: 50000 }),
      });
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      const amountInput = screen.getByLabelText(/^amount/i);
      await user.type(amountInput, "500");
      // Submit by clicking the Save button (form's submit button)
      const dialogForm = amountInput.closest("form")!;
      const saveBtn = within(dialogForm).getByRole("button", { name: /^save$/i });
      await user.click(saveBtn);
      expect(createSalePayment).toHaveBeenCalledOnce();
      const callArg = vi.mocked(createSalePayment).mock.calls[0][0];
      expect(callArg.saleId).toBe("s-1");
      expect(callArg.amount).toBe(500);
    });

    it("displays inline error under amount when server returns overpayment", async () => {
      const user = userEvent.setup();
      vi.mocked(createSalePayment).mockResolvedValueOnce({
        ok: false as const,
        errors: {
          amount: ["Exceeds remaining balance. Outstanding: ₹1,900.00"],
        },
      });
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      await user.type(screen.getByLabelText(/^amount/i), "5000");
      const form = screen.getByLabelText(/^amount/i).closest("form")!;
      await user.click(within(form).getByRole("button", { name: /^save$/i }));
      expect(
        screen.getByText(/exceeds remaining balance.*₹\s*1,900\.00/i),
      ).toBeInTheDocument();
      // Form stays open after error (Save button still rendered)
      expect(within(form).getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    });

    it("Cancel button closes the form without calling createSalePayment", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel sale={makeSale()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /record payment/i }));
      // Form's Cancel button has aria-label="Cancel recording payment" to
      // disambiguate from the reverse-confirm Cancel ("Cancel reversing
      // payment") — Phase 3.2 closeout pattern, extended here.
      await user.click(
        screen.getByRole("button", { name: /cancel recording payment/i }),
      );
      expect(screen.queryByLabelText(/^amount/i)).not.toBeInTheDocument();
      expect(createSalePayment).not.toHaveBeenCalled();
    });
  });

  describe("refund mode (Phase 3.3)", () => {
    function refundDueSale(overrides: Partial<SaleForClient> = {}) {
      // total 240000, paid 240000, returnTotal 40000 → effective 200000.
      // Status refund_due (paid 240000 > effective 200000 by ₹400).
      return makeSale({
        total: 240000,
        paidAmount: 240000,
        returnTotal: 40000,
        status: "refund_due",
        ...overrides,
      });
    }

    it("button label switches to 'Issue refund' when status === refund_due", () => {
      render(<PaymentPanel sale={refundDueSale()} payments={[]} />);
      expect(
        screen.getByRole("button", { name: /issue refund/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^record payment$/i }),
      ).not.toBeInTheDocument();
    });

    it("indicator label = 'Refund owed' in text-error when refund_due", () => {
      render(<PaymentPanel sale={refundDueSale()} payments={[]} />);
      const indicator = screen.getByText(/refund owed:/i);
      // ₹400.00 = 240000 paid − 200000 effective = 40000 paise owed back
      expect(indicator.textContent).toMatch(/₹\s*400\.00/);
      expect(indicator).toHaveClass("text-error");
    });

    it("'Refund full amount' autofill button label + fills with refund-owed rupees", async () => {
      const user = userEvent.setup();
      render(<PaymentPanel sale={refundDueSale()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /issue refund/i }));
      const autofillBtn = screen.getByRole("button", {
        name: /refund full amount/i,
      });
      expect(autofillBtn).toBeInTheDocument();
      await user.click(autofillBtn);
      const amountInput = screen.getByLabelText(/^amount/i) as HTMLInputElement;
      expect(Number(amountInput.value)).toBe(400);
    });

    it("submitting the refund form sends type=REFUND to createSalePayment", async () => {
      const user = userEvent.setup();
      vi.mocked(createSalePayment).mockResolvedValueOnce({
        ok: true as const,
        payment: makePayment({ type: "REFUND", amount: 40000 }),
      });
      render(<PaymentPanel sale={refundDueSale()} payments={[]} />);
      await user.click(screen.getByRole("button", { name: /issue refund/i }));
      await user.click(
        screen.getByRole("button", { name: /refund full amount/i }),
      );
      const form = screen.getByLabelText(/^amount/i).closest("form")!;
      await user.click(within(form).getByRole("button", { name: /^save$/i }));
      expect(createSalePayment).toHaveBeenCalledOnce();
      const arg = vi.mocked(createSalePayment).mock.calls[0][0];
      expect(arg.type).toBe("REFUND");
      expect(arg.amount).toBe(400);
    });

    it("REFUND-type payment row renders with red label + minus-prefixed amount", () => {
      const sale = makeSale({
        paidAmount: 200000, // net: 240000 PAYMENT - 40000 REFUND
        status: "completed",
      });
      const payments = [
        makePayment({ id: "p1", amount: 240000, type: "PAYMENT" }),
        makePayment({ id: "p2", amount: 40000, type: "REFUND" }),
      ];
      render(<PaymentPanel sale={sale} payments={payments} />);
      const list = screen.getByRole("list");
      // "Refund" badge appears for the REFUND row
      const refundBadge = within(list).getByText(/^Refund$/i);
      expect(refundBadge).toHaveClass("text-error");
      // The amount cell for the REFUND row has text-error class
      const refundRow = refundBadge.closest("li")!;
      const amountCell = within(refundRow).getByText(
        (content) => /₹\s*400\.00/.test(content),
      );
      expect(amountCell).toHaveClass("text-error");
      // Minus prefix present (U+2212 MINUS SIGN)
      expect(amountCell.textContent).toMatch(/[-–—−]\s*₹/);
    });
  });

  describe("soft-delete (reverse) flow", () => {
    it("clicking × on a payment shows 'Reverse?' confirmation", async () => {
      const user = userEvent.setup();
      const sale = makeSale({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      const reverseBtn = screen.getByRole("button", {
        name: /reverse payment/i,
      });
      // Force click since it's opacity-0 until hover; jsdom hover sim is flaky.
      await user.click(reverseBtn);
      expect(screen.getByText(/reverse\?/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^confirm$/i })).toBeInTheDocument();
    });

    it("Confirm calls softDeleteSalePayment with the payment id", async () => {
      const user = userEvent.setup();
      vi.mocked(softDeleteSalePayment).mockResolvedValueOnce({
        ok: true as const,
      });
      const sale = makeSale({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ id: "p-target", amount: 50000 })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      await user.click(screen.getByRole("button", { name: /reverse payment/i }));
      await user.click(screen.getByRole("button", { name: /^confirm$/i }));
      expect(softDeleteSalePayment).toHaveBeenCalledWith("p-target");
    });

    it("Cancel hides the confirmation without calling softDeleteSalePayment", async () => {
      const user = userEvent.setup();
      const sale = makeSale({ paidAmount: 50000, status: "partial" });
      const payments = [makePayment({ amount: 50000 })];
      render(<PaymentPanel sale={sale} payments={payments} />);
      await user.click(screen.getByRole("button", { name: /reverse payment/i }));
      // The reverse-confirm Cancel button has its own aria-label to
      // disambiguate from the form's Cancel button.
      await user.click(
        screen.getByRole("button", { name: /cancel reversing payment/i }),
      );
      expect(screen.queryByText(/reverse\?/i)).not.toBeInTheDocument();
      expect(softDeleteSalePayment).not.toHaveBeenCalled();
    });
  });
});
