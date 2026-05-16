import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
}));

import { PurchaseFormModal } from "./purchase-form-modal";
import { createPurchase } from "./actions";
import type { SupplierOption } from "./party-picker";

const suppliers: SupplierOption[] = [];

function openModal() {
  return render(
    <PurchaseFormModal
      open
      onOpenChange={() => {}}
      suppliers={suppliers}
    />,
  );
}

function lineGroups() {
  return screen.queryAllByRole("group", { name: /^Line \d+$/i });
}

describe("PurchaseFormModal — useFieldArray line items (Phase 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens with exactly one empty line row", () => {
    openModal();
    const groups = lineGroups();
    expect(groups).toHaveLength(1);
    const desc = screen.getByPlaceholderText(/item description/i) as HTMLInputElement;
    expect(desc.value).toBe("");
  });

  it("'Add line' appends a new empty line at the bottom", async () => {
    const user = userEvent.setup();
    openModal();
    expect(lineGroups()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /add line/i }));
    expect(lineGroups()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: /add line/i }));
    expect(lineGroups()).toHaveLength(3);
  });

  it("× on a non-last line removes it; remaining lines re-key cleanly", async () => {
    const user = userEvent.setup();
    openModal();

    await user.click(screen.getByRole("button", { name: /add line/i }));
    await user.click(screen.getByRole("button", { name: /add line/i }));
    expect(lineGroups()).toHaveLength(3);

    await user.type(
      screen.getByLabelText(/^line 1$/i).querySelector("input")!,
      "FIRST",
    );
    await user.type(
      screen.getByLabelText(/^line 3$/i).querySelector("input")!,
      "THIRD",
    );

    await user.click(screen.getByRole("button", { name: /remove line 2/i }));

    const groups = lineGroups();
    expect(groups).toHaveLength(2);
    const line2DescInput = within(groups[1]).getByRole("textbox") as HTMLInputElement;
    expect(line2DescInput.value).toBe("THIRD");
    const line1DescInput = within(groups[0]).getByRole("textbox") as HTMLInputElement;
    expect(line1DescInput.value).toBe("FIRST");
  });

  it("× on the sole remaining line is disabled", () => {
    openModal();
    const removeBtn = screen.getByRole("button", { name: /remove line 1/i });
    expect(removeBtn).toBeDisabled();
  });

  it("× becomes enabled once a second line is added", async () => {
    const user = userEvent.setup();
    openModal();
    expect(
      screen.getByRole("button", { name: /remove line 1/i }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /add line/i }));

    expect(
      screen.getByRole("button", { name: /remove line 1/i }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /remove line 2/i }),
    ).toBeEnabled();
  });

  it("submitting with an empty line description surfaces an inline error and does NOT call the action", async () => {
    const user = userEvent.setup();
    openModal();

    await user.type(
      screen.getByPlaceholderText(/supplier name or walk-in/i),
      "Walkin Vendor",
    );

    await user.type(
      screen
        .getByLabelText(/^line 1$/i)
        .querySelector('input[type="number"]')!,
      "1",
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const line1 = screen.getByRole("group", { name: /^line 1$/i });
    expect(within(line1).getByText(/item description is required/i)).toBeInTheDocument();
    expect(createPurchase).not.toHaveBeenCalled();
  });
});
