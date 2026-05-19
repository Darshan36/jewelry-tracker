import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/app/(app)/parties/actions", () => ({
  createPartyPayment: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { PartyPaymentModal } from "./party-payment-modal";
import { createPartyPayment } from "@/app/(app)/parties/actions";

const PARTY = { id: "p1", name: "Test Supplier", phone: "9876543210" };

function makeTransactions(): React.ComponentProps<typeof PartyPaymentModal>["transactions"] {
  return [
    {
      entityType: "PURCHASE",
      entityId: "pu1",
      date: new Date("2026-05-10"),
      label: "Purchase · Order A",
      total: 50000,
      outstanding: 30000,
      hasAttachment: true,
    },
    {
      entityType: "PURCHASE",
      entityId: "pu2",
      date: new Date("2026-05-11"),
      label: "Purchase · Order B",
      total: 20000,
      outstanding: 20000,
      hasAttachment: false,
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PartyPaymentModal", () => {
  it("renders party header and transactions", () => {
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    expect(screen.getByText(/pay test supplier/i)).toBeInTheDocument();
    expect(screen.getByText(/purchase · order a/i)).toBeInTheDocument();
    expect(screen.getByText(/purchase · order b/i)).toBeInTheDocument();
  });

  it("shows missing-attachment badge for transactions without attachment", () => {
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    const badges = screen.getAllByTestId("missing-attachment-badge");
    expect(badges).toHaveLength(1);
  });

  it("Save button is disabled when no transaction selected", () => {
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    const button = screen.getByRole("button", { name: /^pay$/i });
    expect(button).toBeDisabled();
  });

  it("checking a transaction enables the Save button and shows sum", () => {
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    const button = screen.getByRole("button", { name: /^pay$/i });
    expect(button).not.toBeDisabled();
    // Sum should reflect the default amount (full outstanding 30000 = ₹300.00).
    // Use sumLine selector (the sum-line span has text-lg font-display class).
    expect(screen.getByText(/1 selected · sum/i)).toBeInTheDocument();
    const sumLine = document.querySelector(".text-lg.font-display");
    expect(sumLine?.textContent?.replace(/\s+/g, "")).toBe("₹300.00");
  });

  it("calls createPartyPayment with selected allocations on save", async () => {
    vi.mocked(createPartyPayment).mockResolvedValue({ ok: true, created: 1 });
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <PartyPaymentModal
        open={true}
        onClose={onClose}
        onSaved={onSaved}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: /^pay$/i }));
    await waitFor(() => expect(createPartyPayment).toHaveBeenCalledOnce());
    const call = vi.mocked(createPartyPayment).mock.calls[0][0];
    expect(call.allocations).toHaveLength(1);
    expect(call.allocations[0].entityType).toBe("PURCHASE");
    expect(call.allocations[0].entityId).toBe("pu1");
    expect(call.allocations[0].amount).toBe(300); // rupees, not paise
    expect(call.type).toBe("PAYMENT");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("surfaces per-allocation server errors on the matching row", async () => {
    vi.mocked(createPartyPayment).mockResolvedValue({
      ok: false,
      errors: {
        allocations: {
          0: ["Exceeds remaining balance (₹100.00)"],
        },
      },
    });
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: /^pay$/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/exceeds remaining balance/i),
      ).toBeInTheDocument();
    });
  });

  it("surfaces top-level error message when server returns one", async () => {
    vi.mocked(createPartyPayment).mockResolvedValue({
      ok: false,
      errors: { message: "Invalid date" },
    });
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: /^pay$/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid date/i)).toBeInTheDocument();
    });
  });

  it("button label is 'Record payment' for receivable direction", () => {
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="receivable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    expect(screen.getByText(/receive from test supplier/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /record payment/i }),
    ).toBeInTheDocument();
  });

  it("amount input edits update the sum line", () => {
    render(
      <PartyPaymentModal
        open={true}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    const amountInput = document.getElementById(
      "party-payment-amount-pu1",
    ) as HTMLInputElement;
    fireEvent.change(amountInput, { target: { value: "150" } });
    const sumLine = document.querySelector(".text-lg.font-display");
    expect(sumLine?.textContent?.replace(/\s+/g, "")).toBe("₹150.00");
  });

  it("does not call action when modal is closed via cancel", () => {
    const onClose = vi.fn();
    render(
      <PartyPaymentModal
        open={true}
        onClose={onClose}
        onSaved={vi.fn()}
        direction="payable"
        party={PARTY}
        transactions={makeTransactions()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
    expect(createPartyPayment).not.toHaveBeenCalled();
  });
});
