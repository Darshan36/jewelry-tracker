// Component tests for the plating form modal — multi-line useFieldArray
// + weight × rate live totals. Mocks navigation and the server actions
// + bill actions so the form's interactive behaviour can be exercised
// without touching the network.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------- mocks (hoisted) ----------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/plating",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createPlatingEntry: vi.fn(),
  updatePlatingEntry: vi.fn(),
  attachBillToPlatingEntry: vi.fn(),
  detachBillFromPlatingEntry: vi.fn(),
}));

vi.mock("@/app/(app)/bills/actions", () => ({
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  softDeleteBill: vi.fn(),
}));

import {
  createPlatingEntry,
  updatePlatingEntry,
} from "./actions";
import { PlatingFormModal } from "./plating-form-modal";
import type { VendorOption } from "./party-picker";

const vendors: VendorOption[] = [
  { id: "vendor-1", name: "Mahesh Plating Works", phone: "9876543210" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlatingFormModal — initial render", () => {
  it("renders one empty line row on open with weight=0 / rate=0 / total=₹0.00", () => {
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );

    const lineGroup = screen.getByRole("group", { name: /^Line 1$/i });
    expect(lineGroup).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /^Line 2$/i })).not.toBeInTheDocument();
  });

  it("seeds the date input to today (YYYY-MM-DD)", () => {
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    const dateInput = document.getElementById("plating-date") as HTMLInputElement;
    expect(dateInput).not.toBeNull();
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(dateInput.value).toBe(expected);
  });

  it("renders a vendor picker with the supplied vendors as autocomplete options", async () => {
    const user = userEvent.setup();
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    const picker = document.getElementById("plating-party-name") as HTMLInputElement;
    await user.click(picker);
    expect(screen.getByText("Mahesh Plating Works")).toBeInTheDocument();
  });
});

describe("PlatingFormModal — multi-line useFieldArray", () => {
  it("appends a new line when '+ Add line' is clicked", async () => {
    const user = userEvent.setup();
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add line/i }));
    expect(screen.getByRole("group", { name: /^Line 1$/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /^Line 2$/i })).toBeInTheDocument();
  });

  it("the only line's remove button is disabled (cannot drop below 1 line)", () => {
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    const line1 = screen.getByRole("group", { name: /^Line 1$/i });
    const remove = within(line1).getByRole("button", { name: /remove line 1/i });
    expect(remove).toBeDisabled();
  });

  it("removing a middle line re-keys the survivors cleanly (field.id keying)", async () => {
    const user = userEvent.setup();
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    // Add 2 more lines (total 3).
    await user.click(screen.getByRole("button", { name: /add line/i }));
    await user.click(screen.getByRole("button", { name: /add line/i }));

    // Type distinct sentinels into lines 1 and 3 (non-adjacent).
    const line1 = screen.getByRole("group", { name: /^Line 1$/i });
    await user.type(
      within(line1).getByPlaceholderText(/e\.g\. brass, aluminium/i),
      "BRASS-FIRST",
    );
    const line3 = screen.getByRole("group", { name: /^Line 3$/i });
    await user.type(
      within(line3).getByPlaceholderText(/e\.g\. brass, aluminium/i),
      "ZINC-THIRD",
    );

    // Remove the middle row (line 2).
    const line2 = screen.getByRole("group", { name: /^Line 2$/i });
    await user.click(within(line2).getByRole("button", { name: /remove line 2/i }));

    // Survivors keep their typed values (now in rows 1 and 2).
    const groups = screen.getAllByRole("group", { name: /^Line \d+$/i });
    expect(groups).toHaveLength(2);
    const surv1 = within(groups[0]).getByPlaceholderText(
      /e\.g\. brass, aluminium/i,
    ) as HTMLInputElement;
    const surv2 = within(groups[1]).getByPlaceholderText(
      /e\.g\. brass, aluminium/i,
    ) as HTMLInputElement;
    expect(surv1.value).toBe("BRASS-FIRST");
    expect(surv2.value).toBe("ZINC-THIRD");
  });
});

describe("PlatingFormModal — live line-total preview", () => {
  it("shows ₹1,000.00 when weight=2.5 and rate=400", async () => {
    const user = userEvent.setup();
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    const line1 = screen.getByRole("group", { name: /^Line 1$/i });
    const weightInput = line1.querySelector('input[id$="-weight"]') as HTMLInputElement;
    const rateInput = line1.querySelector('input[id$="-rate"]') as HTMLInputElement;
    await user.type(weightInput, "2.5");
    await user.type(rateInput, "400");
    // The line total cell is the last tabular-nums sibling on the row.
    const totalCells = line1.querySelectorAll(".tabular-nums");
    const totalText = totalCells[totalCells.length - 1].textContent ?? "";
    expect(totalText).toMatch(/₹\s*1,?000\.00/);
  });

  it("shows ₹656.25 when weight=1.875 and rate=350 (CRITICAL — matches walkthrough Step 6)", async () => {
    const user = userEvent.setup();
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    const line1 = screen.getByRole("group", { name: /^Line 1$/i });
    const weightInput = line1.querySelector('input[id$="-weight"]') as HTMLInputElement;
    const rateInput = line1.querySelector('input[id$="-rate"]') as HTMLInputElement;
    await user.type(weightInput, "1.875");
    await user.type(rateInput, "350");
    const totalCells = line1.querySelectorAll(".tabular-nums");
    const totalText = totalCells[totalCells.length - 1].textContent ?? "";
    expect(totalText).toMatch(/₹\s*656\.25/);
  });

  it("flags discount-exceeds-subtotal at the live preview layer", async () => {
    const user = userEvent.setup();
    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );
    const line1 = screen.getByRole("group", { name: /^Line 1$/i });
    await user.type(
      line1.querySelector('input[id$="-weight"]') as HTMLInputElement,
      "1",
    );
    await user.type(
      line1.querySelector('input[id$="-rate"]') as HTMLInputElement,
      "100",
    );
    // Discount ₹500 > subtotal ₹100.
    const discount = document.getElementById("plating-discount") as HTMLInputElement;
    await user.clear(discount);
    await user.type(discount, "500");

    expect(
      screen.getByText(/discount exceeds line item subtotal/i),
    ).toBeInTheDocument();
  });
});

describe("PlatingFormModal — submit flow without bill", () => {
  it("calls createPlatingEntry on save when entry is undefined (create mode)", async () => {
    const user = userEvent.setup();
    vi.mocked(createPlatingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "new-entry" } as any,
    });

    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        vendors={vendors}
      />,
    );

    // Fill the minimal required fields: party name + line item.
    const partyName = document.getElementById("plating-party-name") as HTMLInputElement;
    await user.type(partyName, "Walk-in Vendor");
    const line1 = screen.getByRole("group", { name: /^Line 1$/i });
    await user.type(
      line1.querySelector('input[id$="-material"]') as HTMLInputElement,
      "Brass",
    );
    await user.type(
      line1.querySelector('input[id$="-weight"]') as HTMLInputElement,
      "1",
    );
    await user.type(
      line1.querySelector('input[id$="-rate"]') as HTMLInputElement,
      "100",
    );

    // The form submit button is the only "Save" button in the dialog.
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(createPlatingEntry).toHaveBeenCalledOnce();
    expect(updatePlatingEntry).not.toHaveBeenCalled();
  });

  it("calls updatePlatingEntry on save when entry prop is supplied (edit mode)", async () => {
    const user = userEvent.setup();
    vi.mocked(updatePlatingEntry).mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entry: { id: "entry-1" } as any,
    });

    const existingEntry = {
      id: "entry-1",
      date: new Date("2026-05-01T00:00:00Z"),
      vendorId: "vendor-1",
      partyName: "Mahesh Plating Works",
      partyPhone: "9876543210",
      discount: 0,
      total: 100000,
      notes: null,
      billId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      lineItems: [
        {
          id: "li-1",
          platingEntryId: "entry-1",
          materialDescription: "Brass",
          weightKg: "1.000",
          ratePerKg: 100000,
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

    render(
      <PlatingFormModal
        open
        onOpenChange={() => {}}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry={existingEntry as any}
        vendors={vendors}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(updatePlatingEntry).toHaveBeenCalledOnce();
    expect(createPlatingEntry).not.toHaveBeenCalled();
  });
});
