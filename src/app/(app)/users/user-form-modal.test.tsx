import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock("./actions", () => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));

import { createUser, updateUser } from "./actions";
import { UserFormModal } from "./user-form-modal";
import type { UserForClient } from "./types";

function makeUser(overrides: Partial<UserForClient> = {}): UserForClient {
  return {
    id: "u-1",
    email: "user@example.com",
    name: "Existing User",
    role: "PURCHASE_DEPT",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UserFormModal — create mode", () => {
  it("shows the create form with password fields", () => {
    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={undefined}
        currentUserId="admin-1"
      />,
    );

    expect(screen.getByRole("heading", { name: /add user/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^confirm password/i)).toBeInTheDocument();
  });

  it("submits createUser with correct payload on save", async () => {
    const user = userEvent.setup();
    vi.mocked(createUser).mockResolvedValue({
      ok: true,
      user: makeUser({ id: "new", email: "new@example.com" }),
    });

    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={undefined}
        currentUserId="admin-1"
      />,
    );

    await user.type(screen.getByLabelText(/^name/i), "Alice New");
    await user.type(screen.getByLabelText(/^email/i), "alice@new.com");
    await user.type(screen.getByLabelText(/^password/i), "longEnough12");
    await user.type(screen.getByLabelText(/^confirm password/i), "longEnough12");
    // Pick a role
    await user.click(screen.getByTestId("role-option-LABOUR_MGMT"));

    await user.click(screen.getByTestId("user-form-save"));

    await waitFor(() => expect(createUser).toHaveBeenCalledTimes(1));
    expect(createUser).toHaveBeenCalledWith({
      name: "Alice New",
      email: "alice@new.com",
      password: "longEnough12",
      role: "LABOUR_MGMT",
    });
  });

  it("rejects when passwords don't match", async () => {
    const user = userEvent.setup();

    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={undefined}
        currentUserId="admin-1"
      />,
    );

    await user.type(screen.getByLabelText(/^name/i), "Alice");
    await user.type(screen.getByLabelText(/^email/i), "a@b.com");
    await user.type(screen.getByLabelText(/^password/i), "longEnough12");
    await user.type(screen.getByLabelText(/^confirm password/i), "different123");

    await user.click(screen.getByTestId("user-form-save"));

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe("UserFormModal — edit mode", () => {
  it("shows the edit form pre-filled with user data; no password fields", () => {
    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={makeUser({ name: "Existing", email: "ex@shop.test", role: "ADMIN" })}
        currentUserId="someone-else"
      />,
    );

    expect(screen.getByRole("heading", { name: /edit user/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Existing")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ex@shop.test")).toBeInTheDocument();
    // No password fields in edit mode
    expect(screen.queryByLabelText(/^password/i)).toBeNull();
  });

  it("submits updateUser with the user id and patched fields", async () => {
    const user = userEvent.setup();
    vi.mocked(updateUser).mockResolvedValue({
      ok: true,
      user: makeUser({ id: "u-1", name: "Renamed" }),
    });

    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={makeUser({ id: "u-1", name: "Existing", role: "PURCHASE_DEPT" })}
        currentUserId="someone-else"
      />,
    );

    const nameInput = screen.getByLabelText(/^name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");
    await user.click(screen.getByTestId("user-form-save"));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser).toHaveBeenCalledWith(
      "u-1",
      expect.objectContaining({ name: "Renamed", role: "PURCHASE_DEPT" }),
    );
  });

  // ----- G2: self-protection UI -----
  it("G2 — own-account edit DISABLES the role selector buttons", () => {
    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={makeUser({ id: "self-1", role: "ADMIN" })}
        currentUserId="self-1"
      />,
    );

    expect(screen.getByTestId("role-option-ADMIN")).toBeDisabled();
    expect(screen.getByTestId("role-option-PURCHASE_DEPT")).toBeDisabled();
    expect(screen.getByTestId("role-option-LABOUR_MGMT")).toBeDisabled();
    expect(screen.getByTestId("role-option-CASTING_PLATING_MGMT")).toBeDisabled();

    // Notice visible
    expect(screen.getByTestId("self-role-notice")).toBeInTheDocument();
  });

  it("G2 — editing OTHER users keeps role selector ENABLED", () => {
    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={makeUser({ id: "other-1", role: "PURCHASE_DEPT" })}
        currentUserId="self-1"
      />,
    );

    expect(screen.getByTestId("role-option-ADMIN")).not.toBeDisabled();
    expect(screen.queryByTestId("self-role-notice")).toBeNull();
  });

  it("surfaces server-side G2/G3 rejection in the form's role field", async () => {
    const user = userEvent.setup();
    vi.mocked(updateUser).mockResolvedValueOnce({
      ok: false,
      errors: {
        role: [
          "Cannot demote the only active administrator. Promote another user to ADMIN first.",
        ],
      },
    });

    render(
      <UserFormModal
        open
        onOpenChange={() => {}}
        user={makeUser({ id: "u-1", role: "ADMIN" })}
        currentUserId="someone-else"
      />,
    );

    await user.click(screen.getByTestId("role-option-PURCHASE_DEPT"));
    await user.click(screen.getByTestId("user-form-save"));

    await waitFor(() => {
      expect(
        screen.getByText(/only active administrator/i),
      ).toBeInTheDocument();
    });
  });
});
