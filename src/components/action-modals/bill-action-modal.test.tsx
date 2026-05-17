// Tests for BillActionModal — the most complex cross-system component
// in Phase 10. The replace flow chains four server actions plus a
// browser-side R2 PUT, and the order matters: a failure midway can
// orphan an R2 object or leave a dangling `billId` FK.
//
// Server actions mocked:
//   - getBillForEntity       (Phase 10, fetches the current bill by discriminator)
//   - prepareUpload          (Phase 8, creates PENDING Bill + presigned PUT URL)
//   - confirmUpload          (Phase 8, verifies R2 object + flips to READY)
//   - softDeleteBill         (Phase 8, R2 delete + DB tombstone)
//   - attachBillTo*Entry     (Phase 9, sets billId FK on Casting/Plating)
//   - detachBillFrom*Entry   (Phase 9, clears billId FK on Casting/Plating)
//
// The browser-side R2 PUT is mocked via a stubbed XMLHttpRequest.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/(app)/bills/actions", () => ({
  getBillForEntity: vi.fn(),
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  softDeleteBill: vi.fn(),
  getBillViewUrl: vi.fn(),
}));

vi.mock("@/app/(app)/casting/actions", () => ({
  attachBillToCastingEntry: vi.fn(),
  detachBillFromCastingEntry: vi.fn(),
}));

vi.mock("@/app/(app)/plating/actions", () => ({
  attachBillToPlatingEntry: vi.fn(),
  detachBillFromPlatingEntry: vi.fn(),
}));

import {
  confirmUpload,
  getBillForEntity,
  prepareUpload,
  softDeleteBill,
} from "@/app/(app)/bills/actions";
import {
  attachBillToCastingEntry,
  detachBillFromCastingEntry,
} from "@/app/(app)/casting/actions";

import { BillActionModal } from "./bill-action-modal";

// ---------- XHR + URL stubs ----------

class StubXHR {
  static lastInstance: StubXHR | null = null;
  static failNext = false;
  upload = {
    onprogress: null as ((e: ProgressEvent) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  open(_method: string, _url: string, _async: boolean) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setRequestHeader(_k: string, _v: string) {}
  send(_body: unknown) {
    StubXHR.lastInstance = this;
    // Resolve asynchronously so the caller can await.
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

beforeEach(() => {
  vi.clearAllMocks();
  StubXHR.lastInstance = null;
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

const RESOLVED_NO_BILL = {
  ok: true as const,
  bill: null,
};
const RESOLVED_PREPARE_OK = {
  ok: true as const,
  billId: "new-bill-id",
  presignedUrl: "https://signed.example/put",
};
const RESOLVED_CONFIRM_OK = {
  ok: true as const,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bill: { id: "new-bill-id", status: "READY" } as any,
};

// =====================================================================
// Initial render — fetches existing bill on open
// =====================================================================

describe("BillActionModal — initial fetch on open", () => {
  it("calls getBillForEntity once on open with the discriminator pair", async () => {
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);

    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      expect(getBillForEntity).toHaveBeenCalledOnce();
    });
    expect(getBillForEntity).toHaveBeenCalledWith("SALE", "sale-1");
  });

  it("entityType='purchase' fetches with 'PURCHASE' attachedToType", async () => {
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    render(
      <BillActionModal
        entityType="purchase"
        entityId="purchase-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() =>
      expect(getBillForEntity).toHaveBeenCalledWith("PURCHASE", "purchase-1"),
    );
  });

  it("entityType='casting' fetches with 'CASTING_ENTRY' attachedToType", async () => {
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    render(
      <BillActionModal
        entityType="casting"
        entityId="entry-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() =>
      expect(getBillForEntity).toHaveBeenCalledWith("CASTING_ENTRY", "entry-1"),
    );
  });

  it("renders 'Upload bill' title when no existing bill is attached", async () => {
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /upload bill/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders 'Replace bill' title + filename when an existing bill is attached", async () => {
    vi.mocked(getBillForEntity).mockResolvedValue({
      ok: true as const,
      bill: {
        id: "existing-1",
        originalFilename: "old.png",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
    });
    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /replace bill/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/old\.png/i)).toBeInTheDocument();
    });
  });
});

// =====================================================================
// First upload (no existing bill) — chain: prepare → R2 PUT → confirm
// =====================================================================

describe("BillActionModal — first upload chain", () => {
  it("calls prepareUpload then confirmUpload in order (no replace path) for sales", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue(RESOLVED_PREPARE_OK);
    vi.mocked(confirmUpload).mockResolvedValue(RESOLVED_CONFIRM_OK);

    const onClose = vi.fn();
    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={onClose}
      />,
    );

    // Wait for getBillForEntity to settle then pick a file.
    await vi.waitFor(() =>
      expect(getBillForEntity).toHaveBeenCalledOnce(),
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("new.png", "image/png"));

    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(prepareUpload).toHaveBeenCalledOnce();
      expect(confirmUpload).toHaveBeenCalledOnce();
      expect(softDeleteBill).not.toHaveBeenCalled(); // no existing bill to delete
      expect(onClose).toHaveBeenCalledOnce();
    });

    // prepareUpload received the right discriminator pair.
    const prepareCall = vi.mocked(prepareUpload).mock.calls[0][0];
    expect(prepareCall.attachedToType).toBe("SALE");
    expect(prepareCall.attachedToId).toBe("sale-1");
    expect(prepareCall.mimeType).toBe("image/png");

    // confirmUpload received the billId from prepareUpload.
    const confirmCall = vi.mocked(confirmUpload).mock.calls[0][0];
    expect(confirmCall.billId).toBe("new-bill-id");
  });

  it("first upload for casting also calls attachBillToCastingEntry (FK side)", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue(RESOLVED_PREPARE_OK);
    vi.mocked(confirmUpload).mockResolvedValue(RESOLVED_CONFIRM_OK);
    vi.mocked(attachBillToCastingEntry).mockResolvedValue({ ok: true as const });

    render(
      <BillActionModal
        entityType="casting"
        entityId="cast-1"
        open
        onClose={vi.fn()}
      />,
    );

    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("x.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(attachBillToCastingEntry).toHaveBeenCalledOnce();
    });
    expect(attachBillToCastingEntry).toHaveBeenCalledWith("cast-1", "new-bill-id");
  });
});

// =====================================================================
// Replace flow chain — soft-delete old → prepare → R2 PUT → confirm
// =====================================================================

describe("BillActionModal — replace flow chain (the most error-prone path)", () => {
  it("calls softDeleteBill THEN prepareUpload THEN confirmUpload in that order", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];

    vi.mocked(getBillForEntity).mockResolvedValue({
      ok: true as const,
      bill: {
        id: "old-bill-id",
        originalFilename: "old.png",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
    });
    vi.mocked(softDeleteBill).mockImplementation(async () => {
      callOrder.push("softDeleteBill");
      return { ok: true as const };
    });
    vi.mocked(prepareUpload).mockImplementation(async () => {
      callOrder.push("prepareUpload");
      return RESOLVED_PREPARE_OK;
    });
    vi.mocked(confirmUpload).mockImplementation(async () => {
      callOrder.push("confirmUpload");
      return RESOLVED_CONFIRM_OK;
    });

    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    // Existing bill panel renders; pick a new file.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("new.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(callOrder).toEqual([
        "softDeleteBill",
        "prepareUpload",
        "confirmUpload",
      ]);
    });

    // softDeleteBill received the OLD bill's id.
    expect(softDeleteBill).toHaveBeenCalledWith({ billId: "old-bill-id" });
  });

  it("replace flow for casting ALSO calls detachBillFromCastingEntry BEFORE softDeleteBill (FK cleared first)", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];

    vi.mocked(getBillForEntity).mockResolvedValue({
      ok: true as const,
      bill: {
        id: "old-bill-id",
        originalFilename: "old.png",
        mimeType: "image/png",
        sizeBytes: 1024,
      },
    });
    vi.mocked(detachBillFromCastingEntry).mockImplementation(async () => {
      callOrder.push("detachBillFromCastingEntry");
      return { ok: true as const };
    });
    vi.mocked(softDeleteBill).mockImplementation(async () => {
      callOrder.push("softDeleteBill");
      return { ok: true as const };
    });
    vi.mocked(prepareUpload).mockImplementation(async () => {
      callOrder.push("prepareUpload");
      return RESOLVED_PREPARE_OK;
    });
    vi.mocked(confirmUpload).mockImplementation(async () => {
      callOrder.push("confirmUpload");
      return RESOLVED_CONFIRM_OK;
    });
    vi.mocked(attachBillToCastingEntry).mockImplementation(async () => {
      callOrder.push("attachBillToCastingEntry");
      return { ok: true as const };
    });

    render(
      <BillActionModal
        entityType="casting"
        entityId="cast-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("new.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    // Detach FIRST (so the @unique billId is free), then soft-delete the
    // old bill row, then upload + confirm + attach the new one.
    await vi.waitFor(() => {
      expect(callOrder).toEqual([
        "detachBillFromCastingEntry",
        "softDeleteBill",
        "prepareUpload",
        "confirmUpload",
        "attachBillToCastingEntry",
      ]);
    });
  });
});

// =====================================================================
// Failure modes — chain halts on the first error
// =====================================================================

describe("BillActionModal — failure modes halt the chain", () => {
  it("prepareUpload failure: confirmUpload NOT called, modal stays open, error surfaces", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue({
      ok: false as const,
      errors: { mimeType: ["Unsupported file type."] },
    });

    const onClose = vi.fn();
    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={onClose}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("x.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("R2 PUT (XHR) failure: confirmUpload NOT called, modal stays open, error surfaces", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue(RESOLVED_PREPARE_OK);
    StubXHR.failNext = true;

    const onClose = vi.fn();
    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={onClose}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("x.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/network error during upload/i),
      ).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirmUpload failure: chain halts, attach/detach NOT called, modal stays open", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue(RESOLVED_PREPARE_OK);
    vi.mocked(confirmUpload).mockResolvedValue({
      ok: false as const,
      errors: { billId: ["Upload verification failed"] },
    });

    const onClose = vi.fn();
    render(
      <BillActionModal
        entityType="casting"
        entityId="cast-1"
        open
        onClose={onClose}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile("x.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/upload verification failed/i),
      ).toBeInTheDocument();
    });
    // attach NOT called — chain halted at confirm.
    expect(attachBillToCastingEntry).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// =====================================================================
// File picker validation (client-side mime + size)
// =====================================================================

describe("BillActionModal — client-side file picker validation", () => {
  it("rejects unsupported MIME types client-side (before any server action)", async () => {
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);

    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    // userEvent.upload respects the `accept=` filter (drops the file
    // silently) so we go via fireEvent.change to assign files directly
    // and exercise the JS-side onPickFile rejection logic.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const txtFile = makeFile("doc.txt", "text/plain");
    fireEvent.change(fileInput, { target: { files: [txtFile] } });

    await vi.waitFor(() => {
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    });
    expect(prepareUpload).not.toHaveBeenCalled();
  });
});
