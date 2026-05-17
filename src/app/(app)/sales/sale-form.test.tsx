// Smoke tests for SaleForm — the form's internal logic (RHF validation,
// useFieldArray, live subtotal/total math) was extensively covered by
// the Phase 7 sale-form-modal.test.tsx suite (deleted in the Phase 10
// build). These tests verify the standalone component renders cleanly
// and dispatches create / update correctly based on `mode`.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
}));
// Phase 10.5: SaleForm now imports prepareUpload/confirmUpload for the
// inline bill section. Mock the bills action module so the test
// doesn't pull next-auth's runtime into the jsdom environment.
vi.mock("@/app/(app)/bills/actions", () => ({
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
}));

import { createSale, updateSale } from "./actions";

import { SaleForm } from "./sale-form";

const customers = [
  { id: "cust-1", name: "Existing Customer", phone: "9999999999" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SaleForm — create mode", () => {
  it("renders with default empty values and one empty line item", () => {
    render(<SaleForm mode="create" customers={customers} />);
    expect(screen.getByRole("group", { name: /^Line 1$/i })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Line 2$/i })).not.toBeInTheDocument();
  });

  it("renders the SaveDropdown split button", () => {
    render(<SaleForm mode="create" customers={customers} />);
    expect(
      screen.getByRole("button", { name: /save and return/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /more save options/i }),
    ).toBeInTheDocument();
  });

  it("renders a Cancel button that's not the form submit", () => {
    render(<SaleForm mode="create" customers={customers} />);
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancel.getAttribute("type")).toBe("button");
  });

  it("dispatches createSale on Save and return", async () => {
    const user = userEvent.setup();
    vi.mocked(createSale).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sale: { id: "new-sale", customerId: null } as any,
    });

    render(<SaleForm mode="create" customers={customers} />);

    // Fill the minimum required fields.
    await user.type(document.querySelector("#party-name-input") as HTMLInputElement, "Walk-in");
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
    customerId: "cust-1",
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
    render(<SaleForm mode="edit" sale={existingSale as any} customers={customers} />);

    // SaleForm seeds defaults inside a useEffect after first render,
    // so wait for the rate input to receive the prefilled rupee value.
    // (party-name-input is driven through PartyPicker's controlled
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
      sale: { id: "sale-1", customerId: "cust-1" } as any,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<SaleForm mode="edit" sale={existingSale as any} customers={customers} />);

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    await vi.waitFor(() => {
      expect(updateSale).toHaveBeenCalledOnce();
    });
    expect(createSale).not.toHaveBeenCalled();
    // The first arg is the sale id.
    expect(vi.mocked(updateSale).mock.calls[0][0]).toBe("sale-1");
  });
});
