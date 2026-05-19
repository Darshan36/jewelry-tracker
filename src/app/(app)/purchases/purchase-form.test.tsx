// Smoke tests for PurchaseForm — mirror of sale-form.test.tsx scope,
// extended Phase 10.6 with bill-in-form retrofit coverage.
//
// The form's RHF + useFieldArray internals are covered by the Phase 7
// purchase-form-modal.test.tsx suite (now retired); these tests verify
// the standalone form renders cleanly, dispatches the right action
// based on `mode`, and runs the discriminator-only bill chain on save.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
}));
// Phase 10.6: PurchaseForm now imports prepareUpload/confirmUpload for
// the inline bill section. Mock the bills action module so the test
// doesn't pull next-auth's runtime into the jsdom environment.
vi.mock("@/app/(app)/attachments/actions", () => ({
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  // Phase 12a — PhotoGallery (edit mode) self-loads via getPhotosForEntity
  // and resolves a presigned URL per thumb via getAttachmentViewUrl. Stub both so
  // the edit-mode form render doesn't trip an unhandled rejection.
  getPhotosForEntity: vi.fn(async () => ({ ok: true, photos: [] })),
  getAttachmentViewUrl: vi.fn(async () => ({ ok: false, error: "stubbed" })),
  softDeleteAttachment: vi.fn(),
}));

import { createPurchase, updatePurchase } from "./actions";
import { confirmUpload, prepareUpload } from "@/app/(app)/attachments/actions";

import { PurchaseForm } from "./purchase-form";

// XHR stub for the browser-side R2 PUT inside PurchaseForm.onSubmit.
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

function makeFile(name: string, type: string): File {
  return new File(["bytes"], name, { type });
}

const suppliers = [
  { id: "sup-1", name: "Existing Supplier", phone: "9999999999" },
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

describe("PurchaseForm — create mode", () => {
  it("renders with default empty values and one empty line item", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    expect(
      screen.getByRole("group", { name: /^Line 1$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /^Line 2$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the SaveDropdown split button", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    expect(
      screen.getByRole("button", { name: /save and return/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /more save options/i }),
    ).toBeInTheDocument();
  });

  it("renders a Cancel button that's not the form submit", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancel.getAttribute("type")).toBe("button");
  });

  it("dispatches createPurchase on Save and return", async () => {
    const user = userEvent.setup();
    vi.mocked(createPurchase).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purchase: { id: "new-purchase", supplierId: null } as any,
    });

    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    await user.type(
      document.querySelector("#purchases-party-name") as HTMLInputElement,
      "Walk-in",
    );
    await user.type(
      document.querySelector("#purchase-line-0-item") as HTMLInputElement,
      "Test",
    );
    await user.type(
      document.querySelector("#purchase-line-0-rate") as HTMLInputElement,
      "100",
    );

    await user.click(
      screen.getByRole("button", { name: /save and return/i }),
    );

    await vi.waitFor(() => {
      expect(createPurchase).toHaveBeenCalledOnce();
    });
    expect(updatePurchase).not.toHaveBeenCalled();
  });
});

describe("PurchaseForm — edit mode", () => {
  const existingPurchase = {
    id: "purchase-1",
    date: new Date("2026-05-10T00:00:00Z"),
    supplierId: "sup-1",
    partyName: "Existing Supplier",
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
        purchaseId: "purchase-1",
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

  it("prefills line-item values from the purchase prop (rates converted paise → rupees)", async () => {
    render(
      <PurchaseForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        purchase={existingPurchase as any}
        suppliers={suppliers}
      />,
    );

    await vi.waitFor(() => {
      const lineRate = document.querySelector(
        "#purchase-line-0-rate",
      ) as HTMLInputElement | null;
      expect(lineRate?.value).toBe("500");
    });

    const lineItem = document.querySelector(
      "#purchase-line-0-item",
    ) as HTMLInputElement;
    expect(lineItem.value).toBe("Existing item");
    const lineQty = document.querySelector(
      "#purchase-line-0-qty",
    ) as HTMLInputElement;
    expect(lineQty.value).toBe("2");
    const discount = document.querySelector(
      "#purchase-discount",
    ) as HTMLInputElement;
    expect(discount.value).toBe("50");
  });

  it("dispatches updatePurchase (not createPurchase) on save", async () => {
    const user = userEvent.setup();
    vi.mocked(updatePurchase).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purchase: { id: "purchase-1", supplierId: "sup-1" } as any,
    });
    render(
      <PurchaseForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        purchase={existingPurchase as any}
        suppliers={suppliers}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /save and return/i }),
    );

    await vi.waitFor(() => {
      expect(updatePurchase).toHaveBeenCalledOnce();
    });
    expect(createPurchase).not.toHaveBeenCalled();
    expect(vi.mocked(updatePurchase).mock.calls[0][0]).toBe("purchase-1");
  });
});

// =====================================================================
// Phase 10.6 bill-in-form retrofit — Purchases uses discriminator-only
// =====================================================================

describe("PurchaseForm — bill-in-form retrofit (Phase 10.6)", () => {
  function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    return (async () => {
      await user.type(
        document.querySelector("#purchases-party-name") as HTMLInputElement,
        "Walk-in",
      );
      await user.type(
        document.querySelector("#purchase-line-0-item") as HTMLInputElement,
        "Test",
      );
      await user.type(
        document.querySelector("#purchase-line-0-rate") as HTMLInputElement,
        "100",
      );
    })();
  }

  function getFileInput(): HTMLInputElement {
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("renders the inline 'Attach bill (optional)' section", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    expect(screen.getByText(/attach bill \(optional\)/i)).toBeInTheDocument();
    expect(getFileInput()).toBeInTheDocument();
  });

  it("picking a valid file shows the filename + Remove button", async () => {
    const user = userEvent.setup();
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));

    expect(screen.getByText(/receipt\.png/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
  });

  it("rejects unsupported MIME types client-side without calling prepareUpload", async () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("doc.txt", "text/plain")] },
    });

    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("on successful save+upload: runs createPurchase → prepareUpload(PURCHASE) → confirmUpload, then navigates (NO attach call — discriminator only)", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    vi.mocked(createPurchase).mockImplementation(async () => {
      callOrder.push("createPurchase");
      return {
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        purchase: { id: "new-purchase-id", supplierId: null } as any,
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

    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(callOrder).toEqual([
        "createPurchase",
        "prepareUpload",
        "confirmUpload",
      ]);
    });
    // prepareUpload called with the right discriminator + saved id.
    const prepArg = vi.mocked(prepareUpload).mock.calls[0][0];
    expect(prepArg.attachedToType).toBe("PURCHASE");
    expect(prepArg.attachedToId).toBe("new-purchase-id");
    // Navigation to /purchases happens after the upload chain.
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith("/purchases"));
  });

  it("saves without firing upload chain when no file is picked", async () => {
    const user = userEvent.setup();
    vi.mocked(createPurchase).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purchase: { id: "new-purchase", supplierId: null } as any,
    });

    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => expect(createPurchase).toHaveBeenCalledOnce());
    expect(prepareUpload).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
  });

  it("on upload failure: purchase stays saved, error banner appears, NO navigation", async () => {
    const user = userEvent.setup();
    vi.mocked(createPurchase).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purchase: { id: "new-purchase-id", supplierId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: false as const,
      errors: { mimeType: ["Unsupported file type."] },
    });

    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => expect(prepareUpload).toHaveBeenCalledOnce());
    expect(createPurchase).toHaveBeenCalledOnce();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/purchase saved, but bill upload failed/i),
    ).toBeInTheDocument();
  });

  it("R2 PUT network failure halts the chain before confirmUpload", async () => {
    const user = userEvent.setup();
    vi.mocked(createPurchase).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purchase: { id: "new-purchase-id", supplierId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: true as const,
      attachmentId: "bill-id",
      presignedUrl: "https://signed.example/put",
    });
    StubXHR.failNext = true;

    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/purchase saved, but bill upload failed/i),
      ).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Mobile viewport — Phase 11.2.
// =====================================================================

describe("PurchaseForm — mobile viewport (responsive class regression coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("desktop column-header row carries `hidden md:grid`", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    const descriptionHeader = screen.getAllByText("Description")[0];
    const headerRow = descriptionHeader.parentElement!;
    expect(headerRow.className).toContain("hidden");
    expect(headerRow.className).toContain("md:grid");
  });

  it("line item rows use `grid-cols-1 md:grid-cols-[...]`", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    const lineGroup = screen.getByRole("group", { name: /line 1/i });
    expect(lineGroup.className).toContain("grid-cols-1");
    expect(lineGroup.className).toContain("md:grid-cols-[1fr_80px_120px_120px_40px]");
  });

  it("qty/rate/× inner group uses `md:contents`", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    const qtyInput = screen.getByPlaceholderText("Qty");
    const innerGroup = qtyInput.parentElement!.parentElement!;

    expect(innerGroup.className).toContain("grid-cols-[1fr_1fr_44px]");
    expect(innerGroup.className).toContain("md:contents");
  });

  it("qty + rate inputs have mobile placeholders", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    expect(screen.getByPlaceholderText("Qty")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Rate ₹")).toBeInTheDocument();
  });

  it("remove button has 44x44 mobile touch target", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    const removeBtn = screen.getByRole("button", { name: /remove line 1/i });
    expect(removeBtn.className).toContain("h-11");
    expect(removeBtn.className).toContain("w-11");
  });

  it("mobile-only line total row is rendered with `md:hidden`", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    const labels = screen.getAllByText("Line total");
    const mobileLabel = labels.find((el) =>
      el.parentElement?.className.includes("md:hidden"),
    );
    expect(mobileLabel).toBeDefined();
  });

  it("form footer is sticky-bottom on mobile", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    const saveButton = screen.getByRole("button", { name: /save and return/i });
    let el: HTMLElement | null = saveButton;
    while (el && !el.className.includes("sticky")) {
      el = el.parentElement;
    }
    expect(el).not.toBeNull();
    expect(el?.className).toContain("sticky");
    expect(el?.className).toContain("bottom-0");
    expect(el?.className).toContain("md:static");
  });
});

// =====================================================================
// Phase 12a — photos in form (create mode picker, edit mode gallery)
// =====================================================================

describe("PurchaseForm — Phase 12a photos", () => {
  function getPhotoInput(): HTMLInputElement {
    // The photo input has `multiple` attribute — distinguishes it from
    // the bill picker (single file).
    return document.querySelector(
      'input[type="file"][multiple]',
    ) as HTMLInputElement;
  }

  it("renders a 'Photos (optional)' section in create mode", () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    expect(screen.getByText(/photos \(optional\)/i)).toBeInTheDocument();
    // The create-mode picker has a 'multiple' file input.
    expect(getPhotoInput()).toBeInTheDocument();
  });

  it("picking photos shows a preview tile per file with a Remove button", async () => {
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
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
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    fireEvent.change(getPhotoInput(), {
      target: { files: [makeFile("doc.pdf", "application/pdf")] },
    });
    expect(screen.queryByTestId("pending-photo-0")).toBeNull();
    expect(screen.getByText(/unsupported type/i)).toBeInTheDocument();
  });

  it("removing a pending photo drops its preview tile", async () => {
    const user = userEvent.setup();
    render(<PurchaseForm mode="create" suppliers={suppliers} />);
    fireEvent.change(getPhotoInput(), {
      target: { files: [makeFile("a.png", "image/png")] },
    });
    expect(screen.getByTestId("pending-photo-0")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/^Remove a\.png$/i));
    expect(screen.queryByTestId("pending-photo-0")).toBeNull();
  });

  it("on save: runs createPurchase, then prepareUpload(PURCHASE_PHOTO) for each pending photo", async () => {
    const user = userEvent.setup();
    vi.mocked(createPurchase).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      purchase: { id: "purchase-77", supplierId: null } as any,
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

    render(<PurchaseForm mode="create" suppliers={suppliers} />);

    await user.type(
      document.querySelector("#purchases-party-name") as HTMLInputElement,
      "Walk-in",
    );
    await user.type(
      document.querySelector("#purchase-line-0-item") as HTMLInputElement,
      "Test",
    );
    await user.type(
      document.querySelector("#purchase-line-0-rate") as HTMLInputElement,
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
      expect(createPurchase).toHaveBeenCalledOnce();
      // Two photo prepareUpload calls + zero bill prepareUpload calls
      // (no bill file picked).
      expect(prepareUpload).toHaveBeenCalledTimes(2);
    });

    const calls = vi.mocked(prepareUpload).mock.calls;
    for (const call of calls) {
      expect(call[0]).toMatchObject({
        attachedToType: "PURCHASE_PHOTO",
        attachedToId: "purchase-77",
      });
    }
  });

  it("renders the live PhotoGallery in edit mode (instead of the create-mode picker)", async () => {
    const purchase = {
      id: "purchase-1",
      date: new Date("2026-05-10T00:00:00Z"),
      supplierId: null,
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
          purchaseId: "purchase-1",
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
      <PurchaseForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        purchase={purchase as any}
        suppliers={suppliers}
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
