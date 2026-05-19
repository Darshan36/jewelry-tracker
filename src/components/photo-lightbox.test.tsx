// Tests for PhotoLightbox — Phase 12a.
//
// Verifies open/close behavior, prev/next button + keyboard navigation,
// presigned URL fetch on index change, and edge cases (first/last photo
// hides the corresponding direction button).

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/attachments/actions", () => ({
  getAttachmentViewUrl: vi.fn(),
}));

import {
  getAttachmentViewUrl,
  type PhotoForClient,
} from "@/app/(app)/attachments/actions";

import { PhotoLightbox } from "./photo-lightbox";

function makePhotos(n: number): PhotoForClient[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p-${i + 1}`,
    originalFilename: `photo-${i + 1}.png`,
    mimeType: "image/png",
    sizeBytes: 100,
    uploadedAt: new Date(`2026-05-${10 + i}T12:00:00Z`),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAttachmentViewUrl).mockImplementation(async (id: string) => ({
    ok: true as const,
    url: `https://signed.example/${id}`,
  }));
  cleanup();
});

describe("PhotoLightbox — open/close", () => {
  it("renders the current photo's filename and 1-of-N counter", async () => {
    const photos = makePhotos(3);
    render(
      <PhotoLightbox
        photos={photos}
        initialIndex={0}
        open={true}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("photo-1.png")).toBeInTheDocument();
      expect(screen.getByText("1 / 3")).toBeInTheDocument();
    });
  });

  it("does not render any lightbox content when open=false", () => {
    const photos = makePhotos(2);
    render(
      <PhotoLightbox
        photos={photos}
        initialIndex={0}
        open={false}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByTestId("photo-lightbox")).toBeNull();
  });

  it("hides the prev button on the first photo", async () => {
    const photos = makePhotos(3);
    render(
      <PhotoLightbox
        photos={photos}
        initialIndex={0}
        open={true}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("photo-lightbox"));
    expect(screen.queryByLabelText(/previous photo/i)).toBeNull();
    expect(screen.getByLabelText(/next photo/i)).toBeInTheDocument();
  });

  it("hides the next button on the last photo", async () => {
    const photos = makePhotos(3);
    render(
      <PhotoLightbox
        photos={photos}
        initialIndex={2}
        open={true}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("photo-lightbox"));
    expect(screen.queryByLabelText(/next photo/i)).toBeNull();
    expect(screen.getByLabelText(/previous photo/i)).toBeInTheDocument();
  });
});

describe("PhotoLightbox — navigation", () => {
  it("next button advances to the next photo", async () => {
    const photos = makePhotos(3);
    render(
      <PhotoLightbox
        photos={photos}
        initialIndex={0}
        open={true}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("photo-1.png"));
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/next photo/i));
    await waitFor(() => {
      expect(screen.getByText("photo-2.png")).toBeInTheDocument();
      expect(screen.getByText("2 / 3")).toBeInTheDocument();
    });
  });

  it("ArrowRight key advances; ArrowLeft retreats", async () => {
    const photos = makePhotos(3);
    render(
      <PhotoLightbox
        photos={photos}
        initialIndex={1}
        open={true}
        onClose={() => {}}
      />,
    );
    await waitFor(() => screen.getByText("photo-2.png"));

    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => screen.getByText("photo-3.png"));
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => screen.getByText("photo-1.png"));
  });

  it("fetches a presigned URL once per photo (cache on subsequent visits)", async () => {
    const photos = makePhotos(3);
    render(
      <PhotoLightbox
        photos={photos}
        initialIndex={0}
        open={true}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(getAttachmentViewUrl).toHaveBeenCalledWith("p-1"),
    );

    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(getAttachmentViewUrl).toHaveBeenCalledWith("p-2"),
    );

    // Go back to photo 1 — should NOT re-fetch since URL is cached.
    vi.mocked(getAttachmentViewUrl).mockClear();
    await user.keyboard("{ArrowLeft}");
    // No new call to getAttachmentViewUrl for p-1 (its URL is still cached).
    expect(getAttachmentViewUrl).not.toHaveBeenCalledWith("p-1");
  });
});
