// Smoke tests for PlatingDetailModal — Phase 10.6 read-only conversion.
//
// Detail modal is read-only for line items / payments / attachment. These
// tests pin the contract:
//   - No inline Add Payment / Replace Attachment buttons (those stay on the row);
//     Phase 22.1 added a Delete action to the modal (reachable on touch).
//   - Edit link routes to /plating/[id]/edit.
//   - Materials table renders with formatKg + ratePerKg/kg + lineTotal.
//   - Payments history renders read-only (no × delete affordance).
//   - REFUND-type payments render with money-IN inversion (text-secondary, "+" prefix).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/app/(app)/attachments/actions", () => ({
  getAttachmentViewUrl: vi.fn(),
}));
// Phase 22.1 — the detail modal now owns a Delete action; mock the server action.
vi.mock("./actions", () => ({
  softDeletePlatingEntry: vi.fn(),
}));

import { PlatingDetailModal } from "./plating-detail-modal";
import { softDeletePlatingEntry } from "./actions";
import type { PlatingEntryForClient } from "./plating-helpers";

function makeEntry(
  overrides: Partial<PlatingEntryForClient> = {},
): PlatingEntryForClient {
  return {
    id: "plating-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: null,
    partyName: "Acme Vendor",
    partyPhone: "9876543210",
    discount: 10000,
    total: 90000,
    notes: null,
    attachmentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lineItems: [
      {
        id: "li-1",
        platingEntryId: "plating-1",
        materialDescription: "Brass",
        weightKg: "2.500",
        ratePerKg: 40000,
        lineTotal: 100000,
        createdAt: new Date(),
      },
    ],
    payments: [],
    paidAmount: 0,
    status: "pending",
    party: null,
    bill: null,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlatingDetailModal — Phase 10.6 read-only contract", () => {
  it("returns null when entry prop is null", () => {
    const { container } = render(
      <PlatingDetailModal open onOpenChange={vi.fn()} entry={null} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders materials table with formatKg + ratePerKg/kg columns", () => {
    render(
      <PlatingDetailModal open onOpenChange={vi.fn()} entry={makeEntry()} />,
    );
    expect(screen.getByText(/^Brass$/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.500 kg/)).toBeInTheDocument();
    expect(screen.getByText(/₹400\.00\/kg/)).toBeInTheDocument();
  });

  it("renders an Edit link routing to /plating/[id]/edit (the only navigation surface)", () => {
    render(
      <PlatingDetailModal open onOpenChange={vi.fn()} entry={makeEntry({ id: "c-42" })} />,
    );
    const editLink = screen.getByRole("link", { name: /edit/i });
    expect(editLink).toHaveAttribute("href", "/plating/c-42/edit");
  });

  it("has no inline Add Payment / Replace buttons (those stay on the row), but DOES expose Delete (Phase 22.1)", () => {
    render(
      <PlatingDetailModal open onOpenChange={vi.fn()} entry={makeEntry()} />,
    );
    expect(
      screen.queryByRole("button", { name: /add payment/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /replace/i }),
    ).not.toBeInTheDocument();
    // Phase 22.1 — Delete moved INTO the modal so it is reachable on touch.
    expect(
      screen.getByRole("button", { name: /^delete$/i }),
    ).toBeInTheDocument();
  });

  it("Delete is always-visible (no hover gate) and confirms before calling softDeletePlatingEntry (Phase 22.1)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <PlatingDetailModal
        open
        onOpenChange={onOpenChange}
        entry={makeEntry({ id: "p-del" })}
      />,
    );

    const del = screen.getByTestId("modal-delete-plating-p-del");
    expect(del).toBeVisible();

    await user.click(del);
    expect(softDeletePlatingEntry).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("modal-confirm-delete-plating-p-del"));
    await waitFor(() => {
      expect(softDeletePlatingEntry).toHaveBeenCalledWith("p-del");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders 'No payments recorded yet' when payments array is empty", () => {
    render(
      <PlatingDetailModal open onOpenChange={vi.fn()} entry={makeEntry()} />,
    );
    expect(
      screen.getByText(/no payments recorded yet/i),
    ).toBeInTheDocument();
  });

  it("renders REFUND-type payments with money-IN inversion ('Refund received', '+' prefix)", () => {
    render(
      <PlatingDetailModal
        open
        onOpenChange={vi.fn()}
        entry={makeEntry({
          payments: [
            {
              id: "pay-1",
              platingEntryId: "plating-1",
              date: new Date("2026-05-11T00:00:00Z"),
              amount: 50000,
              type: "REFUND",
              note: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          ],
          paidAmount: -50000,
        })}
      />,
    );
    // Plating REFUND = vendor refunded shop = money IN; label = "Refund received".
    expect(screen.getByText(/refund received/i)).toBeInTheDocument();
    // Plus prefix on the amount (Purchases-direction inversion).
    expect(screen.getByText(/\+₹500\.00/)).toBeInTheDocument();
  });
});
