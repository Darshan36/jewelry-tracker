import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/users",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./actions", () => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
}));

import { UsersTable } from "./users-table";
import type { UserForClient } from "./types";

function makeUser(overrides: Partial<UserForClient> = {}): UserForClient {
  return {
    id: "u-1",
    email: "default@example.com",
    name: "Default User",
    role: "PURCHASE_DEPT",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function mixedUsers(): UserForClient[] {
  return [
    makeUser({ id: "admin-1", name: "Owner", email: "admin@shop.test", role: "ADMIN" }),
    makeUser({ id: "p-1", name: "Pat", email: "pat@shop.test", role: "PURCHASE_DEPT" }),
    makeUser({
      id: "deactivated",
      name: "Ex Employee",
      email: "ex@shop.test",
      role: "LABOUR_MGMT",
      deletedAt: new Date("2026-04-01T00:00:00Z"),
    }),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("UsersTable — rendering", () => {
  it("renders one row per user with name, email, role chip, and status chip", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);

    // Three rows
    expect(screen.getByTestId("user-row-admin-1")).toBeInTheDocument();
    expect(screen.getByTestId("user-row-p-1")).toBeInTheDocument();
    expect(screen.getByTestId("user-row-deactivated")).toBeInTheDocument();

    // Each row's email visible
    expect(screen.getByText("admin@shop.test")).toBeInTheDocument();
    expect(screen.getByText("pat@shop.test")).toBeInTheDocument();
    expect(screen.getByText("ex@shop.test")).toBeInTheDocument();
  });

  it("shows '(you)' tag on the current user's row", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const adminRow = screen.getByTestId("user-row-admin-1");
    expect(within(adminRow).getByText("(you)")).toBeInTheDocument();
  });

  it("renders Active chip on non-deleted users and Inactive chip on deactivated", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);

    const activeRow = screen.getByTestId("user-row-admin-1");
    expect(within(activeRow).getByText("Active")).toBeInTheDocument();

    const inactiveRow = screen.getByTestId("user-row-deactivated");
    expect(within(inactiveRow).getByText("Inactive")).toBeInTheDocument();
  });

  it("renders empty-state when no users", () => {
    render(<UsersTable users={[]} currentUserId="admin-1" />);
    expect(screen.getByText(/no users yet/i)).toBeInTheDocument();
  });
});

describe("UsersTable — self-protection UI (G1)", () => {
  it("Deactivate button is DISABLED on the current user's row", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const selfDeactivate = screen.getByTestId("deactivate-user-admin-1");
    expect(selfDeactivate).toBeDisabled();
    // Title attribute carries the user-facing explanation.
    expect(selfDeactivate).toHaveAttribute(
      "title",
      "You cannot deactivate your own account",
    );
  });

  it("Deactivate button is enabled on OTHER active users", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const otherDeactivate = screen.getByTestId("deactivate-user-p-1");
    expect(otherDeactivate).not.toBeDisabled();
  });

  it("deactivated user's row shows Reactivate button instead of Deactivate", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    expect(screen.getByTestId("reactivate-user-deactivated")).toBeInTheDocument();
    expect(screen.queryByTestId("deactivate-user-deactivated")).toBeNull();
  });
});

describe("UsersTable — search filter", () => {
  it("filters by name", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const searchInput = screen.getByPlaceholderText(/search users/i);
    await user.type(searchInput, "Pat");

    expect(screen.queryByTestId("user-row-admin-1")).toBeNull();
    expect(screen.getByTestId("user-row-p-1")).toBeInTheDocument();
    expect(screen.queryByTestId("user-row-deactivated")).toBeNull();
  });

  it("filters by email", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const searchInput = screen.getByPlaceholderText(/search users/i);
    await user.type(searchInput, "ex@");

    expect(screen.queryByTestId("user-row-admin-1")).toBeNull();
    expect(screen.queryByTestId("user-row-p-1")).toBeNull();
    expect(screen.getByTestId("user-row-deactivated")).toBeInTheDocument();
  });

  it("shows 'no users match your search' when filter yields nothing", async () => {
    const user = userEvent.setup();
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const searchInput = screen.getByPlaceholderText(/search users/i);
    await user.type(searchInput, "zzz-nomatch");
    expect(screen.getByText(/no users match your search/i)).toBeInTheDocument();
  });
});
