// Tests for BillActionModal — Phase 10.5 prop-injection refactor.
//
// The chain itself (getBillForEntity → softDeleteBill → prepareUpload
// → R2 PUT → confirmUpload) is entity-agnostic; what differs across
// entity types is whether the caller supplies onAttach/onDetach
// (Casting/Plating have a billId FK on the entity row) or not
// (Sales/Purchases use the discriminator-only path). These tests
// parameterise the modal across both shapes.

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

import {
  confirmUpload,
  getBillForEntity,
  prepareUpload,
  softDeleteBill,
} from "@/app/(app)/bills/actions";

import {
  BillActionModal,
  type BillEntityType,
} from "./bill-action-modal";

// ---------- XHR + URL stubs ----------

class StubXHR {
  static lastInstance: StubXHR | null = null;
  static failNext = false;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  status = 200;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  open(_method: string, _url: string, _async: boolean) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setRequestHeader(_k: string, _v: string) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  send(_body: unknown) {
    StubXHR.lastInstance = this;
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

const RESOLVED_NO_BILL = { ok: true as const, bill: null };
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
// Initial fetch on open — entityType → discriminator mapping
// =====================================================================

const DISCRIMINATOR_MAP: ReadonlyArray<readonly [BillEntityType, string]> = [
  ["sale", "SALE"],
  ["purchase", "PURCHASE"],
  ["casting", "CASTING_ENTRY"],
  ["plating", "PLATING_ENTRY"],
];

describe.each(DISCRIMINATOR_MAP)(
  "BillActionModal — entityType=%s fetches with attachedToType=%s",
  (entityType, attachedToType) => {
    it("calls getBillForEntity with the right discriminator on open", async () => {
      vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);

      render(
        <BillActionModal
          entityType={entityType}
          entityId={`${entityType}-1`}
          open
          onClose={vi.fn()}
        />,
      );

      await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
      expect(getBillForEntity).toHaveBeenCalledWith(
        attachedToType,
        `${entityType}-1`,
      );
    });
  },
);

describe("BillActionModal — render states", () => {
  it("renders 'Upload bill' title when no existing bill", async () => {
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

  it("renders 'Replace bill' title + filename when existing bill is attached", async () => {
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
      expect(screen.getByRole("heading", { name: /replace bill/i })).toBeInTheDocument();
      expect(screen.getByText(/old\.png/i)).toBeInTheDocument();
    });
  });
});

// =====================================================================
// First upload — Sales/Purchases (no FK) vs Casting/Plating (FK via onAttach)
// =====================================================================

describe("BillActionModal — first upload, Sales/Purchases (discriminator-only)", () => {
  it("calls prepareUpload then confirmUpload (NO attach call) when onAttach is omitted", async () => {
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

    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(fileInput, makeFile("new.png", "image/png"));
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(prepareUpload).toHaveBeenCalledOnce();
      expect(confirmUpload).toHaveBeenCalledOnce();
      expect(softDeleteBill).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();
    });

    const prepCall = vi.mocked(prepareUpload).mock.calls[0][0];
    expect(prepCall.attachedToType).toBe("SALE");
    expect(prepCall.attachedToId).toBe("sale-1");
  });

  it("entityType='purchase' sends attachedToType='PURCHASE'", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue(RESOLVED_PREPARE_OK);
    vi.mocked(confirmUpload).mockResolvedValue(RESOLVED_CONFIRM_OK);

    render(
      <BillActionModal
        entityType="purchase"
        entityId="p-1"
        open
        onClose={vi.fn()}
      />,
    );

    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeFile("x.png", "image/png"),
    );
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => expect(prepareUpload).toHaveBeenCalledOnce());
    expect(vi.mocked(prepareUpload).mock.calls[0][0].attachedToType).toBe(
      "PURCHASE",
    );
  });
});

describe("BillActionModal — first upload, Casting/Plating (FK via onAttach)", () => {
  // Phase 10.6: parameterise across both FK-bearing entity types so any
  // future divergence in their chain semantics fails loudly.
  it.each([
    ["casting", "CASTING_ENTRY"] as const,
    ["plating", "PLATING_ENTRY"] as const,
  ])(
    "entityType=%s calls onAttach AFTER confirmUpload with the right discriminator",
    async (entityType, attachedToType) => {
      const user = userEvent.setup();
      const callOrder: string[] = [];
      vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
      vi.mocked(prepareUpload).mockImplementation(async () => {
        callOrder.push("prepareUpload");
        return RESOLVED_PREPARE_OK;
      });
      vi.mocked(confirmUpload).mockImplementation(async () => {
        callOrder.push("confirmUpload");
        return RESOLVED_CONFIRM_OK;
      });
      const onAttach = vi.fn(async () => {
        callOrder.push("onAttach");
        return { ok: true as const };
      });

      render(
        <BillActionModal
          entityType={entityType}
          entityId={`${entityType}-1`}
          open
          onClose={vi.fn()}
          onAttach={onAttach}
        />,
      );

      await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
      await user.upload(
        document.querySelector('input[type="file"]') as HTMLInputElement,
        makeFile("x.png", "image/png"),
      );
      await user.click(screen.getByRole("button", { name: /^upload$/i }));

      await vi.waitFor(() => expect(onAttach).toHaveBeenCalledOnce());
      expect(callOrder).toEqual(["prepareUpload", "confirmUpload", "onAttach"]);
      expect(onAttach).toHaveBeenCalledWith(`${entityType}-1`, "new-bill-id");
      expect(vi.mocked(prepareUpload).mock.calls[0][0].attachedToType).toBe(
        attachedToType,
      );
    },
  );
});

// =====================================================================
// Replace chain — Sales/Purchases vs Casting/Plating
// =====================================================================

const EXISTING_BILL = {
  id: "old-bill-id",
  originalFilename: "old.png",
  mimeType: "image/png",
  sizeBytes: 1024,
};

describe("BillActionModal — replace flow", () => {
  it("Sales/Purchases (no onDetach): softDeleteBill → prepareUpload → confirmUpload in order", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    vi.mocked(getBillForEntity).mockResolvedValue({
      ok: true as const,
      bill: EXISTING_BILL,
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
        entityType="purchase"
        entityId="p-1"
        open
        onClose={vi.fn()}
      />,
    );

    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeFile("new.png", "image/png"),
    );
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(callOrder).toEqual([
        "softDeleteBill",
        "prepareUpload",
        "confirmUpload",
      ]);
    });
    expect(softDeleteBill).toHaveBeenCalledWith({ billId: "old-bill-id" });
  });

  // Phase 10.6: parameterise across both FK-bearing entity types so the
  // replace ordering contract is pinned per-entity. The Phase 10.5 leak
  // would have surfaced here if entityType="sale" had snuck into the
  // mirrored side.
  it.each(["casting", "plating"] as const)(
    "entityType=%s replace chain: onDetach → softDeleteBill → prepareUpload → confirmUpload → onAttach",
    async (entityType) => {
      const user = userEvent.setup();
      const callOrder: string[] = [];
      vi.mocked(getBillForEntity).mockResolvedValue({
        ok: true as const,
        bill: EXISTING_BILL,
      });
      const onDetach = vi.fn(async () => {
        callOrder.push("onDetach");
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
      const onAttach = vi.fn(async () => {
        callOrder.push("onAttach");
        return { ok: true as const };
      });

      render(
        <BillActionModal
          entityType={entityType}
          entityId={`${entityType}-1`}
          open
          onClose={vi.fn()}
          onAttach={onAttach}
          onDetach={onDetach}
        />,
      );

      await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
      await user.upload(
        document.querySelector('input[type="file"]') as HTMLInputElement,
        makeFile("new.png", "image/png"),
      );
      await user.click(screen.getByRole("button", { name: /^upload$/i }));

      await vi.waitFor(() => expect(onAttach).toHaveBeenCalledOnce());
      expect(callOrder).toEqual([
        "onDetach",
        "softDeleteBill",
        "prepareUpload",
        "confirmUpload",
        "onAttach",
      ]);
    },
  );
});

// =====================================================================
// Failure modes — chain halts, modal stays open
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
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeFile("x.png", "image/png"),
    );
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("R2 PUT (XHR) failure halts chain", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue(RESOLVED_PREPARE_OK);
    StubXHR.failNext = true;

    render(
      <BillActionModal
        entityType="sale"
        entityId="sale-1"
        open
        onClose={vi.fn()}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeFile("x.png", "image/png"),
    );
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/network error during upload/i)).toBeInTheDocument();
    });
    expect(confirmUpload).not.toHaveBeenCalled();
  });

  it("onDetach failure (FK chain) halts before softDeleteBill", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    vi.mocked(getBillForEntity).mockResolvedValue({
      ok: true as const,
      bill: EXISTING_BILL,
    });
    const onDetach = vi.fn(async () => {
      callOrder.push("onDetach");
      throw new Error("Detach failed");
    });
    vi.mocked(softDeleteBill).mockImplementation(async () => {
      callOrder.push("softDeleteBill");
      return { ok: true as const };
    });

    render(
      <BillActionModal
        entityType="casting"
        entityId="cast-1"
        open
        onClose={vi.fn()}
        onAttach={vi.fn(async () => ({ ok: true as const }))}
        onDetach={onDetach}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeFile("new.png", "image/png"),
    );
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => expect(onDetach).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(screen.getByText(/detach failed/i)).toBeInTheDocument();
    });
    // The rest of the chain MUST NOT run when detach fails — otherwise we'd
    // tombstone the old bill while the entity's FK still pointed at it.
    expect(softDeleteBill).not.toHaveBeenCalled();
    expect(prepareUpload).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["onDetach"]);
  });

  it("confirmUpload failure: onAttach NOT called even when supplied", async () => {
    const user = userEvent.setup();
    vi.mocked(getBillForEntity).mockResolvedValue(RESOLVED_NO_BILL);
    vi.mocked(prepareUpload).mockResolvedValue(RESOLVED_PREPARE_OK);
    vi.mocked(confirmUpload).mockResolvedValue({
      ok: false as const,
      errors: { billId: ["Upload verification failed"] },
    });
    const onAttach = vi.fn(async () => ({ ok: true as const }));

    render(
      <BillActionModal
        entityType="casting"
        entityId="cast-1"
        open
        onClose={vi.fn()}
        onAttach={onAttach}
      />,
    );
    await vi.waitFor(() => expect(getBillForEntity).toHaveBeenCalledOnce());
    await user.upload(
      document.querySelector('input[type="file"]') as HTMLInputElement,
      makeFile("x.png", "image/png"),
    );
    await user.click(screen.getByRole("button", { name: /^upload$/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/upload verification failed/i)).toBeInTheDocument();
    });
    expect(onAttach).not.toHaveBeenCalled();
  });
});

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
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [makeFile("doc.txt", "text/plain")] },
    });

    await vi.waitFor(() => {
      expect(screen.getByText(/unsupported file type/i)).toBeInTheDocument();
    });
    expect(prepareUpload).not.toHaveBeenCalled();
  });
});
