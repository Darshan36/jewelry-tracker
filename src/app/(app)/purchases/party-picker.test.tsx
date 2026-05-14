import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PartyPicker,
  type SupplierOption,
  type PartyValue,
} from "./party-picker";

const suppliers: SupplierOption[] = [
  { id: "s1", name: "Acme Metals", phone: "9111111111" },
  { id: "s2", name: "Bombay Tools", phone: "9222222222" },
  { id: "s3", name: "Crown Polish", phone: "9333333333" },
];

const walkInValue: PartyValue = {
  supplierId: null,
  partyName: "",
  partyPhone: null,
};

function setupRender(initialValue: PartyValue = walkInValue) {
  const onChange = vi.fn();
  const utils = render(
    <PartyPicker
      suppliers={suppliers}
      value={initialValue}
      onChange={onChange}
    />,
  );
  return { onChange, ...utils };
}

describe("PartyPicker (Purchases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("walk-in mode (supplierId null)", () => {
    it("renders the party-name input + phone input, no chip", () => {
      setupRender();
      expect(
        screen.getByPlaceholderText(/supplier name or walk-in/i),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/phone \(optional\)/i)).toBeInTheDocument();
      expect(
        screen.queryByLabelText(/clear linked supplier/i),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/^Party\s*$/i)).toBeInTheDocument();
    });

    it("shows no dropdown when the input is empty", async () => {
      setupRender();
      await userEvent.click(screen.getByPlaceholderText(/supplier name or walk-in/i));
      expect(screen.queryByText(/use as walk-in:/i)).not.toBeInTheDocument();
    });

    it("opens the dropdown with matching suppliers when the user types", async () => {
      const { onChange } = setupRender();
      const input = screen.getByPlaceholderText(/supplier name or walk-in/i);
      await userEvent.type(input, "a");

      expect(onChange).toHaveBeenCalled();
    });

    it("filters suppliers by partial name match (case-insensitive)", () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          suppliers={suppliers}
          value={{ supplierId: null, partyName: "acm", partyPhone: null }}
          onChange={onChange}
        />,
      );
      const input = screen.getByPlaceholderText(/supplier name or walk-in/i);
      fireEvent.focus(input);
      expect(screen.getByText("Acme Metals")).toBeInTheDocument();
      expect(screen.queryByText("Bombay Tools")).not.toBeInTheDocument();
      expect(screen.getByText(/use as walk-in:/i)).toBeInTheDocument();
    });

    it("filters suppliers by phone substring", () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          suppliers={suppliers}
          value={{ supplierId: null, partyName: "92222", partyPhone: null }}
          onChange={onChange}
        />,
      );
      const input = screen.getByPlaceholderText(/supplier name or walk-in/i);
      fireEvent.focus(input);
      expect(screen.getByText("Bombay Tools")).toBeInTheDocument();
      expect(screen.queryByText("Acme Metals")).not.toBeInTheDocument();
    });

    it("clicking a supplier match calls onChange with that supplier's id/name/phone", async () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          suppliers={suppliers}
          value={{ supplierId: null, partyName: "Acm", partyPhone: null }}
          onChange={onChange}
        />,
      );
      const input = screen.getByPlaceholderText(/supplier name or walk-in/i);
      fireEvent.focus(input);
      const acmeRow = screen.getByText("Acme Metals").closest("button");
      expect(acmeRow).not.toBeNull();
      await userEvent.click(acmeRow!);
      expect(onChange).toHaveBeenCalledWith({
        supplierId: "s1",
        partyName: "Acme Metals",
        partyPhone: "9111111111",
      });
    });

    it("clicking 'Use as walk-in' just closes the dropdown (typed text already is partyName)", async () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          suppliers={suppliers}
          value={{ supplierId: null, partyName: "Walkin Vendor", partyPhone: null }}
          onChange={onChange}
        />,
      );
      const input = screen.getByPlaceholderText(/supplier name or walk-in/i);
      fireEvent.focus(input);
      const walkInBtn = screen.getByText(/use as walk-in:/i).closest("button");
      expect(walkInBtn).not.toBeNull();
      await userEvent.click(walkInBtn!);
      expect(screen.queryByText(/use as walk-in:/i)).not.toBeInTheDocument();
    });
  });

  describe("linked-supplier mode (supplierId set)", () => {
    const linkedValue: PartyValue = {
      supplierId: "s1",
      partyName: "Acme Metals",
      partyPhone: "9111111111",
    };

    it("renders the chip with the supplier's name + clear button, no input visible", () => {
      render(
        <PartyPicker
          suppliers={suppliers}
          value={linkedValue}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText("Acme Metals")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /clear linked supplier/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText(/supplier name or walk-in/i),
      ).not.toBeInTheDocument();
    });

    it("clicking × calls onChange with cleared values (null supplierId, empty name, null phone)", async () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          suppliers={suppliers}
          value={linkedValue}
          onChange={onChange}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: /clear linked supplier/i }),
      );
      expect(onChange).toHaveBeenCalledWith({
        supplierId: null,
        partyName: "",
        partyPhone: null,
      });
    });

    it("displays the linked supplier's phone beside the chip (when present)", () => {
      render(
        <PartyPicker
          suppliers={suppliers}
          value={linkedValue}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText("9111111111")).toBeInTheDocument();
    });

    it("renders an error message when the `error` prop is set", () => {
      render(
        <PartyPicker
          suppliers={suppliers}
          value={linkedValue}
          onChange={vi.fn()}
          error="Something is wrong with the party"
        />,
      );
      expect(
        screen.getByText("Something is wrong with the party"),
      ).toBeInTheDocument();
    });
  });
});
