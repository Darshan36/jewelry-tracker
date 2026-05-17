// Tests for PaymentActionModal — Phase 10.5 prop-injection refactor.
//
// The modal is now entity-agnostic: the caller injects the server
// action via the `onSave` prop, the modal just calls onSave(data) on
// submit. entityType is retained as a UI-side discriminator (label
// direction).
//
// Test strategy: `describe.each(ENTITY_MATRIX)` exercises the prop
// contract uniformly across all four entity types so Phase 10.6's
// Casting/Plating wiring can land without rewriting these tests.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

import {
  PaymentActionModal,
  type PaymentEntityType,
  type PaymentSaveResult,
} from "./payment-action-modal";

const ENTITY_MATRIX: readonly PaymentEntityType[] = [
  "sale",
  "purchase",
  "casting",
  "plating",
];

beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================================
// Cross-entity contract — same prop-injection behaviour everywhere
// =====================================================================

describe.each(ENTITY_MATRIX)("PaymentActionModal — entityType=%s", (entityType) => {
  it("dispatches to the injected onSave with the form data on submit", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockResolvedValue({ ok: true } as PaymentSaveResult);

    render(
      <PaymentActionModal
        entityType={entityType}
        entityId={`${entityType}-1`}
        entityTotal={100000}
        entityPaidAmount={0}
        open
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.clear(screen.getByLabelText(/amount/i));
    await user.type(screen.getByLabelText(/amount/i), "500");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    // The data shape passed to onSave is uniform across entity types:
    // {date, amount, type, note}. The caller closes over entityId and
    // wraps the server-action call.
    const call = onSave.mock.calls[0][0];
    expect(call.amount).toBe(500);
    expect(call.type).toBe("PAYMENT");
    expect(call.date).toBeInstanceOf(Date);
  });

  it("closes the modal on successful save", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn()
      .mockResolvedValue({ ok: true } as PaymentSaveResult);
    const onClose = vi.fn();

    render(
      <PaymentActionModal
        entityType={entityType}
        entityId={`${entityType}-1`}
        entityTotal={50000}
        entityPaidAmount={0}
        open
        onClose={onClose}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText(/amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("does NOT close the modal when onSave returns ok=false", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      errors: { amount: ["Server-side error"] },
    } as PaymentSaveResult);
    const onClose = vi.fn();

    render(
      <PaymentActionModal
        entityType={entityType}
        entityId={`${entityType}-1`}
        entityTotal={50000}
        entityPaidAmount={0}
        open
        onClose={onClose}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText(/amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/server-side error/i)).toBeInTheDocument();
  });
});

// =====================================================================
// Entity-type-specific UX (direction labels, autofill)
// =====================================================================

describe("PaymentActionModal — Pay full balance autofill (cross-entity)", () => {
  it("fills the amount with the remaining balance in rupees", async () => {
    const user = userEvent.setup();
    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={150000} // ₹1,500
        entityPaidAmount={40000} // ₹400 paid
        open
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    await user.click(screen.getByRole("button", { name: /pay full/i }));
    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(Number(amountInput.value)).toBe(1100); // 1500 − 400
  });
});

describe("PaymentActionModal — refund mode auto-detection", () => {
  it("renders 'Record refund' when paidAmount > entityTotal (overpaid)", () => {
    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={60000} // overpaid by ₹100
        open
        onClose={vi.fn()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /record refund/i }),
    ).toBeInTheDocument();
  });

  it("dispatches type=REFUND when in refund mode", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ ok: true });

    render(
      <PaymentActionModal
        entityType="purchase"
        entityId="p-1"
        entityTotal={50000}
        entityPaidAmount={60000}
        open
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /refund full/i }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].type).toBe("REFUND");
  });

  // Phase 10.6: extend REFUND-mode dispatch coverage to casting/plating
  // so each new entity type gets its own dispatch assertion. The modal
  // itself is entity-agnostic, but this pins the contract — REFUND mode
  // produces a type=REFUND payload regardless of which entity's onSave
  // is injected.
  it.each(["casting", "plating"] as const)(
    "entityType=%s in refund mode dispatches type=REFUND",
    async (entityType) => {
      const user = userEvent.setup();
      const onSave = vi.fn().mockResolvedValue({ ok: true });

      render(
        <PaymentActionModal
          entityType={entityType}
          entityId={`${entityType}-1`}
          entityTotal={50000}
          entityPaidAmount={60000}
          open
          onClose={vi.fn()}
          onSave={onSave}
        />,
      );

      await user.click(screen.getByRole("button", { name: /refund full/i }));
      await user.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(onSave.mock.calls[0][0].type).toBe("REFUND");
    },
  );
});

describe("PaymentActionModal — direction labels", () => {
  it("entityType='sale' shows 'Outstanding' label", () => {
    render(
      <PaymentActionModal
        entityType="sale"
        entityId="sale-1"
        entityTotal={50000}
        entityPaidAmount={0}
        open
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/^Outstanding$/i)).toBeInTheDocument();
    expect(screen.queryByText(/Owed to vendor/i)).not.toBeInTheDocument();
  });

  it.each(["purchase", "casting", "plating"] as const)(
    "entityType=%s shows 'Owed to vendor' label",
    (entityType) => {
      render(
        <PaymentActionModal
          entityType={entityType}
          entityId={`${entityType}-1`}
          entityTotal={50000}
          entityPaidAmount={0}
          open
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      expect(screen.getByText(/Owed to vendor/i)).toBeInTheDocument();
      expect(screen.queryByText(/^Outstanding$/i)).not.toBeInTheDocument();
    },
  );
});
