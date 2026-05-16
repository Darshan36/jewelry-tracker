import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
}));

import { SaleFormModal } from "./sale-form-modal";
import { createSale } from "./actions";
import type { CustomerOption } from "./party-picker";

const customers: CustomerOption[] = [];

function openModal() {
  return render(
    <SaleFormModal
      open
      onOpenChange={() => {}}
      customers={customers}
    />,
  );
}

function lineGroups() {
  return screen.queryAllByRole("group", { name: /^Line \d+$/i });
}

describe("SaleFormModal — useFieldArray line items (Phase 7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens with exactly one empty line row", () => {
    openModal();
    const groups = lineGroups();
    expect(groups).toHaveLength(1);
    // The line's item description input is empty.
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

  it("× on a non-last line removes it; the remaining lines re-key cleanly", async () => {
    const user = userEvent.setup();
    openModal();

    // Add 2 more for a total of 3
    await user.click(screen.getByRole("button", { name: /add line/i }));
    await user.click(screen.getByRole("button", { name: /add line/i }));
    expect(lineGroups()).toHaveLength(3);

    // Fill line 1 and line 3 with distinct descriptions so we can verify
    // which one is dropped.
    await user.type(screen.getByLabelText(/^line 1$/i).querySelector("input")!, "FIRST");
    await user.type(screen.getByLabelText(/^line 3$/i).querySelector("input")!, "THIRD");

    // Remove line 2 (the middle one)
    await user.click(screen.getByRole("button", { name: /remove line 2/i }));

    const groups = lineGroups();
    expect(groups).toHaveLength(2);
    // After removal, line 2 is what used to be line 3 — its description is "THIRD".
    const line2DescInput = within(groups[1]).getByRole("textbox") as HTMLInputElement;
    expect(line2DescInput.value).toBe("THIRD");
    // line 1 still holds "FIRST"
    const line1DescInput = within(groups[0]).getByRole("textbox") as HTMLInputElement;
    expect(line1DescInput.value).toBe("FIRST");
  });

  it("× on the sole remaining line is disabled", async () => {
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

    // Fill party name (otherwise that error fires first).
    await user.type(
      screen.getByPlaceholderText(/customer name or walk-in/i),
      "Walkin",
    );

    // Leave item description empty; fill qty + rate.
    await user.type(screen.getByLabelText(/^line 1$/i).querySelector('input[type="number"]')!, "1");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // Inline error appears under line 1's description input.
    const line1 = screen.getByRole("group", { name: /^line 1$/i });
    expect(within(line1).getByText(/item description is required/i)).toBeInTheDocument();
    // Server action was never called.
    expect(createSale).not.toHaveBeenCalled();
  });
});
