// Smoke tests for CastingForm — Phase 10.6 mirror of sale-form.test.tsx
// adapted for casting-specific shape: weight inputs (Decimal, step="0.001"),
// vendor picker (#casting-party-name), FK-based bill attach via
// attachBillToCastingEntry AFTER confirmUpload.
//
// The form's RHF + useFieldArray internals are covered by the Phase 7
// casting-form-modal.test.tsx suite (now retired); these tests verify
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
  createCastingEntry: vi.fn(),
  updateCastingEntry: vi.fn(),
  attachBillToCastingEntry: vi.fn(),
}));
// Phase 10.6: CastingForm imports prepareUpload/confirmUpload for the
// inline bill section. Mock the bills action module so the test doesn't
// pull next-auth's runtime into jsdom.
vi.mock("@/app/(app)/bills/actions", () => ({
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

import {
  attachBillToCastingEntry,
  createCastingEntry,
  updateCastingEntry,
} from "./actions";
import { confirmUpload, prepareUpload } from "@/app/(app)/bills/actions";

import { CastingForm } from "./casting-form";

// XHR stub for the browser-side R2 PUT inside CastingForm.onSubmit.
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

describe("CastingForm — create mode", () => {
  it("renders with default empty values and one empty line item", () => {
    render(<CastingForm mode="create" vendors={vendors} />);
    expect(screen.getByRole("group", { name: /^Line 1$/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Line 2$/i })).not.toBeInTheDocument();
  });

  it("renders weight input with step='0.001' for gram precision", () => {
    render(<CastingForm mode="create" vendors={vendors} />);
    const weightInput = document.querySelector(
      "#casting-line-0-weight",
    ) as HTMLInputElement;
    expect(weightInput).toBeInTheDocument();
    expect(weightInput.getAttribute("step")).toBe("0.001");
  });

  it("renders the SaveDropdown split button", () => {
    render(<CastingForm mode="create" vendors={vendors} />);
    expect(
      screen.getByRole("button", { name: /save and return/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /more save options/i }),
    ).toBeInTheDocument();
  });

  it("renders a Cancel button that's not the form submit", () => {
    render(<CastingForm mode="create" vendors={vendors} />);
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancel.getAttribute("type")).toBe("button");
  });

  it("dispatches createCastingEntry on Save and return", async () => {
    const user = userEvent.setup();
    vi.mocked(createCastingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-casting", vendorId: null } as any,
    });

    render(<CastingForm mode="create" vendors={vendors} />);

    await user.type(
      document.querySelector("#casting-party-name") as HTMLInputElement,
      "Walk-in",
    );
    await user.type(
      document.querySelector("#casting-line-0-material") as HTMLInputElement,
      "Brass",
    );
    await user.type(
      document.querySelector("#casting-line-0-weight") as HTMLInputElement,
      "2.500",
    );
    await user.type(
      document.querySelector("#casting-line-0-rate") as HTMLInputElement,
      "400",
    );

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(createCastingEntry).toHaveBeenCalledOnce();
    });
    expect(updateCastingEntry).not.toHaveBeenCalled();
  });
});

describe("CastingForm — edit mode", () => {
  const existingEntry = {
    id: "casting-1",
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
        castingEntryId: "casting-1",
        materialDescription: "Brass",
        weightKg: "2.500", // serialised as string per casting-helpers
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
      <CastingForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry={existingEntry as any}
        vendors={vendors}
      />,
    );

    // CastingForm seeds defaults inside a useEffect after first render,
    // so wait for the rate input to receive the prefilled rupee value.
    await vi.waitFor(() => {
      const lineRate = document.querySelector(
        "#casting-line-0-rate",
      ) as HTMLInputElement | null;
      expect(lineRate?.value).toBe("400");
    });

    const lineMaterial = document.querySelector(
      "#casting-line-0-material",
    ) as HTMLInputElement;
    expect(lineMaterial.value).toBe("Brass");
    const lineWeight = document.querySelector(
      "#casting-line-0-weight",
    ) as HTMLInputElement;
    expect(Number(lineWeight.value)).toBe(2.5);
    const discount = document.querySelector(
      "#casting-discount",
    ) as HTMLInputElement;
    expect(discount.value).toBe("100");
  });

  it("dispatches updateCastingEntry (not createCastingEntry) on save", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCastingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "casting-1", vendorId: "vendor-1" } as any,
    });
    render(
      <CastingForm
        mode="edit"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry={existingEntry as any}
        vendors={vendors}
      />,
    );

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(updateCastingEntry).toHaveBeenCalledOnce();
    });
    expect(createCastingEntry).not.toHaveBeenCalled();
    expect(vi.mocked(updateCastingEntry).mock.calls[0][0]).toBe("casting-1");
  });
});

// =====================================================================
// Phase 10.6 bill-in-form retrofit — Casting uses FK-based attach
// =====================================================================

describe("CastingForm — bill-in-form retrofit (Phase 10.6)", () => {
  function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
    return (async () => {
      await user.type(
        document.querySelector("#casting-party-name") as HTMLInputElement,
        "Walk-in",
      );
      await user.type(
        document.querySelector("#casting-line-0-material") as HTMLInputElement,
        "Brass",
      );
      await user.type(
        document.querySelector("#casting-line-0-weight") as HTMLInputElement,
        "1.250",
      );
      await user.type(
        document.querySelector("#casting-line-0-rate") as HTMLInputElement,
        "100",
      );
    })();
  }

  function getFileInput(): HTMLInputElement {
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("renders the inline 'Attach bill (optional)' section", () => {
    render(<CastingForm mode="create" vendors={vendors} />);
    expect(screen.getByText(/attach bill \(optional\)/i)).toBeInTheDocument();
    expect(getFileInput()).toBeInTheDocument();
  });

  it("picking a valid file shows the filename + Remove button", async () => {
    const user = userEvent.setup();
    render(<CastingForm mode="create" vendors={vendors} />);

    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));

    expect(screen.getByText(/receipt\.png/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
  });

  it("rejects unsupported MIME types client-side without calling prepareUpload", async () => {
    render(<CastingForm mode="create" vendors={vendors} />);

    fireEvent.change(getFileInput(), {
      target: { files: [makeFile("doc.txt", "text/plain")] },
    });

    expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("on successful save+upload: runs createCastingEntry → prepareUpload(CASTING_ENTRY) → confirmUpload → attachBillToCastingEntry, in order", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    vi.mocked(createCastingEntry).mockImplementation(async () => {
      callOrder.push("createCastingEntry");
      return {
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { id: "new-casting-id", vendorId: null } as any,
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
    vi.mocked(attachBillToCastingEntry).mockImplementation(async () => {
      callOrder.push("attachBillToCastingEntry");
      return { ok: true as const };
    });

    render(<CastingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(callOrder).toEqual([
        "createCastingEntry",
        "prepareUpload",
        "confirmUpload",
        "attachBillToCastingEntry",
      ]);
    });
    // Verify the discriminator + savedEntryId flow through correctly.
    const prepArg = vi.mocked(prepareUpload).mock.calls[0][0];
    expect(prepArg.attachedToType).toBe("CASTING_ENTRY");
    expect(prepArg.attachedToId).toBe("new-casting-id");
    // FK attach gets the new entry id + the new bill id.
    expect(attachBillToCastingEntry).toHaveBeenCalledWith(
      "new-casting-id",
      "bill-id",
    );
    // Navigation runs after the chain completes.
    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith("/casting"));
  });

  it("saves without firing upload chain when no file is picked", async () => {
    const user = userEvent.setup();
    vi.mocked(createCastingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-casting", vendorId: null } as any,
    });

    render(<CastingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => expect(createCastingEntry).toHaveBeenCalledOnce());
    expect(prepareUpload).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(attachBillToCastingEntry).not.toHaveBeenCalled();
  });

  it("on upload failure: entry stays saved, error banner appears, NO navigation, NO attach call", async () => {
    const user = userEvent.setup();
    vi.mocked(createCastingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-casting-id", vendorId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: false as const,
      errors: { mimeType: ["Unsupported file type."] },
    });

    render(<CastingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => expect(prepareUpload).toHaveBeenCalledOnce());
    expect(createCastingEntry).toHaveBeenCalledOnce();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(attachBillToCastingEntry).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/casting entry saved, but bill upload failed/i),
    ).toBeInTheDocument();
  });

  it("R2 PUT network failure halts the chain before confirmUpload and attach", async () => {
    const user = userEvent.setup();
    vi.mocked(createCastingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-casting-id", vendorId: null } as any,
    });
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: true as const,
      billId: "bill-id",
      presignedUrl: "https://signed.example/put",
    });
    StubXHR.failNext = true;

    render(<CastingForm mode="create" vendors={vendors} />);
    await fillRequiredFields(user);
    await user.upload(getFileInput(), makeFile("receipt.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/casting entry saved, but bill upload failed/i),
      ).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(attachBillToCastingEntry).not.toHaveBeenCalled();
  });
});
