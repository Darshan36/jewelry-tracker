// Tests for PurchaseDetailModal — Phase 12a additions.
//
// The detail modal's read-only content was historically covered through
// purchases-table.test.tsx (which mocked the modal). Phase 12a needed
// directed tests of the new Photos section's render gate (photoCount > 0).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

// PhotoGallery self-loads via getPhotosForEntity. Stub to keep the test
// surface focused on the modal's render gate behaviour.
vi.mock("@/app/(app)/attachments/actions", () => ({
  getPhotosForEntity: vi.fn(async () => ({ ok: true, photos: [] })),
  getAttachmentViewUrl: vi.fn(async () => ({ ok: false, error: "stubbed" })),
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  softDeleteAttachment: vi.fn(),
}));

// Phase 22.1 — the detail modal now owns a Delete action; mock the server action.
vi.mock("./actions", () => ({
  softDeletePurchase: vi.fn(),
}));

import { PurchaseDetailModal } from "./purchase-detail-modal";
import { softDeletePurchase } from "./actions";
import type { PurchaseForClient } from "./purchase-helpers";

function makePurchase(
  overrides: Partial<PurchaseForClient> = {},
): PurchaseForClient {
  return {
    id: "purchase-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: null,
    partyName: "Acme Supplier",
    partyPhone: "9876543210",
    discount: 0,
    total: 100000,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lineItems: [
      {
        id: "li-1",
        purchaseId: "purchase-1",
        itemDescription: "Test item",
        qty: 1,
        rate: 100000,
        createdAt: new Date(),
      },
    ],
    payments: [],
    returns: [],
    paidAmount: 0,
    returnTotal: 0,
    status: "pending",
    photoCount: 0,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PurchaseDetailModal — photos render gate (Phase 12a)", () => {
  it("does NOT render the photos section when photoCount === 0", () => {
    render(
      <PurchaseDetailModal
        open={true}
        onOpenChange={() => {}}
        purchase={makePurchase({ photoCount: 0 })}
      />,
    );
    expect(screen.queryByText(/^Photos$/)).toBeNull();
    // The PhotoGallery component should not have mounted at all.
    expect(
      document.querySelector('[data-testid="photo-gallery"][data-mode="view"]'),
    ).toBeNull();
  });

  it("renders the photos section heading when photoCount > 0", () => {
    render(
      <PurchaseDetailModal
        open={true}
        onOpenChange={() => {}}
        purchase={makePurchase({ photoCount: 4 })}
      />,
    );
    expect(screen.getByText(/^Photos$/)).toBeInTheDocument();
  });

  it("mounts the PhotoGallery in view mode when photoCount > 0 + photos returned", async () => {
    const { getPhotosForEntity } = await import("@/app/(app)/attachments/actions");
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({
      ok: true,
      photos: [
        {
          id: "photo-x",
          originalFilename: "x.png",
          mimeType: "image/png",
          sizeBytes: 100,
          uploadedAt: new Date(),
        },
      ],
    });
    render(
      <PurchaseDetailModal
        open={true}
        onOpenChange={() => {}}
        purchase={makePurchase({ photoCount: 1 })}
      />,
    );
    await vi.waitFor(() => {
      const gallery = document.querySelector(
        '[data-testid="photo-gallery"][data-mode="view"]',
      );
      expect(gallery).toBeInTheDocument();
    });
  });
});

// Phase 22.1 — Delete is reachable from the detail modal on every device
// (was only on the desktop row's hover-reveal cluster, unreachable on touch).
describe("PurchaseDetailModal — Delete affordance (Phase 22.1)", () => {
  it("renders an always-visible Delete button (no hover gate) that confirms then calls softDeletePurchase", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <PurchaseDetailModal
        open={true}
        onOpenChange={onOpenChange}
        purchase={makePurchase({ id: "pur-del" })}
      />,
    );

    const del = screen.getByTestId("modal-delete-purchase-pur-del");
    expect(del).toBeVisible();

    await user.click(del);
    expect(softDeletePurchase).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("modal-confirm-delete-purchase-pur-del"));
    await waitFor(() => {
      expect(softDeletePurchase).toHaveBeenCalledWith("pur-del");
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
