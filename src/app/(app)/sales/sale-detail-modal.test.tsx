// Tests for SaleDetailModal — Phase 12c additions.
//
// Mirror of purchase-detail-modal.test.tsx Phase 12a tests. Verifies the
// Photos section's render gate (photoCount > 0) and PhotoGallery mount
// in view mode.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

import { SaleDetailModal } from "./sale-detail-modal";
import type { SaleForClient } from "./sale-helpers";

function makeSale(
  overrides: Partial<SaleForClient> = {},
): SaleForClient {
  return {
    id: "sale-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: null,
    partyName: "Acme Customer",
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
        saleId: "sale-1",
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

describe("SaleDetailModal — photos render gate (Phase 12c)", () => {
  it("does NOT render the photos section when photoCount === 0", () => {
    render(
      <SaleDetailModal
        open={true}
        onOpenChange={() => {}}
        sale={makeSale({ photoCount: 0 })}
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
      <SaleDetailModal
        open={true}
        onOpenChange={() => {}}
        sale={makeSale({ photoCount: 3 })}
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
      <SaleDetailModal
        open={true}
        onOpenChange={() => {}}
        sale={makeSale({ photoCount: 1 })}
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
