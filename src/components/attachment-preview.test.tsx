// Tests for AttachmentPreview — browser-side file preview via
// URL.createObjectURL. Mocks the blob-URL APIs so tests run cleanly
// under jsdom (which doesn't implement them by default).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { AttachmentPreview } from "./attachment-preview";

const URL_PREFIX = "blob:test://";

beforeEach(() => {
  vi.clearAllMocks();
  // Stub the blob URL APIs. jsdom defines URL but not the static
  // methods, so we assign onto the global.
  let counter = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => `${URL_PREFIX}${++counter}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});

function makeFile(name: string, type: string, contents = "test"): File {
  return new File([contents], name, { type });
}

describe("BillPreview — image MIME types", () => {
  it("renders an <img> with the blob URL for image/png", () => {
    const file = makeFile("receipt.png", "image/png");
    render(<AttachmentPreview file={file} />);

    const img = screen.getByAltText(/preview of receipt.png/i) as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.src).toMatch(/^blob:test:\/\//);
  });

  it("renders an <img> for image/jpeg", () => {
    const file = makeFile("photo.jpg", "image/jpeg");
    render(<AttachmentPreview file={file} />);
    expect(screen.getByAltText(/preview of photo.jpg/i).tagName).toBe("IMG");
  });

  it("renders an <img> for image/webp", () => {
    const file = makeFile("tag.webp", "image/webp");
    render(<AttachmentPreview file={file} />);
    expect(screen.getByAltText(/preview of tag.webp/i).tagName).toBe("IMG");
  });
});

describe("BillPreview — PDF MIME type", () => {
  it("renders an <embed> for application/pdf", () => {
    const file = makeFile("invoice.pdf", "application/pdf");
    const { container } = render(<AttachmentPreview file={file} />);

    const embed = container.querySelector("embed");
    expect(embed).not.toBeNull();
    expect(embed?.getAttribute("type")).toBe("application/pdf");
    expect(embed?.getAttribute("src")).toMatch(/^blob:test:\/\//);
  });

  it("does NOT render an <img> for PDF (cross-MIME isolation)", () => {
    const file = makeFile("invoice.pdf", "application/pdf");
    render(<AttachmentPreview file={file} />);
    expect(screen.queryByAltText(/preview of/i)).toBeNull();
  });
});

describe("BillPreview — unsupported types", () => {
  it("renders a fallback message for non-image, non-PDF MIME types", () => {
    const file = makeFile("doc.txt", "text/plain");
    render(<AttachmentPreview file={file} />);
    expect(screen.getByText(/no preview available/i)).toBeInTheDocument();
  });

  it("does NOT render an <img> or <embed> for unsupported types", () => {
    const file = makeFile("doc.txt", "text/plain");
    const { container } = render(<AttachmentPreview file={file} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("embed")).toBeNull();
  });
});

describe("BillPreview — blob-URL lifecycle", () => {
  it("calls URL.createObjectURL once on mount with the file", () => {
    const file = makeFile("x.png", "image/png");
    render(<AttachmentPreview file={file} />);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it("calls URL.revokeObjectURL on unmount (prevents blob-URL pool leak)", () => {
    const file = makeFile("x.png", "image/png");
    const { unmount } = render(<AttachmentPreview file={file} />);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("revokes the old URL and creates a new one when the file prop changes", () => {
    const fileA = makeFile("a.png", "image/png");
    const fileB = makeFile("b.png", "image/png");
    const { rerender } = render(<AttachmentPreview file={fileA} />);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    rerender(<AttachmentPreview file={fileB} />);
    // Old URL revoked, new URL created.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenLastCalledWith(fileB);
  });
});

describe("BillPreview — accessibility", () => {
  it("includes the filename in the image alt text", () => {
    const file = makeFile("specific-receipt-2026.png", "image/png");
    render(<AttachmentPreview file={file} />);
    expect(
      screen.getByAltText(/specific-receipt-2026\.png/i),
    ).toBeInTheDocument();
  });

  it("includes the filename in the PDF embed aria-label", () => {
    const file = makeFile("Q1-invoice.pdf", "application/pdf");
    const { container } = render(<AttachmentPreview file={file} />);
    const embed = container.querySelector("embed");
    expect(embed?.getAttribute("aria-label")).toMatch(/q1-invoice\.pdf/i);
  });

  it("exposes a data-testid for ergonomic Playwright targeting", () => {
    const file = makeFile("x.png", "image/png");
    render(<AttachmentPreview file={file} />);
    expect(screen.getByTestId("bill-preview")).toBeInTheDocument();
  });
});
