import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/app/(app)/labour/karigar-ledger-actions", () => ({
  createKarigarLedgerEntry: vi.fn(),
  updateKarigarLedgerEntry: vi.fn(),
}));

import {
  createKarigarLedgerEntry,
  updateKarigarLedgerEntry,
} from "@/app/(app)/labour/karigar-ledger-actions";
import { KarigarLedgerEntryModal } from "./karigar-ledger-entry-modal";

const employee = { id: "lab1", name: "Ajay Bhai" };

beforeEach(() => {
  vi.mocked(createKarigarLedgerEntry).mockReset();
  vi.mocked(updateKarigarLedgerEntry).mockReset();
});

describe("KarigarLedgerEntryModal — create mode", () => {
  it("defaults to DECREASE (advance — the common case)", () => {
    render(
      <KarigarLedgerEntryModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
      />,
    );
    const decrease = screen.getByTestId(
      "karigar-ledger-direction-decrease",
    ) as HTMLInputElement;
    expect(decrease.checked).toBe(true);
    const increase = screen.getByTestId(
      "karigar-ledger-direction-increase",
    ) as HTMLInputElement;
    expect(increase.checked).toBe(false);
  });

  it("submits createKarigarLedgerEntry with user-picked direction + required description", async () => {
    vi.mocked(createKarigarLedgerEntry).mockResolvedValue({
      ok: true,
      entryId: "le-1",
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <KarigarLedgerEntryModal
        open
        onClose={onClose}
        onSaved={onSaved}
        employee={employee}
      />,
    );

    await user.type(screen.getByLabelText(/Amount/i), "6000");
    await user.type(
      screen.getByLabelText(/Description/i),
      "advance for next week",
    );
    await user.click(screen.getByTestId("karigar-ledger-save"));

    await waitFor(() => {
      expect(createKarigarLedgerEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: "lab1",
          amount: 6000,
          direction: "DECREASE",
          description: "advance for next week",
        }),
      );
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("can switch direction to INCREASE before saving", async () => {
    vi.mocked(createKarigarLedgerEntry).mockResolvedValue({
      ok: true,
      entryId: "le-1",
    });
    const user = userEvent.setup();

    render(
      <KarigarLedgerEntryModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
      />,
    );

    await user.click(screen.getByTestId("karigar-ledger-direction-increase"));
    await user.type(screen.getByLabelText(/Amount/i), "2000");
    await user.type(
      screen.getByLabelText(/Description/i),
      "opening balance — prior work",
    );
    await user.click(screen.getByTestId("karigar-ledger-save"));

    await waitFor(() => {
      expect(createKarigarLedgerEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: "INCREASE",
        }),
      );
    });
  });

  it("blocks save while description is empty", async () => {
    const user = userEvent.setup();
    render(
      <KarigarLedgerEntryModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
      />,
    );
    await user.type(screen.getByLabelText(/Amount/i), "1000");
    const saveButton = screen.getByTestId(
      "karigar-ledger-save",
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("blocks save while amount is empty", async () => {
    const user = userEvent.setup();
    render(
      <KarigarLedgerEntryModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
      />,
    );
    await user.type(screen.getByLabelText(/Description/i), "advance");
    const saveButton = screen.getByTestId(
      "karigar-ledger-save",
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("surfaces field errors from the action", async () => {
    vi.mocked(createKarigarLedgerEntry).mockResolvedValue({
      ok: false,
      errors: { description: ["Description is required"] },
    });
    const user = userEvent.setup();

    render(
      <KarigarLedgerEntryModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
      />,
    );

    await user.type(screen.getByLabelText(/Amount/i), "1000");
    await user.type(screen.getByLabelText(/Description/i), "x");
    await user.click(screen.getByTestId("karigar-ledger-save"));

    await waitFor(() => {
      expect(screen.getByText(/Description is required/i)).toBeInTheDocument();
    });
  });
});

describe("KarigarLedgerEntryModal — edit mode", () => {
  it("prefills date/amount/direction/description from editEntry", () => {
    render(
      <KarigarLedgerEntryModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        editEntry={{
          id: "le-1",
          amountPaise: 400000,
          date: new Date("2026-05-23T00:00:00Z"),
          direction: "DECREASE",
          description: "advance — reduced",
        }}
      />,
    );
    const amount = screen.getByLabelText(/Amount/i) as HTMLInputElement;
    expect(amount.value).toBe("4000.00");
    const description = screen.getByLabelText(
      /Description/i,
    ) as HTMLTextAreaElement;
    expect(description.value).toBe("advance — reduced");
    expect(screen.getByText(/Edit ledger entry/i)).toBeInTheDocument();
    expect(screen.getByText(/Save changes/i)).toBeInTheDocument();
  });

  it("submits updateKarigarLedgerEntry with new direction + amount", async () => {
    vi.mocked(updateKarigarLedgerEntry).mockResolvedValue({
      ok: true,
      entryId: "le-1",
    });
    const user = userEvent.setup();

    render(
      <KarigarLedgerEntryModal
        open
        onClose={() => {}}
        onSaved={() => {}}
        employee={employee}
        editEntry={{
          id: "le-1",
          amountPaise: 600000,
          date: new Date("2026-05-23T00:00:00Z"),
          direction: "DECREASE",
          description: "advance",
        }}
      />,
    );

    // Switch to INCREASE.
    await user.click(screen.getByTestId("karigar-ledger-direction-increase"));
    await user.click(screen.getByTestId("karigar-ledger-save"));

    await waitFor(() => {
      expect(updateKarigarLedgerEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "le-1",
          direction: "INCREASE",
        }),
      );
    });
    expect(createKarigarLedgerEntry).not.toHaveBeenCalled();
  });
});
