// Tests for ReturnActionModal — shared return-recording surface used
// from the row Actions column on Sales (today) and Purchases (when
// the dispatch is wired in a follow-up).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/(app)/sales/return-actions", () => ({
  createSaleReturn: vi.fn(),
}));

import { createSaleReturn } from "@/app/(app)/sales/return-actions";

import { ReturnActionModal } from "./return-action-modal";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReturnActionModal — happy path (sale)", () => {
  it("dispatches to createSaleReturn for entityType='sale' with rupee amounts", async () => {
    const user = userEvent.setup();
    vi.mocked(createSaleReturn).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return: { id: "r-1" } as any,
    });

    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText(/qty returned/i));
    await user.type(screen.getByLabelText(/qty returned/i), "2");
    await user.type(screen.getByLabelText(/refund amount/i), "300");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(createSaleReturn).toHaveBeenCalledOnce();
    const call = vi.mocked(createSaleReturn).mock.calls[0][0];
    expect(call.saleId).toBe("sale-1");
    expect(call.qtyReturned).toBe(2);
    expect(call.refundAmount).toBe(300);
  });

  it("closes the modal on successful save", async () => {
    const user = userEvent.setup();
    vi.mocked(createSaleReturn).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return: { id: "r-1" } as any,
    });
    const onClose = vi.fn();

    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={onClose}
      />,
    );
    await user.type(screen.getByLabelText(/refund amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});

describe("ReturnActionModal — field validation", () => {
  it("surfaces server qtyReturned error on the qty field", async () => {
    const user = userEvent.setup();
    vi.mocked(createSaleReturn).mockResolvedValue({
      ok: false as const,
      errors: {
        qtyReturned: ["Cannot return more than the original quantity. Already returned: 2 of 3"],
      },
    });

    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/refund amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/cannot return more than the original quantity/i),
      ).toBeInTheDocument();
    });
  });

  it("surfaces server refundAmount error on the refund field", async () => {
    const user = userEvent.setup();
    vi.mocked(createSaleReturn).mockResolvedValue({
      ok: false as const,
      errors: { refundAmount: ["Refund exceeds remaining returnable value. Maximum: ₹500.00"] },
    });

    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/refund amount/i), "9999");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/refund exceeds remaining returnable value/i),
      ).toBeInTheDocument();
    });
  });

  it("rejects qty=0 client-side (schema requires positive)", async () => {
    const user = userEvent.setup();
    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );

    await user.clear(screen.getByLabelText(/qty returned/i));
    await user.type(screen.getByLabelText(/qty returned/i), "0");
    await user.type(screen.getByLabelText(/refund amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Server-action not called; client-side validation halted the submit.
    expect(createSaleReturn).not.toHaveBeenCalled();
  });

  // (Removed: a negative-refundAmount client-side test. The
  // `<input type="number" min="0">` plus jsdom's keystroke handling
  // means userEvent.type("-50") doesn't reliably produce a negative
  // value to validate against. The qty=0 case above covers the
  // client-side schema-rejection pattern adequately; server-layer
  // negative handling is already pinned in return-actions.test.ts.)
});

describe("ReturnActionModal — entityType dispatch", () => {
  it("entityType='purchase' shows 'not wired yet' and does NOT call createSaleReturn", async () => {
    const user = userEvent.setup();
    render(
      <ReturnActionModal
        entityType="purchase"
        entityId="purchase-1"
        open
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText(/refund amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/not wired yet/i)).toBeInTheDocument();
    });
    expect(createSaleReturn).not.toHaveBeenCalled();
  });
});

describe("ReturnActionModal — Cancel button", () => {
  it("clicking Cancel fires onClose without saving", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(createSaleReturn).not.toHaveBeenCalled();
  });
});
