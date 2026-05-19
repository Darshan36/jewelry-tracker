// Smoke tests for SaleForm — the form's internal logic (RHF validation,
// useFieldArray, live subtotal/total math) was extensively covered by
// the Phase 7 sale-form-modal.test.tsx suite (deleted in the Phase 10
// build). These tests verify the standalone component renders cleanly
// and dispatches create / update correctly based on `mode`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
}));
// Phase 10.5: SaleForm now imports prepareUpload/confirmUpload for the
// inline bill section. Phase 12c: PhotoGallery (edit mode) self-loads
// via getPhotosForEntity + lazy-loads thumbnail URLs via
// getAttachmentViewUrl. softDeleteAttachment fires on per-thumb delete.
// Mock the entire actions module so the test doesn't pull next-auth's
// runtime into the jsdom environment.
vi.mock("@/app/(app)/attachments/actions", () => ({
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  getPhotosForEntity: vi.fn(async () => ({ ok: true, photos: [] })),
  getAttachmentViewUrl: vi.fn(async () => ({ ok: true, url: "blob:fake" })),
  softDeleteAttachment: vi.fn(),
}));

import { createSale, updateSale } from "./actions";
import { confirmUpload, prepareUpload } from "@/app/(app)/attachments/actions";

import { SaleForm } from "./sale-form";

// XHR stub for the browser-side R2 PUT inside SaleForm.onSubmit.
class StubXHR {
  static failNext = false;
  upload = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  open(_: string, __: string, ___: boolean) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setRequestHeader(_: string, __: string) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(_: unknown) {
    queueMicrotask(() => {
      if (StubXHR.failNext) {
        StubXHR.failNext = false;
        if (this.onerror) this.onerror();
      } else if (this.onload) {
        this.status = 200;
        this.onload();
      }
    });
  }
}

const parties = [
  { id: "cust-1", name: "Existing Customer", phone: "9999999999" },
];

beforeEach(() => {
  vi.clearAllMocks();
  StubXHR.failNext = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal("XMLHttpRequest", StubXHR as unknown as any);
  let counter = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(globalThis.URL, {
      createObjectURL: vi.fn(() => `blob:test://${++counter}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});

function makeFile(name: string, type: string): File {
  return new File(["bytes"], name, { type });
}

describe("SaleForm — create mode", () => {
  it("renders with default empty values and one empty line item", () => {
    render(<SaleForm mode="create" parties={parties} />);
    expect(screen.getByRole("group", { name: /^Line 1$/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Line 2$/i })).not.toBeInTheDocument();
  });

  it("renders the SaveDropdown split button", () => {
    render(<SaleForm mode="create" parties={parties} />);
    expect(
      screen.getByRole("button", { name: /save and return/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /more save options/i }),
    ).toBeInTheDocument();
  });

  it("renders a Cancel button that's not the form submit", () => {
    render(<SaleForm mode="create" parties={parties} />);
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancel.getAttribute("type")).toBe("button");
  });

  it("dispatches createSale on Save and return", async () => {
    const user = userEvent.setup();
    vi.mocked(createSale).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: { id: "new-sale", partyId: null } as any,
    });

    render(<SaleForm mode="create" parties={parties} />);

    // Fill the minimum required fields.
    await user.type(document.querySelector("#sales-party-name") as HTMLInputElement, "Walk-in");
    await user.type(document.querySelector("#sale-line-0-item") as HTMLInputElement, "Test");
    await user.type(document.querySelector("#sale-line-0-rate") as HTMLInputElement, "100");

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(createSale).toHaveBeenCalledOnce();
    });
    expect(updateSale).not.toHaveBeenCalled();
  });
});

describe("SaleForm — edit mode", () => {
  const existingSale = {
    id: "sale-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: "cust-1",
    partyName: "Existing Customer",
    partyPhone: "9999999999",
    discount: 5000, // ₹50 in paise
    total: 95000, // ₹950 in paise
    notes: "Test note",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lineItems: [
      {
        id: "li-1",
        saleId: "sale-1",
        itemDescription: "Existing item",
        qty: 2,
        rate: 50000, // ₹500/unit in paise
        createdAt: new Date(),
      },
    ],
    paidAmount: 0,
    returnTotal: 0,
    status: "pending" as const,
    payments: [],
    returns: [],
  };

  it("prefills line-item values from the sale prop (rates converted paise → rupees)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<SaleForm mode="edit" sale={existingSale as any} parties={parties} />);

    // SaleForm seeds defaults inside a useEffect after first render,
    // so wait for the rate input to receive the prefilled rupee value.
    // (sales-party-name is driven through PartyPicker's controlled
    // `value` prop which doesn't flow cleanly under jsdom for the
    // assertion; the Playwright walkthrough Step 5 covers the
    // party-name prefill at integration scale.)
    await vi.waitFor(() => {
      const lineRate = document.querySelector("#sale-line-0-rate") as HTMLInputElement | null;
      expect(lineRate?.value).toBe("500");
    });

    const lineItem = document.querySelector("#sale-line-0-item") as HTMLInputElement;
    expect(lineItem.value).toBe("Existing item");
    const lineQty = document.querySelector("#sale-line-0-qty") as HTMLInputElement;
    expect(lineQty.value).toBe("2");
    // Discount paise → rupees (5000 → 50).
    const discount = document.querySelector("#sale-discount") as HTMLInputElement;
    expect(discount.value).toBe("50");
  });

  it("dispatches updateSale (not createSale) on save", async () => {
    const user = userEvent.setup();
    vi.mocked(updateSale).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: { id: "sale-1", partyId: "cust-1" } as any,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<SaleForm mode="edit" sale={existingSale as any} parties={parties} />);

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(updateSale).toHaveBeenCalledOnce();
    });
    expect(createSale).not.toHaveBeenCalled();
    // The first arg is the sale id.
    expect(vi.mocked(updateSale).mock.calls[0][0]).toBe("sale-1");
  });
});

// =====================================================================
// Phase 10.5 bill-in-form retrofit
// =====================================================================

describe("SaleForm — bill-in-form retrofit (Phase 10.5)", () => {
  function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    return (async () => {
      await user.type(
        document.querySelector("#sales-party-name") as HTMLInputElement,
        "Walk-in",
      );
      await user.type(
        document.querySelector("#sale-line-0-item") as HTMLInputElement,
        "Test",
      );
      await user.type(
        document.querySelector("#sale-line-0-rate") as HTMLInputElement,
        "100",
      );
    })();
  }

  function getFileInput(): HTMLInputElement {
    // The inline bill section's file input — narrow by accept attribute
    // since SaleForm only has one type=file input.
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("renders the inline 'Attach bill (optional)' section", () => {
    render(<SaleForm mode="create" parties={parties} />);
    expect(screen.getByText(/attach bill \(optional\)/i)).toBeInTheDocument();
    expect(getFileInput()).toBeInTheDocument();
  });

  it("picking a valid file shows the filename + Remove button", async () => {
    const user = userEvent.setup();
    render(<SaleForm mode="create" parties={parties} />);

    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));

    expect(screen.getByText(/receipt\.png/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
  });

  it("clicking Remove clears the picked file", async () => {
    const user = userEvent.setup();
    render(<SaleForm mode="create" parties={parties} />);

    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    expect(screen.getByText(/receipt\.png/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(screen.queryByText(/receipt\.png/)).not.toBeInTheDocument();
  });

  it("rejects unsupported MIME types client-side without calling prepareUpload", async () => {
    render(<SaleForm mode="create" parties={parties} />);

    // userEvent.upload respects accept= and would silently drop the file;
    // bypass via fireEvent.change to simulate a stale-MIME-bypass attempt.
    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("doc.txt", "text/plain")] },
    });

    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("on successful save+upload: runs createSale → prepareUpload → confirmUpload, then navigates", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    vi.mocked(createSale).mockImplementation(async () => {
      callOrder.push("createSale");
      return {
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sale: { id: "new-sale-id", partyId: null } as any,
      };
    });
    vi.mocked(prepareUpload).mockImplementation(async () => {
      callOrder.push("prepareUpload");
      return {
        ok: true as const,
        attachmentId: "bill-id",
        presignedUrl: "https://signed.example/put",
      };
    });
    vi.mocked(confirmUpload).mockImplementation(async () => {
      callOrder.push("confirmUpload");
      return {
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bill: { id: "bill-id", status: "READY" } as any,
      };
    });

    render(<SaleForm mode="create" parties={parties} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(callOrder).toEqual(["createSale", "prepareUpload", "confirmUpload"]);
    });
    // prepareUpload was called with the right discriminator + saved id.
    const prepArg = vi.mocked(prepareUpload).mock.calls[0][0];
    expect(prepArg.attachedToType).toBe("SALE");
    expect(prepArg.attachedToId).toBe("new-sale-id");
    // Navigation to /sales happens after the upload chain.
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith("/sales"));
  });

  it("saves without firing upload chain when no file is picked", async () => {
    const user = userEvent.setup();
    vi.mocked(createSale).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: { id: "new-sale", partyId: null } as any,
    });

    render(<SaleForm mode="create" parties={parties} />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    expect(prepareUpload).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
  });

  it("on upload failure: sale stays saved, error banner appears, NO navigation", async () => {
    const user = userEvent.setup();
    vi.mocked(createSale).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: { id: "new-sale-id", partyId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: false as const,
      errors: { mimeType: ["Unsupported file type."] },
    });

    render(<SaleForm mode="create" parties={parties} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    // createSale fires (sale saved), prepareUpload fires (and fails),
    // confirmUpload does NOT fire, and no navigation happens.
    await vi.waitFor(() => expect(prepareUpload).toHaveBeenCalledOnce());
    expect(createSale).toHaveBeenCalledOnce();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    // Surfaces the "sale saved but bill upload failed" copy.
    expect(
      await screen.findByText(/sale saved, but bill upload failed/i),
    ).toBeInTheDocument();
  });

  it("R2 PUT network failure halts the chain at confirmUpload", async () => {
    const user = userEvent.setup();
    vi.mocked(createSale).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: { id: "new-sale-id", partyId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: true as const,
      attachmentId: "bill-id",
      presignedUrl: "https://signed.example/put",
    });
    StubXHR.failNext = true;

    render(<SaleForm mode="create" parties={parties} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/sale saved, but bill upload failed/i),
      ).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Mobile viewport — Phase 11.2.
// =====================================================================
//
// JSDOM doesn't evaluate CSS media queries, so the form's responsive
// `md:contents` + `hidden md:grid` classes don't actually toggle
// layout at the visual level. These tests verify the regression-relevant
// class strings exist on the right elements so a future refactor can't
// silently remove them. Visual layout regression detection requires
// DevTools 390x844 walkthrough (see TESTING.md "Visual viewport
// verification limitations").

describe("SaleForm — mobile viewport (responsive class regression coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("desktop column-header row carries `hidden md:grid` (mobile hides it)", () => {
    render(<SaleForm mode="create" parties={parties} />);

    // The header row's Description label is unique enough to scope.
    const descriptionHeader = screen.getAllByText("Description")[0];
    // Walk up to the row container.
    const headerRow = descriptionHeader.parentElement!;
    expect(headerRow.className).toContain("hidden");
    expect(headerRow.className).toContain("md:grid");
  });

  it("line item rows use `grid-cols-1 md:grid-cols-[...]` so they stack on mobile", () => {
    render(<SaleForm mode="create" parties={parties} />);

    const lineGroup = screen.getByRole("group", { name: /line 1/i });
    expect(lineGroup.className).toContain("grid-cols-1");
    expect(lineGroup.className).toContain("md:grid-cols-[1fr_80px_120px_120px_40px]");
  });

  it("qty/rate/× inner group uses `md:contents` to flatten into the desktop grid", () => {
    render(<SaleForm mode="create" parties={parties} />);

    // Qty input → its parent <div> → its parent (the inner sub-grid).
    const qtyInput = screen.getByPlaceholderText("Qty");
    const qtyWrapper = qtyInput.parentElement!;
    const innerGroup = qtyWrapper.parentElement!;

    expect(innerGroup.className).toContain("grid-cols-[1fr_1fr_44px]");
    expect(innerGroup.className).toContain("md:contents");
  });

  it("qty + rate inputs have mobile placeholders (Qty, Rate ₹)", () => {
    render(<SaleForm mode="create" parties={parties} />);

    expect(screen.getByPlaceholderText("Qty")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Rate ₹")).toBeInTheDocument();
  });

  it("remove button has 44x44 mobile touch target (h-11 w-11)", () => {
    render(<SaleForm mode="create" parties={parties} />);

    const removeBtn = screen.getByRole("button", { name: /remove line 1/i });
    expect(removeBtn.className).toContain("h-11");
    expect(removeBtn.className).toContain("w-11");
  });

  it("mobile-only line total row is rendered with `md:hidden`", () => {
    render(<SaleForm mode="create" parties={parties} />);

    // The "Line total" label appears in two places: the desktop header row
    // (hidden on mobile via `hidden md:grid`) and the mobile-only line
    // total inside each line item row (visible on mobile via `md:hidden`).
    // The latter is what we're checking here.
    const labels = screen.getAllByText("Line total");
    // At least one is the mobile per-row label (md:hidden wrapper).
    const mobileLabel = labels.find((el) =>
      el.parentElement?.className.includes("md:hidden"),
    );
    expect(mobileLabel).toBeDefined();
  });

  it("form footer is sticky-bottom on mobile (regression check)", () => {
    const { container } = render(<SaleForm mode="create" parties={parties} />);

    // Footer is identified by its border-t pt-4 wrapper containing the SaveDropdown.
    const saveButton = screen.getByRole("button", { name: /save and return/i });
    // Walk up until we find the wrapper with `sticky bottom-0`.
    let el: HTMLElement | null = saveButton;
    while (el && !el.className.includes("sticky")) {
      el = el.parentElement;
    }
    expect(el).not.toBeNull();
    expect(el?.className).toContain("sticky");
    expect(el?.className).toContain("bottom-0");
    // And on desktop it's reset to static.
    expect(el?.className).toContain("md:static");
    // Defeats unused warning on container.
    void container;
  });
});

// =====================================================================
// Phase 12c — photos in form (create mode picker, edit mode gallery)
// Mirrors purchase-form.test.tsx Phase 12a photo tests.
// =====================================================================

describe("SaleForm — Phase 12c photos", () => {
  function getPhotoInput(): HTMLInputElement {
    // The photo input has `multiple` attribute — distinguishes it from
    // the bill picker (single file).
    return document.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
  }

  it("renders a 'Photos (optional)' section in create mode", () => {
    render(<SaleForm mode="create" parties={parties} />);
    expect(screen.getByText(/photos \(optional\)/i)).toBeInTheDocument();
    // The create-mode picker has a 'multiple' file input.
    expect(getPhotoInput()).toBeInTheDocument();
  });

  it("picking photos shows a preview tile per file with a Remove button", async () => {
    render(<SaleForm mode="create" parties={parties} />);
    fireEvent.change(getPhotoInput(), {
      target: {
        files: [
          makeFile("a.png", "image/png"),
          makeFile("b.png", "image/png"),
        ],
      },
    });
    expect(screen.getByTestId("pending-photo-0")).toBeInTheDocument();
    expect(screen.getByTestId("pending-photo-1")).toBeInTheDocument();
  });

  it("rejects non-image MIME types client-side", () => {
    render(<SaleForm mode="create" parties={parties} />);
    fireEvent.change(getPhotoInput(), {
      target: { files: [makeFile("doc.pdf", "application/pdf")] },
    });
    expect(screen.queryByTestId("pending-photo-0")).toBeNull();
    expect(screen.getByText(/unsupported type/i)).toBeInTheDocument();
  });

  it("removing a pending photo drops its preview tile", async () => {
    const user = userEvent.setup();
    render(<SaleForm mode="create" parties={parties} />);
    fireEvent.change(getPhotoInput(), {
      target: { files: [makeFile("a.png", "image/png")] },
    });
    expect(screen.getByTestId("pending-photo-0")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/^Remove a\.png$/i));
    expect(screen.queryByTestId("pending-photo-0")).toBeNull();
  });

  it("on save: runs createSale, then prepareUpload(SALE_PHOTO) for each pending photo", async () => {
    const user = userEvent.setup();
    vi.mocked(createSale).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: { id: "sale-77", partyId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: true as const,
      attachmentId: "bill-x",
      presignedUrl: "https://signed.example/put",
    });
    vi.mocked(confirmUpload).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bill: { id: "bill-x" } as any,
    });

    render(<SaleForm mode="create" parties={parties} />);

    await user.type(
      document.querySelector("#sales-party-name") as HTMLInputElement,
      "Walk-in",
    );
    await user.type(
      document.querySelector("#sale-line-0-item") as HTMLInputElement,
      "Test",
    );
    await user.type(
      document.querySelector("#sale-line-0-rate") as HTMLInputElement,
      "100",
    );

    fireEvent.change(getPhotoInput(), {
      target: {
        files: [
          makeFile("p1.png", "image/png"),
          makeFile("p2.png", "image/png"),
        ],
      },
    });

    await user.click(
      screen.getByRole("button", { name: /save and return/i }),
    );

    await vi.waitFor(() => {
      expect(createSale).toHaveBeenCalledOnce();
      // Two photo prepareUpload calls + zero bill prepareUpload calls
      // (no bill file picked).
      expect(prepareUpload).toHaveBeenCalledTimes(2);
    });

    const calls = vi.mocked(prepareUpload).mock.calls;
    for (const call of calls) {
      expect(call[0]).toMatchObject({
        attachedToType: "SALE_PHOTO",
        attachedToId: "sale-77",
      });
    }
  });

  it("renders the live PhotoGallery in edit mode (instead of the create-mode picker)", async () => {
    const sale = {
      id: "sale-1",
      date: new Date("2026-05-10T00:00:00Z"),
      partyId: null,
      partyName: "Walk-in",
      partyPhone: null,
      discount: 0,
      total: 10000,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      lineItems: [
        {
          id: "li-1",
          saleId: "sale-1",
          itemDescription: "Test",
          qty: 1,
          rate: 10000,
          createdAt: new Date(),
        },
      ],
      paidAmount: 0,
      returnTotal: 0,
      status: "pending" as const,
      payments: [],
      returns: [],
      photoCount: 0,
    };
    render(
      <SaleForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sale={sale as any}
        parties={parties}
      />,
    );
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-testid="photo-gallery"][data-mode="edit"]'),
      ).toBeInTheDocument();
    });
    // The create-mode pending-photo picker is NOT rendered.
    expect(screen.queryByTestId("pending-photo-0")).toBeNull();
  });
});
