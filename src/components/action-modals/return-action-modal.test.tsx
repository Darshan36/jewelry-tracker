// Tests for ReturnActionModal — Phase 10.5 prop-injection refactor.
//
// Casting/Plating have no returns workflow (Phase 9 decision lineage),
// so this modal is parameterised over `sale` + `purchase` only.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

import {
  ReturnActionModal,
  type ReturnEntityType,
  type ReturnSaveResult,
} from "./return-action-modal";

const ENTITY_MATRIX: readonly ReturnEntityType[] = ["sale", "purchase"];

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(ENTITY_MATRIX)("ReturnActionModal — entityType=%s", (entityType) => {
  it("dispatches to the injected onSave with the form data on submit", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ ok: true } as ReturnSaveResult);

    render(
      <ReturnActionModal
        entityType={entityType}
        entityId={`${entityType}-1`}
        open
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.clear(screen.getByLabelText(/qty returned/i));
    await user.type(screen.getByLabelText(/qty returned/i), "2");
    await user.type(screen.getByLabelText(/refund amount/i), "300");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const call = onSave.mock.calls[0][0];
    expect(call.qtyReturned).toBe(2);
    expect(call.refundAmount).toBe(300);
    expect(call.date).toBeInstanceOf(Date);
  });

  it("closes the modal on successful save", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({ ok: true } as ReturnSaveResult);
    const onClose = vi.fn();

    render(
      <ReturnActionModal
        entityType={entityType}
        entityId={`${entityType}-1`}
        open
        onClose={onClose}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByLabelText(/refund amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("surfaces server qtyReturned error on the qty field", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue({
      ok: false,
      errors: { qtyReturned: ["Cannot return more than the original quantity."] },
    } as ReturnSaveResult);

    render(
      <ReturnActionModal
        entityType={entityType}
        entityId={`${entityType}-1`}
        open
        onClose={vi.fn()}
        onSave={onSave}
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
});

describe("ReturnActionModal — Cancel button", () => {
  it("clicking Cancel fires onClose and does NOT call onSave", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSave = vi.fn();

    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={onClose}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("ReturnActionModal — client-side validation", () => {
  it("rejects qty=0 client-side (schema requires positive)", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <ReturnActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.clear(screen.getByLabelText(/qty returned/i));
    await user.type(screen.getByLabelText(/qty returned/i), "0");
    await user.type(screen.getByLabelText(/refund amount/i), "100");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // onSave NOT called because client-side validation halted submit.
    expect(onSave).not.toHaveBeenCalled();
  });
});
