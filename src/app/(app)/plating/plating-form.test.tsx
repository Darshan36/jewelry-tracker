// Smoke tests for PlatingForm — Phase 10.6 mirror of sale-form.test.tsx
// adapted for plating-specific shape: weight inputs (Decimal, step="0.001"),
// vendor picker (#plating-party-name), FK-based bill attach via
// attachBillToPlatingEntry AFTER confirmUpload.
//
// The form's RHF + useFieldArray internals are covered by the Phase 7
// plating-form-modal.test.tsx suite (now retired); these tests verify
// the standalone form renders cleanly and dispatches the right action
// based on `mode`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createPlatingEntry: vi.fn(),
  updatePlatingEntry: vi.fn(),
  attachBillToPlatingEntry: vi.fn(),
}));
// Phase 10.6: PlatingForm imports prepareUpload/confirmUpload for the
// inline bill section. Mock the bills action module so the test doesn't
// pull next-auth's runtime into jsdom.
vi.mock("@/app/(app)/bills/actions", () => ({
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

import {
  attachBillToPlatingEntry,
  createPlatingEntry,
  updatePlatingEntry,
} from "./actions";
import { confirmUpload, prepareUpload } from "@/app/(app)/bills/actions";

import { PlatingForm } from "./plating-form";

// XHR stub for the browser-side R2 PUT inside PlatingForm.onSubmit.
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

const vendors = [
  { id: "vendor-1", name: "Existing Vendor", phone: "9999999999" },
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

describe("PlatingForm — create mode", () => {
  it("renders with default empty values and one empty line item", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);
    expect(screen.getByRole("group", { name: /^Line 1$/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Line 2$/i })).not.toBeInTheDocument();
  });

  it("renders weight input with step='0.001' for gram precision", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);
    const weightInput = document.querySelector(
      "#plating-line-0-weight",
    ) as HTMLInputElement;
    expect(weightInput).toBeInTheDocument();
    expect(weightInput.getAttribute("step")).toBe("0.001");
  });

  it("renders the SaveDropdown split button", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);
    expect(
      screen.getByRole("button", { name: /save and return/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /more save options/i }),
    ).toBeInTheDocument();
  });

  it("renders a Cancel button that's not the form submit", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancel.getAttribute("type")).toBe("button");
  });

  it("dispatches createPlatingEntry on Save and return", async () => {
    const user = userEvent.setup();
    vi.mocked(createPlatingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-plating", vendorId: null } as any,
    });

    render(<PlatingForm mode="create" vendors={vendors} />);

    await user.type(
      document.querySelector("#plating-party-name") as HTMLInputElement,
      "Walk-in",
    );
    await user.type(
      document.querySelector("#plating-line-0-material") as HTMLInputElement,
      "Brass",
    );
    await user.type(
      document.querySelector("#plating-line-0-weight") as HTMLInputElement,
      "2.500",
    );
    await user.type(
      document.querySelector("#plating-line-0-rate") as HTMLInputElement,
      "400",
    );

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(createPlatingEntry).toHaveBeenCalledOnce();
    });
    expect(updatePlatingEntry).not.toHaveBeenCalled();
  });
});

describe("PlatingForm — edit mode", () => {
  const existingEntry = {
    id: "plating-1",
    date: new Date("2026-05-10T00:00:00Z"),
    vendorId: "vendor-1",
    partyName: "Existing Vendor",
    partyPhone: "9999999999",
    discount: 10000, // ₹100 in paise
    total: 90000, // ₹900 in paise
    notes: "Test note",
    billId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lineItems: [
      {
        id: "li-1",
        platingEntryId: "plating-1",
        materialDescription: "Brass",
        weightKg: "2.500", // serialised as string per plating-helpers
        ratePerKg: 40000, // ₹400/kg in paise/kg
        lineTotal: 100000,
        createdAt: new Date(),
      },
    ],
    paidAmount: 0,
    status: "pending" as const,
    payments: [],
    vendor: null,
    bill: null,
  };

  it("prefills line-item values from the entry prop (weight as decimal, rate paise → rupees)", async () => {
    render(
      <PlatingForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry={existingEntry as any}
        vendors={vendors}
      />,
    );

    // PlatingForm seeds defaults inside a useEffect after first render,
    // so wait for the rate input to receive the prefilled rupee value.
    await vi.waitFor(() => {
      const lineRate = document.querySelector(
        "#plating-line-0-rate",
      ) as HTMLInputElement | null;
      expect(lineRate?.value).toBe("400");
    });

    const lineMaterial = document.querySelector(
      "#plating-line-0-material",
    ) as HTMLInputElement;
    expect(lineMaterial.value).toBe("Brass");
    const lineWeight = document.querySelector(
      "#plating-line-0-weight",
    ) as HTMLInputElement;
    expect(Number(lineWeight.value)).toBe(2.5);
    const discount = document.querySelector(
      "#plating-discount",
    ) as HTMLInputElement;
    expect(discount.value).toBe("100");
  });

  it("dispatches updatePlatingEntry (not createPlatingEntry) on save", async () => {
    const user = userEvent.setup();
    vi.mocked(updatePlatingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "plating-1", vendorId: "vendor-1" } as any,
    });
    render(
      <PlatingForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry={existingEntry as any}
        vendors={vendors}
      />,
    );

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(updatePlatingEntry).toHaveBeenCalledOnce();
    });
    expect(createPlatingEntry).not.toHaveBeenCalled();
    expect(vi.mocked(updatePlatingEntry).mock.calls[0][0]).toBe("plating-1");
  });
});

// =====================================================================
// Phase 10.6 bill-in-form retrofit — Plating uses FK-based attach
// =====================================================================

describe("PlatingForm — bill-in-form retrofit (Phase 10.6)", () => {
  function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    return (async () => {
      await user.type(
        document.querySelector("#plating-party-name") as HTMLInputElement,
        "Walk-in",
      );
      await user.type(
        document.querySelector("#plating-line-0-material") as HTMLInputElement,
        "Brass",
      );
      await user.type(
        document.querySelector("#plating-line-0-weight") as HTMLInputElement,
        "1.250",
      );
      await user.type(
        document.querySelector("#plating-line-0-rate") as HTMLInputElement,
        "100",
      );
    })();
  }

  function getFileInput(): HTMLInputElement {
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("renders the inline 'Attach bill (optional)' section", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);
    expect(screen.getByText(/attach bill \(optional\)/i)).toBeInTheDocument();
    expect(getFileInput()).toBeInTheDocument();
  });

  it("picking a valid file shows the filename + Remove button", async () => {
    const user = userEvent.setup();
    render(<PlatingForm mode="create" vendors={vendors} />);

    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));

    expect(screen.getByText(/receipt\.png/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
  });

  it("rejects unsupported MIME types client-side without calling prepareUpload", async () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("doc.txt", "text/plain")] },
    });

    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("on successful save+upload: runs createPlatingEntry → prepareUpload(PLATING_ENTRY) → confirmUpload → attachBillToPlatingEntry, in order", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    vi.mocked(createPlatingEntry).mockImplementation(async () => {
      callOrder.push("createPlatingEntry");
      return {
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { id: "new-plating-id", vendorId: null } as any,
      };
    });
    vi.mocked(prepareUpload).mockImplementation(async () => {
      callOrder.push("prepareUpload");
      return {
        ok: true as const,
        billId: "bill-id",
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
    vi.mocked(attachBillToPlatingEntry).mockImplementation(async () => {
      callOrder.push("attachBillToPlatingEntry");
      return { ok: true as const };
    });

    render(<PlatingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(callOrder).toEqual([
        "createPlatingEntry",
        "prepareUpload",
        "confirmUpload",
        "attachBillToPlatingEntry",
      ]);
    });
    // Verify the discriminator + savedEntryId flow through correctly.
    const prepArg = vi.mocked(prepareUpload).mock.calls[0][0];
    expect(prepArg.attachedToType).toBe("PLATING_ENTRY");
    expect(prepArg.attachedToId).toBe("new-plating-id");
    // FK attach gets the new entry id + the new bill id.
    expect(attachBillToPlatingEntry).toHaveBeenCalledWith(
      "new-plating-id",
      "bill-id",
    );
    // Navigation runs after the chain completes.
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith("/plating"));
  });

  it("saves without firing upload chain when no file is picked", async () => {
    const user = userEvent.setup();
    vi.mocked(createPlatingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-plating", vendorId: null } as any,
    });

    render(<PlatingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => expect(createPlatingEntry).toHaveBeenCalledOnce());
    expect(prepareUpload).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(attachBillToPlatingEntry).not.toHaveBeenCalled();
  });

  it("on upload failure: entry stays saved, error banner appears, NO navigation, NO attach call", async () => {
    const user = userEvent.setup();
    vi.mocked(createPlatingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-plating-id", vendorId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: false as const,
      errors: { mimeType: ["Unsupported file type."] },
    });

    render(<PlatingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => expect(prepareUpload).toHaveBeenCalledOnce());
    expect(createPlatingEntry).toHaveBeenCalledOnce();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(attachBillToPlatingEntry).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/plating entry saved, but bill upload failed/i),
    ).toBeInTheDocument();
  });

  it("R2 PUT network failure halts the chain before confirmUpload and attach", async () => {
    const user = userEvent.setup();
    vi.mocked(createPlatingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-plating-id", vendorId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: true as const,
      billId: "bill-id",
      presignedUrl: "https://signed.example/put",
    });
    StubXHR.failNext = true;

    render(<PlatingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/plating entry saved, but bill upload failed/i),
      ).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(attachBillToPlatingEntry).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Mobile viewport — Phase 11.2.
// =====================================================================

describe("PlatingForm — mobile viewport (responsive class regression coverage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("desktop column-header row carries `hidden md:grid`", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    const materialHeader = screen.getAllByText("Material")[0];
    const headerRow = materialHeader.parentElement!;
    expect(headerRow.className).toContain("hidden");
    expect(headerRow.className).toContain("md:grid");
  });

  it("line item rows use `grid-cols-1 md:grid-cols-[1fr_110px_130px_130px_40px]`", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    const lineGroup = screen.getByRole("group", { name: /line 1/i });
    expect(lineGroup.className).toContain("grid-cols-1");
    expect(lineGroup.className).toContain("md:grid-cols-[1fr_110px_130px_130px_40px]");
  });

  it("weight/rate/× inner group uses `md:contents`", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    const weightInput = screen.getByPlaceholderText("Weight kg");
    const innerGroup = weightInput.parentElement!.parentElement!;

    expect(innerGroup.className).toContain("grid-cols-[1fr_1fr_44px]");
    expect(innerGroup.className).toContain("md:contents");
  });

  it("weight + rate inputs have mobile placeholders", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    expect(screen.getByPlaceholderText("Weight kg")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("₹/kg")).toBeInTheDocument();
  });

  it("weight input preserves step=0.001 for gram-precision entry", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    const weightInput = screen.getByPlaceholderText("Weight kg");
    expect(weightInput.getAttribute("step")).toBe("0.001");
    expect(weightInput.getAttribute("inputmode")).toBe("decimal");
  });

  it("remove button has 44x44 mobile touch target", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    const removeBtn = screen.getByRole("button", { name: /remove line 1/i });
    expect(removeBtn.className).toContain("h-11");
    expect(removeBtn.className).toContain("w-11");
  });

  it("mobile-only line total row is rendered with `md:hidden`", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

    const labels = screen.getAllByText("Line total");
    const mobileLabel = labels.find((el) =>
      el.parentElement?.className.includes("md:hidden"),
    );
    expect(mobileLabel).toBeDefined();
  });

  it("form footer is sticky-bottom on mobile", () => {
    render(<PlatingForm mode="create" vendors={vendors} />);

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
