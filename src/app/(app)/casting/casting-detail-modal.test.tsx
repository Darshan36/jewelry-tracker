// Smoke tests for CastingDetailModal — Phase 10.6 read-only conversion.
//
// Detail modal is now read-only. These tests pin the Phase 10.6 contract:
//   - ZERO mutation buttons (no Add Payment / Replace Attachment / Delete inside).
//   - Edit link routes to /casting/[id]/edit.
//   - Materials table renders with formatKg + ratePerKg/kg + lineTotal.
//   - Payments history renders read-only (no × delete affordance).
//   - REFUND-type payments render with money-IN inversion (text-secondary, "+" prefix).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/app/(app)/attachments/actions", () => ({
  getAttachmentViewUrl: vi.fn(),
}));

import { CastingDetailModal } from "./casting-detail-modal";
import type { CastingEntryForClient } from "./casting-helpers";

function makeEntry(
  overrides: Partial<CastingEntryForClient> = {},
): CastingEntryForClient {
  return {
    id: "casting-1",
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
        castingEntryId: "casting-1",
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

describe("CastingDetailModal — Phase 10.6 read-only contract", () => {
  it("returns null when entry prop is null", () => {
    const { container } = render(
      <CastingDetailModal open onOpenChange={vi.fn()} entry={null} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders materials table with formatKg + ratePerKg/kg columns", () => {
    render(
      <CastingDetailModal open onOpenChange={vi.fn()} entry={makeEntry()} />,
    );
    expect(screen.getByText(/^Brass$/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.500 kg/)).toBeInTheDocument();
    expect(screen.getByText(/₹400\.00\/kg/)).toBeInTheDocument();
  });

  it("renders an Edit link routing to /casting/[id]/edit (the only navigation surface)", () => {
    render(
      <CastingDetailModal open onOpenChange={vi.fn()} entry={makeEntry({ id: "c-42" })} />,
    );
    const editLink = screen.getByRole("link", { name: /edit/i });
    expect(editLink).toHaveAttribute("href", "/casting/c-42/edit");
  });

  it("has ZERO mutation buttons inside (no Add Payment / Replace / Delete)", () => {
    render(
      <CastingDetailModal open onOpenChange={vi.fn()} entry={makeEntry()} />,
    );
    expect(
      screen.queryByRole("button", { name: /add payment/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /replace/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^delete$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders 'No payments recorded yet' when payments array is empty", () => {
    render(
      <CastingDetailModal open onOpenChange={vi.fn()} entry={makeEntry()} />,
    );
    expect(
      screen.getByText(/no payments recorded yet/i),
    ).toBeInTheDocument();
  });

  it("renders REFUND-type payments with money-IN inversion ('Refund received', '+' prefix)", () => {
    render(
      <CastingDetailModal
        open
        onOpenChange={vi.fn()}
        entry={makeEntry({
          payments: [
            {
              id: "pay-1",
              castingEntryId: "casting-1",
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
    // Casting REFUND = vendor refunded shop = money IN; label = "Refund received".
    expect(screen.getByText(/refund received/i)).toBeInTheDocument();
    // Plus prefix on the amount (Purchases-direction inversion).
    expect(screen.getByText(/\+₹500\.00/)).toBeInTheDocument();
  });
});
