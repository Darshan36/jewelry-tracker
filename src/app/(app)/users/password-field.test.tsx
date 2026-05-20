import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PasswordField } from "./password-field";

describe("PasswordField — show/hide toggle", () => {
  it("starts hidden (type=password, Eye icon visible)", () => {
    render(<PasswordField id="pw" defaultValue="secret123" />);
    const input = document.getElementById("pw") as HTMLInputElement;
    expect(input.type).toBe("password");
    const btn = screen.getByTestId("password-toggle");
    expect(btn).toHaveAttribute("aria-label", "Show password");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("click toggles type=password → type=text (and back)", async () => {
    const user = userEvent.setup();
    render(<PasswordField id="pw" defaultValue="secret123" />);
    const input = document.getElementById("pw") as HTMLInputElement;
    const btn = screen.getByTestId("password-toggle");

    await user.click(btn);
    expect(input.type).toBe("text");
    expect(btn).toHaveAttribute("aria-label", "Hide password");
    expect(btn).toHaveAttribute("aria-pressed", "true");

    await user.click(btn);
    expect(input.type).toBe("password");
    expect(btn).toHaveAttribute("aria-label", "Show password");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  it("two PasswordFields toggle independently", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PasswordField id="pw1" />
        <PasswordField id="pw2" />
      </>,
    );
    const input1 = document.getElementById("pw1") as HTMLInputElement;
    const input2 = document.getElementById("pw2") as HTMLInputElement;
    const [btn1, btn2] = screen.getAllByTestId("password-toggle");

    await user.click(btn1);
    expect(input1.type).toBe("text");
    expect(input2.type).toBe("password"); // unaffected

    await user.click(btn2);
    expect(input1.type).toBe("text");
    expect(input2.type).toBe("text");

    await user.click(btn1);
    expect(input1.type).toBe("password");
    expect(input2.type).toBe("text");
  });

  it("button is type='button' (does NOT submit a parent form)", () => {
    render(<PasswordField id="pw" />);
    const btn = screen.getByTestId("password-toggle");
    expect(btn).toHaveAttribute("type", "button");
  });
});
