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

// Phase 22.1 — ResponsiveTable chooses desktop vs mobile via useIsMobile().
// Default to desktop (false) so the existing row-based tests are unaffected;
// the mobile-card test flips it to true.
vi.mock("@/lib/use-is-mobile", () => ({
  useIsMobile: vi.fn(() => false),
}));

import { UsersTable } from "./users-table";
import { useIsMobile } from "@/lib/use-is-mobile";
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
  // Default to the desktop branch unless a test opts into mobile.
  vi.mocked(useIsMobile).mockReturnValue(false);
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
  it("Deactivate is DISABLED on your own row, with a VISIBLE reason (not a hover-only title) — Phase 22.1", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const selfDeactivate = screen.getByTestId("deactivate-user-admin-1");
    expect(selfDeactivate).toBeDisabled();
    // Phase 22.1 — the reason is VISIBLE text now; the old title="" never
    // appeared on touch.
    expect(selfDeactivate).not.toHaveAttribute("title");
    const hint = screen.getByTestId("deactivate-self-hint-admin-1");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent(/can't deactivate yourself/i);
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

// Phase 22.1 — this table has NO row-tap → modal fallback, so the row actions
// must be reachable without hover on every device.
describe("UsersTable — touch reachability (Phase 22.1)", () => {
  it("desktop row actions are NOT behind a hover-reveal (no opacity-0 group-hover gate)", () => {
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);
    const editBtn = screen.getByTestId("edit-user-p-1");
    const container = editBtn.parentElement;
    // The old cluster used "opacity-0 group-hover:opacity-100", invisible and
    // unreachable on a no-hover touch tablet. Guard against re-introducing it.
    expect(container?.className ?? "").not.toContain("opacity-0");
    expect(container?.className ?? "").not.toContain("group-hover");
  });

  it("mobile cards surface Edit / Reset / Deactivate / Reactivate actions (no hover, no separate modal needed)", () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    render(<UsersTable users={mixedUsers()} currentUserId="admin-1" />);

    // Mobile branch renders cards, not desktop rows.
    expect(screen.getByTestId("user-mobile-card-p-1")).toBeInTheDocument();

    // Other active user (Pat): edit + reset + deactivate all present + usable.
    expect(screen.getByTestId("edit-user-p-1")).toBeInTheDocument();
    expect(screen.getByTestId("reset-password-p-1")).toBeInTheDocument();
    expect(screen.getByTestId("deactivate-user-p-1")).not.toBeDisabled();

    // Deactivated user: Reactivate is now reachable on mobile (previously the
    // mobile card had no actions at all).
    expect(screen.getByTestId("reactivate-user-deactivated")).toBeInTheDocument();

    // Self row: Deactivate disabled + visible reason.
    expect(screen.getByTestId("deactivate-user-admin-1")).toBeDisabled();
    expect(
      screen.getByTestId("deactivate-self-hint-admin-1"),
    ).toHaveTextContent(/can't deactivate yourself/i);
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
