import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  upsertShopSettings: vi.fn(),
}));

import { upsertShopSettings } from "./actions";
import { SettingsForm } from "./settings-form";
import type { ShopSettingsForClient } from "./types";

function makeSettings(
  overrides: Partial<ShopSettingsForClient> = {},
): ShopSettingsForClient {
  return {
    id: "settings-1",
    shopName: "Existing Shop",
    phone: "+91 99999 11111",
    address: "12 Existing Street",
    footer: "Existing footer",
    updatedById: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsForm — first-time rendering (no existing settings)", () => {
  it("renders empty inputs when initialSettings is null", () => {
    render(<SettingsForm initialSettings={null} />);
    expect(screen.getByLabelText(/shop name/i)).toHaveValue("");
    expect(screen.getByLabelText(/phone/i)).toHaveValue("");
    expect(screen.getByLabelText(/address/i)).toHaveValue("");
    expect(screen.getByLabelText(/footer line/i)).toHaveValue("");
  });

  it("save button reads 'Save settings' on first-time", () => {
    render(<SettingsForm initialSettings={null} />);
    expect(
      screen.getByRole("button", { name: /save settings/i }),
    ).toBeInTheDocument();
  });
});

describe("SettingsForm — pre-fill mode (existing settings)", () => {
  it("pre-fills inputs from initialSettings", () => {
    render(<SettingsForm initialSettings={makeSettings()} />);
    expect(screen.getByLabelText(/shop name/i)).toHaveValue("Existing Shop");
    expect(screen.getByLabelText(/phone/i)).toHaveValue("+91 99999 11111");
    expect(screen.getByLabelText(/address/i)).toHaveValue("12 Existing Street");
    expect(screen.getByLabelText(/footer line/i)).toHaveValue("Existing footer");
  });

  it("save button reads 'Save changes' in edit mode", () => {
    render(<SettingsForm initialSettings={makeSettings()} />);
    expect(
      screen.getByRole("button", { name: /save changes/i }),
    ).toBeInTheDocument();
  });

  it("treats null phone/address/footer as empty strings (no 'null' literal in inputs)", () => {
    render(
      <SettingsForm
        initialSettings={makeSettings({
          phone: null,
          address: null,
          footer: null,
        })}
      />,
    );
    expect(screen.getByLabelText(/phone/i)).toHaveValue("");
    expect(screen.getByLabelText(/address/i)).toHaveValue("");
    expect(screen.getByLabelText(/footer line/i)).toHaveValue("");
  });
});

describe("SettingsForm — save behavior", () => {
  it("calls upsertShopSettings with parsed input on save", async () => {
    const user = userEvent.setup();
    vi.mocked(upsertShopSettings).mockResolvedValueOnce({
      ok: true,
      settings: makeSettings(),
    });

    render(<SettingsForm initialSettings={null} />);

    await user.type(screen.getByLabelText(/shop name/i), "Acme Jewels");
    await user.type(screen.getByLabelText(/phone/i), "+91 98765 00000");
    await user.type(screen.getByLabelText(/footer line/i), "Thanks!");
    await user.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(upsertShopSettings).toHaveBeenCalledTimes(1);
    });
    expect(upsertShopSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        shopName: "Acme Jewels",
        phone: "+91 98765 00000",
        footer: "Thanks!",
      }),
    );
  });

  it("surfaces success banner after a successful save", async () => {
    const user = userEvent.setup();
    vi.mocked(upsertShopSettings).mockResolvedValueOnce({
      ok: true,
      settings: makeSettings({ shopName: "Saved" }),
    });

    render(<SettingsForm initialSettings={null} />);
    await user.type(screen.getByLabelText(/shop name/i), "Saved");
    await user.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(
        screen.getByTestId("settings-saved-banner"),
      ).toBeInTheDocument();
    });
  });

  it("surfaces field-keyed server error on the shopName input", async () => {
    const user = userEvent.setup();
    vi.mocked(upsertShopSettings).mockResolvedValueOnce({
      ok: false,
      errors: { shopName: ["Shop name is required"] },
    });

    render(<SettingsForm initialSettings={null} />);
    await user.type(screen.getByLabelText(/shop name/i), "X");
    await user.click(screen.getByTestId("settings-save"));

    await waitFor(() => {
      expect(screen.getByText("Shop name is required")).toBeInTheDocument();
    });
  });

  it("rejects client-side when shopName is empty (zod min-1)", async () => {
    const user = userEvent.setup();
    render(<SettingsForm initialSettings={null} />);
    // Submit without typing anything
    await user.click(screen.getByTestId("settings-save"));
    await waitFor(() => {
      expect(screen.getByText(/shop name is required/i)).toBeInTheDocument();
    });
    expect(upsertShopSettings).not.toHaveBeenCalled();
  });
});
