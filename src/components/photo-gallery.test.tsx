// Tests for PhotoGallery — Phase 12a.
//
// Mocks @/app/(app)/attachments/actions so the upload + delete + fetch chain
// can be asserted without R2 / DB. Uses fireEvent.change on the file
// input to bypass the accept= filter on bad MIME types (jsdom + RTL
// silently drops disallowed files via userEvent.upload).

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/(app)/attachments/actions", () => ({
  getPhotosForEntity: vi.fn(),
  getAttachmentViewUrl: vi.fn(),
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  softDeleteAttachment: vi.fn(),
}));

import {
  confirmUpload,
  getAttachmentViewUrl,
  getPhotosForEntity,
  prepareUpload,
  softDeleteAttachment,
  type PhotoForClient,
} from "@/app/(app)/attachments/actions";

import { PhotoGallery } from "./photo-gallery";

// --- XHR stub: the R2 PUT round-trip ---
class StubXHR {
  static failNext = false;
  upload = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  open(_: string, __: string, ___: boolean) {}
  setRequestHeader(_: string, __: string) {}
  send() {
    setTimeout(() => {
      if (StubXHR.failNext) {
        StubXHR.failNext = false;
        this.onerror?.();
      } else {
        this.onload?.();
      }
    }, 0);
  }
}

function makeFile(name: string, type: string, sizeBytes = 100): File {
  const content = "x".repeat(sizeBytes);
  return new File([content], name, { type });
}

function makePhoto(overrides: Partial<PhotoForClient> = {}): PhotoForClient {
  return {
    id: "photo-1",
    originalFilename: "test.png",
    mimeType: "image/png",
    sizeBytes: 100,
    uploadedAt: new Date("2026-05-17T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  StubXHR.failNext = false;
  vi.stubGlobal("XMLHttpRequest", StubXHR);
  vi.stubGlobal(
    "URL",
    Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => "blob:test://x"),
      revokeObjectURL: vi.fn(),
    }),
  );

  vi.mocked(getPhotosForEntity).mockResolvedValue({ ok: true, photos: [] });
  vi.mocked(getAttachmentViewUrl).mockResolvedValue({
    ok: true,
    url: "https://signed.example/thumb",
  });
  vi.mocked(prepareUpload).mockResolvedValue({
    ok: true,
    attachmentId: "new-bill",
    presignedUrl: "https://signed.example/put",
  });
  vi.mocked(confirmUpload).mockResolvedValue({
    ok: true,
    bill: {} as never,
  });
  vi.mocked(softDeleteAttachment).mockResolvedValue({ ok: true });

  cleanup();
});

// =====================================================================
// View mode — read-only rendering
// =====================================================================

describe("PhotoGallery — view mode", () => {
  it("renders nothing when there are no photos", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({ ok: true, photos: [] });
    const { container } = render(
      <PhotoGallery mode="view" entityType="PURCHASE_PHOTO" entityId="p-1" />,
    );
    await waitFor(() => {
      expect(getPhotosForEntity).toHaveBeenCalledOnce();
    });
    expect(container.querySelector('[data-testid="photo-gallery"]')).toBeNull();
  });

  it("renders thumbnail tiles for each photo", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({
      ok: true,
      photos: [
        makePhoto({ id: "p-1" }),
        makePhoto({ id: "p-2" }),
        makePhoto({ id: "p-3" }),
      ],
    });
    render(
      <PhotoGallery mode="view" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("photo-tile-p-1")).toBeInTheDocument();
      expect(screen.getByTestId("photo-tile-p-2")).toBeInTheDocument();
      expect(screen.getByTestId("photo-tile-p-3")).toBeInTheDocument();
    });
  });

  it("does NOT render an 'Add photo' tile in view mode", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({
      ok: true,
      photos: [makePhoto()],
    });
    render(
      <PhotoGallery mode="view" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-tile-photo-1"));
    expect(screen.queryByTestId("photo-add-tile")).toBeNull();
  });

  it("does NOT render delete buttons in view mode", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({
      ok: true,
      photos: [makePhoto()],
    });
    render(
      <PhotoGallery mode="view" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-tile-photo-1"));
    expect(screen.queryByLabelText(/^Delete /)).toBeNull();
  });

  it("uses initialPhotos prop without making a fetch round-trip", async () => {
    render(
      <PhotoGallery
        mode="view"
        entityType="PURCHASE_PHOTO"
        entityId="p-X"
        initialPhotos={[makePhoto({ id: "preload" })]}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("photo-tile-preload")).toBeInTheDocument();
    });
    expect(getPhotosForEntity).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Edit mode — uploads + delete
// =====================================================================

describe("PhotoGallery — edit mode", () => {
  it("renders the 'Add photo' tile in edit mode even when empty", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({ ok: true, photos: [] });
    render(
      <PhotoGallery mode="edit" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-add-tile"));
    expect(screen.getByLabelText(/add photo/i)).toBeInTheDocument();
  });

  it("upload chain: prepareUpload → R2 PUT → confirmUpload (per file)", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({ ok: true, photos: [] });
    const { container } = render(
      <PhotoGallery mode="edit" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-add-tile"));

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const files = [
      makeFile("a.png", "image/png", 100),
      makeFile("b.png", "image/png", 200),
    ];
    await act(async () => {
      fireEvent.change(fileInput, { target: { files } });
      // Let the upload loop run its setTimeout-driven XHR + microtasks.
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(prepareUpload).toHaveBeenCalledTimes(2);
    expect(confirmUpload).toHaveBeenCalledTimes(2);
    // Each prepareUpload uses the PURCHASE_PHOTO discriminator + entityId.
    expect(vi.mocked(prepareUpload).mock.calls[0][0]).toMatchObject({
      attachedToType: "PURCHASE_PHOTO",
      attachedToId: "p-X",
    });
  });

  it("rejects non-image MIME at picker layer (no prepareUpload call)", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({ ok: true, photos: [] });
    const { container } = render(
      <PhotoGallery mode="edit" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-add-tile"));

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    // application/pdf is allowed for bills but not photos.
    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [makeFile("doc.pdf", "application/pdf", 50)] },
      });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(prepareUpload).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unsupported/i);
  });

  it("rejects oversized files (no prepareUpload call)", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({ ok: true, photos: [] });
    const { container } = render(
      <PhotoGallery mode="edit" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-add-tile"));

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const oversized = makeFile("huge.png", "image/png", 11 * 1024 * 1024);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [oversized] } });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(prepareUpload).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/too large/i);
  });

  it("delete button invokes softDeleteBill with the photo id", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({
      ok: true,
      photos: [makePhoto({ id: "deleteme" })],
    });
    render(
      <PhotoGallery mode="edit" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-tile-deleteme"));

    const deleteBtn = screen.getByLabelText(/^Delete test.png/);
    const user = userEvent.setup();
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(softDeleteAttachment).toHaveBeenCalledWith({ attachmentId: "deleteme" });
    });
  });

  it("after upload/delete, reloads the photo list via getPhotosForEntity", async () => {
    // First load: empty.
    vi.mocked(getPhotosForEntity)
      .mockResolvedValueOnce({ ok: true, photos: [] })
      // After upload, list has 1.
      .mockResolvedValueOnce({
        ok: true,
        photos: [makePhoto({ id: "fresh" })],
      });

    const { container } = render(
      <PhotoGallery mode="edit" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-add-tile"));

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [makeFile("a.png", "image/png", 50)] },
      });
      await new Promise((r) => setTimeout(r, 50));
    });

    await waitFor(() => {
      expect(getPhotosForEntity).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("photo-tile-fresh")).toBeInTheDocument();
    });
  });

  it("surfaces a per-file failure without halting the batch", async () => {
    vi.mocked(getPhotosForEntity).mockResolvedValueOnce({ ok: true, photos: [] });
    vi.mocked(prepareUpload)
      .mockResolvedValueOnce({
        ok: false,
        errors: { mimeType: ["bad"] } as never,
      })
      .mockResolvedValueOnce({
        ok: true,
        attachmentId: "ok-id",
        presignedUrl: "https://signed.example/put",
      });

    const { container } = render(
      <PhotoGallery mode="edit" entityType="PURCHASE_PHOTO" entityId="p-X" />,
    );
    await waitFor(() => screen.getByTestId("photo-add-tile"));

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, {
        target: {
          files: [
            makeFile("bad.png", "image/png", 50),
            makeFile("good.png", "image/png", 60),
          ],
        },
      });
      await new Promise((r) => setTimeout(r, 100));
    });

    // Both prepareUploads tried; second succeeded.
    expect(prepareUpload).toHaveBeenCalledTimes(2);
    expect(confirmUpload).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent(/bad.png/);
  });
});
