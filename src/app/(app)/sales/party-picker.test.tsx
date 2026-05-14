import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PartyPicker,
  type CustomerOption,
  type PartyValue,
} from "./party-picker";

const customers: CustomerOption[] = [
  { id: "c1", name: "Alice Anand", phone: "9111111111" },
  { id: "c2", name: "Bob Bose", phone: "9222222222" },
  { id: "c3", name: "Cara Chen", phone: "9333333333" },
];

const walkInValue: PartyValue = {
  customerId: null,
  partyName: "",
  partyPhone: null,
};

function setupRender(initialValue: PartyValue = walkInValue) {
  const onChange = vi.fn();
  const utils = render(
    <PartyPicker
      customers={customers}
      value={initialValue}
      onChange={onChange}
    />,
  );
  return { onChange, ...utils };
}

describe("PartyPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("walk-in mode (customerId null)", () => {
    it("renders the party-name input + phone input, no chip", () => {
      setupRender();
      expect(screen.getByPlaceholderText(/customer name or walk-in/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/phone \(optional\)/i)).toBeInTheDocument();
      expect(
        screen.queryByLabelText(/clear linked customer/i),
      ).not.toBeInTheDocument();
      // Party label is present (split text — "Party" + asterisk span)
      expect(screen.getByText(/^Party\s*$/i)).toBeInTheDocument();
    });

    it("shows no dropdown when the input is empty", async () => {
      setupRender();
      // Focus the input but type nothing — dropdown should not appear
      await userEvent.click(screen.getByPlaceholderText(/customer name or walk-in/i));
      expect(screen.queryByText(/use as walk-in:/i)).not.toBeInTheDocument();
    });

    it("opens the dropdown with matching customers when the user types", async () => {
      const { onChange } = setupRender();
      const input = screen.getByPlaceholderText(/customer name or walk-in/i);
      await userEvent.type(input, "a");

      // onChange was called for each keystroke
      expect(onChange).toHaveBeenCalled();
      // We can't observe filtered matches without the parent re-rendering with
      // the new value, so we rerender with an updated value to simulate the
      // controlled parent. Verify in the next test.
    });

    it("filters customers by partial name match (case-insensitive)", () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          customers={customers}
          value={{ customerId: null, partyName: "ali", partyPhone: null }}
          onChange={onChange}
        />,
      );
      // Manually focus the input so the dropdown opens (component's onFocus opens it)
      const input = screen.getByPlaceholderText(/customer name or walk-in/i);
      fireEvent.focus(input);
      // Dropdown should now show — at least the walk-in option
      // and Alice Anand as a match
      expect(screen.getByText("Alice Anand")).toBeInTheDocument();
      expect(screen.queryByText("Bob Bose")).not.toBeInTheDocument();
      expect(screen.getByText(/use as walk-in:/i)).toBeInTheDocument();
    });

    it("filters customers by phone substring", () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          customers={customers}
          value={{ customerId: null, partyName: "92222", partyPhone: null }}
          onChange={onChange}
        />,
      );
      const input = screen.getByPlaceholderText(/customer name or walk-in/i);
      fireEvent.focus(input);
      expect(screen.getByText("Bob Bose")).toBeInTheDocument();
      expect(screen.queryByText("Alice Anand")).not.toBeInTheDocument();
    });

    it("clicking a customer match calls onChange with that customer's id/name/phone", async () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          customers={customers}
          value={{ customerId: null, partyName: "Ali", partyPhone: null }}
          onChange={onChange}
        />,
      );
      const input = screen.getByPlaceholderText(/customer name or walk-in/i);
      fireEvent.focus(input);
      const aliceRow = screen.getByText("Alice Anand").closest("button");
      expect(aliceRow).not.toBeNull();
      await userEvent.click(aliceRow!);
      expect(onChange).toHaveBeenCalledWith({
        customerId: "c1",
        partyName: "Alice Anand",
        partyPhone: "9111111111",
      });
    });

    it("clicking 'Use as walk-in' just closes the dropdown (typed text already is partyName)", async () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          customers={customers}
          value={{ customerId: null, partyName: "Walkin Person", partyPhone: null }}
          onChange={onChange}
        />,
      );
      const input = screen.getByPlaceholderText(/customer name or walk-in/i);
      fireEvent.focus(input);
      const walkInBtn = screen.getByText(/use as walk-in:/i).closest("button");
      expect(walkInBtn).not.toBeNull();
      await userEvent.click(walkInBtn!);
      // After click, the dropdown's walk-in trigger should be gone
      expect(screen.queryByText(/use as walk-in:/i)).not.toBeInTheDocument();
    });
  });

  describe("linked-customer mode (customerId set)", () => {
    const linkedValue: PartyValue = {
      customerId: "c1",
      partyName: "Alice Anand",
      partyPhone: "9111111111",
    };

    it("renders the chip with the customer's name + clear button, no input visible", () => {
      render(
        <PartyPicker
          customers={customers}
          value={linkedValue}
          onChange={vi.fn()}
        />,
      );
      // Chip text
      expect(screen.getByText("Alice Anand")).toBeInTheDocument();
      // Clear (×) button
      expect(
        screen.getByRole("button", { name: /clear linked customer/i }),
      ).toBeInTheDocument();
      // The plain text input is NOT rendered in linked mode
      expect(
        screen.queryByPlaceholderText(/customer name or walk-in/i),
      ).not.toBeInTheDocument();
    });

    it("clicking × calls onChange with cleared values (null customerId, empty name, null phone)", async () => {
      const onChange = vi.fn();
      render(
        <PartyPicker
          customers={customers}
          value={linkedValue}
          onChange={onChange}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: /clear linked customer/i }),
      );
      expect(onChange).toHaveBeenCalledWith({
        customerId: null,
        partyName: "",
        partyPhone: null,
      });
    });

    it("displays the linked customer's phone beside the chip (when present)", () => {
      render(
        <PartyPicker
          customers={customers}
          value={linkedValue}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByText("9111111111")).toBeInTheDocument();
    });

    it("renders an error message when the `error` prop is set", () => {
      render(
        <PartyPicker
          customers={customers}
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
