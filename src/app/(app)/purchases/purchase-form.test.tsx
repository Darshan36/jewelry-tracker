// Smoke tests for PurchaseForm — mirror of sale-form.test.tsx scope.
// The form's RHF + useFieldArray internals are covered by the Phase 7
// purchase-form-modal.test.tsx suite (now retired); these tests
// verify the standalone form renders cleanly and dispatches the
// right action based on `mode`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
}));

import { createPurchase, updatePurchase } from "./actions";

import { PurchaseForm } from "./purchase-form";

const suppliers = [
  { id: "sup-1", name: "Existing Supplier", phone: "9999999999" },
];

beforeEach(() => {
  vi.clearAllMocks();
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
      document.querySelector("#party-name-input") as HTMLInputElement,
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
