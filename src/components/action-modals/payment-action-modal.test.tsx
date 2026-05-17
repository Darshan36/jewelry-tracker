// Tests for PaymentActionModal — shared payment recording surface used
// from the row Actions column on Sales (today) and the other entity
// types (when the dispatch table is wired in a follow-up phase).
//
// Verifies the entityType-based dispatch routes to the correct server
// action, that "Pay full balance" autofill computes the right value,
// and that error messages from the server action surface back to the
// form. The Sales-specific server action is the one wired in Phase 10
// scope; the other entity types currently surface a "not wired" error
// (deliberate — those entities still use their own legacy modals).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/(app)/sales/payment-actions", () => ({
  createSalePayment: vi.fn(),
}));

import { createSalePayment } from "@/app/(app)/sales/payment-actions";

import { PaymentActionModal } from "./payment-action-modal";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PaymentActionModal — happy path (sale)", () => {
  it("dispatches to createSalePayment for entityType='sale' with amount in rupees", async () => {
    const user = userEvent.setup();
    vi.mocked(createSalePayment).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payment: { id: "p-1" } as any,
    });

    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={100000}
        entityPaidAmount={0}
        open
        onClose={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText(/amount/i));
    await user.type(screen.getByLabelText(/amount/i), "500");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(createSalePayment).toHaveBeenCalledOnce();
    const call = vi.mocked(createSalePayment).mock.calls[0][0];
    expect(call.saleId).toBe("sale-1");
    expect(call.amount).toBe(500); // rupees, not paise — schema converts
    expect(call.type).toBe("PAYMENT");
  });

  it("closes the modal on successful save (onClose fires)", async () => {
    const user = userEvent.setup();
    vi.mocked(createSalePayment).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payment: { id: "p-1" } as any,
    });
    const onClose = vi.fn();

    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={0}
        open
        onClose={onClose}
      />,
    );

    await user.type(screen.getByLabelText(/amount/i), "300");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Wait for the post-submit close.
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

describe("PaymentActionModal — Pay full balance autofill", () => {
  it("'Pay full' fills the amount field with (entityTotal - entityPaidAmount) in rupees", async () => {
    const user = userEvent.setup();
    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        // ₹1,500 total minus ₹400 paid → remaining ₹1,100 → fills 1100
        entityTotal={150000}
        entityPaidAmount={40000}
        open
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pay full/i }));

    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(Number(amountInput.value)).toBe(1100);
  });

  it("'Pay full' fills 0 when the entity is already fully paid (boundary)", async () => {
    const user = userEvent.setup();
    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={50000}
        open
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pay full/i }));

    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(Number(amountInput.value)).toBe(0);
  });
});

describe("PaymentActionModal — refund mode", () => {
  it("renders in REFUND mode when paidAmount exceeds total (overpaid)", () => {
    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        // ₹600 paid against ₹500 total → ₹100 to refund
        entityPaidAmount={60000}
        open
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: /record refund/i })).toBeInTheDocument();
    expect(screen.getByText(/refund owed/i)).toBeInTheDocument();
  });

  it("'Refund full' fills the amount with the absolute overpay magnitude in rupees", async () => {
    const user = userEvent.setup();
    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={60000}
        open
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /refund full/i }));
    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(Number(amountInput.value)).toBe(100); // ₹100 to refund
  });

  it("dispatches REFUND type when in refund mode", async () => {
    const user = userEvent.setup();
    vi.mocked(createSalePayment).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payment: { id: "p-1" } as any,
    });

    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={60000}
        open
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /refund full/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(createSalePayment).toHaveBeenCalledOnce();
    const call = vi.mocked(createSalePayment).mock.calls[0][0];
    expect(call.type).toBe("REFUND");
  });
});

describe("PaymentActionModal — error surfacing", () => {
  it("surfaces a server-side amount error on the amount field", async () => {
    const user = userEvent.setup();
    vi.mocked(createSalePayment).mockResolvedValue({
      ok: false as const,
      errors: { amount: ["Exceeds remaining balance. Outstanding: ₹1,000.00"] },
    });

    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={0}
        open
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/amount/i), "9999");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/exceeds remaining balance/i),
      ).toBeInTheDocument();
    });
  });

  it("server failures keep the modal open (onClose NOT called)", async () => {
    const user = userEvent.setup();
    vi.mocked(createSalePayment).mockResolvedValue({
      ok: false as const,
      errors: { amount: ["Something went wrong"] },
    });
    const onClose = vi.fn();

    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={0}
        open
        onClose={onClose}
      />,
    );

    await user.type(screen.getByLabelText(/amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("PaymentActionModal — entityType dispatch (Phase 10 scope)", () => {
  it("entityType='purchase' surfaces a 'not wired yet' message and does NOT call createSalePayment", async () => {
    const user = userEvent.setup();
    render(
      <PaymentActionModal
        entityType="purchase"
        entityId="purchase-1"
        entityTotal={50000}
        entityPaidAmount={0}
        open
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/not wired yet/i)).toBeInTheDocument();
    });
    expect(createSalePayment).not.toHaveBeenCalled();
  });
});
