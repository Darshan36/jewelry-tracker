// Tests for SaveDropdown. The split-button structure (primary "Save and
// return" + chevron-dropdown "Save and add another") is small but
// load-bearing — it's the primary mutation surface on the form pages.
//
// The biggest correctness concern is the saveMode-stale-closure bug
// caught during the Phase 10 walkthrough: a caller that does
// `setSaveMode(m); handleSubmit(onSubmit)()` synchronously inside the
// `onSave` callback ends up reading the *previous* state value inside
// the submit closure. The fix was to use a ref for the mode and
// pass it through onSave. These tests pin that invariant by
// verifying onSave is called with the correct SaveMode every time —
// the consumer-side ref pattern is documented in sale-form.tsx.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SaveDropdown, type SaveMode } from "./save-dropdown";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SaveDropdown — primary action", () => {
  it("renders the primary 'Save and return' label by default", () => {
    render(<SaveDropdown onSave={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /^save and return$/i }),
    ).toBeInTheDocument();
  });

  it("supports a custom primary label", () => {
    render(<SaveDropdown onSave={vi.fn()} primaryLabel="Custom save" />);
    expect(
      screen.getByRole("button", { name: /custom save/i }),
    ).toBeInTheDocument();
  });

  it("clicking the primary button fires onSave with 'return' mode", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SaveDropdown onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /save and return/i }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith("return" as SaveMode);
  });

  it("disables the primary button when `disabled` prop is true", () => {
    render(<SaveDropdown onSave={vi.fn()} disabled />);
    expect(
      screen.getByRole("button", { name: /save and return/i }),
    ).toBeDisabled();
  });

  it("renders a 'Saving…' indicator when `saving` is true", () => {
    render(<SaveDropdown onSave={vi.fn()} saving />);
    expect(screen.getByText(/saving…/i)).toBeInTheDocument();
  });
});

describe("SaveDropdown — secondary action via dropdown", () => {
  it("dropdown menu is hidden by default", () => {
    render(<SaveDropdown onSave={vi.fn()} />);
    expect(
      screen.queryByRole("menuitem", { name: /save and add another/i }),
    ).not.toBeInTheDocument();
  });

  it("clicking the chevron opens the dropdown menu", async () => {
    const user = userEvent.setup();
    render(<SaveDropdown onSave={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /more save options/i }));

    expect(
      screen.getByRole("menuitem", { name: /save and add another/i }),
    ).toBeInTheDocument();
  });

  it("clicking 'Save and add another' fires onSave with 'another' mode", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SaveDropdown onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /more save options/i }));
    await user.click(
      screen.getByRole("menuitem", { name: /save and add another/i }),
    );

    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith("another" as SaveMode);
  });

  it("clicking 'Save and add another' closes the dropdown after firing", async () => {
    const user = userEvent.setup();
    render(<SaveDropdown onSave={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /more save options/i }));
    await user.click(
      screen.getByRole("menuitem", { name: /save and add another/i }),
    );

    expect(
      screen.queryByRole("menuitem", { name: /save and add another/i }),
    ).not.toBeInTheDocument();
  });
});

describe("SaveDropdown — accessibility", () => {
  it("the chevron button has aria-haspopup='menu'", async () => {
    render(<SaveDropdown onSave={vi.fn()} />);
    const chevron = screen.getByRole("button", { name: /more save options/i });
    expect(chevron.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("aria-expanded toggles to true when the dropdown opens", async () => {
    const user = userEvent.setup();
    render(<SaveDropdown onSave={vi.fn()} />);
    const chevron = screen.getByRole("button", { name: /more save options/i });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    await user.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
  });
});

// =====================================================================
// Stale-closure regression coverage
// =====================================================================
//
// The walkthrough caught a stale-closure bug where the consumer was
// reading `saveMode` from React state, set immediately before calling
// `handleSubmit`. The fix was to use a ref for the mode so the
// subsequent submit closure could read the latest value.
//
// SaveDropdown itself doesn't own that state — it just calls onSave
// with the mode. The regression-critical contract is:
//
//   - Each click on a different button produces an onSave call with
//     THE MODE OF THAT BUTTON, not the mode of any previous click.
//   - Rapid back-to-back clicks each produce distinct onSave calls
//     with their respective modes (no debouncing collapses them).
//   - Clicking primary after clicking "another" (and vice versa) is
//     correctly dispatched per-click.
//
// If anyone refactors the dropdown to short-circuit onSave with a
// captured mode (e.g., "remember the last click and reuse"), these
// tests fail.

describe("SaveDropdown — stale-closure regression coverage", () => {
  it("clicking primary then dropdown emits onSave('return') then onSave('another')", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SaveDropdown onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /save and return/i }));
    await user.click(screen.getByRole("button", { name: /more save options/i }));
    await user.click(
      screen.getByRole("menuitem", { name: /save and add another/i }),
    );

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0][0]).toBe("return");
    expect(onSave.mock.calls[1][0]).toBe("another");
  });

  it("clicking dropdown then primary emits onSave('another') then onSave('return')", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SaveDropdown onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: /more save options/i }));
    await user.click(
      screen.getByRole("menuitem", { name: /save and add another/i }),
    );
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0][0]).toBe("another");
    expect(onSave.mock.calls[1][0]).toBe("return");
  });

  it("repeated 'Save and add another' clicks each emit onSave('another') — never collapse modes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<SaveDropdown onSave={onSave} />);

    // Open + click 3 times in succession.
    for (let i = 0; i < 3; i++) {
      await user.click(
        screen.getByRole("button", { name: /more save options/i }),
      );
      await user.click(
        screen.getByRole("menuitem", { name: /save and add another/i }),
      );
    }

    expect(onSave).toHaveBeenCalledTimes(3);
    expect(onSave.mock.calls.every(([m]) => m === "another")).toBe(true);
  });

  it("consumer's onSave receives the mode synchronously (no Promise wrapper required)", async () => {
    // The consumer (SaleForm) sets saveModeRef.current = mode synchronously
    // before calling handleSubmit(onSubmit)(). The dropdown's onSave is
    // synchronous; this test pins that behaviour so a future refactor
    // to async-batch the click handlers doesn't break the contract.
    const user = userEvent.setup();
    let observedMode: SaveMode | null = null;
    const onSave = vi.fn((mode: SaveMode) => {
      observedMode = mode;
    });

    render(<SaveDropdown onSave={onSave} />);
    await user.click(screen.getByRole("button", { name: /save and return/i }));

    expect(observedMode).toBe("return");
  });
});
