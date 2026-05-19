// Tests for the /completed server page. Verifies role gate +
// initial-data fan-out into the client component.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/completed-queries", () => ({
  getCompletedSales: vi.fn(),
  getCompletedPurchases: vi.fn(),
  getCompletedCastingEntries: vi.fn(),
  getCompletedPlatingEntries: vi.fn(),
  getCompletedEmployeePayments: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("./completed-client", () => ({
  CompletedClient: (props: {
    sales: unknown[];
    purchases: unknown[];
    casting: unknown[];
    plating: unknown[];
    payroll: unknown[];
    initialFrom: string;
    initialTo: string;
    initialQuery: string;
  }) => (
    <div data-testid="completed-client">
      <span data-testid="sales-count">{props.sales.length}</span>
      <span data-testid="purchases-count">{props.purchases.length}</span>
      <span data-testid="casting-count">{props.casting.length}</span>
      <span data-testid="plating-count">{props.plating.length}</span>
      <span data-testid="payroll-count">{props.payroll.length}</span>
      <span data-testid="initial-from">{props.initialFrom}</span>
      <span data-testid="initial-to">{props.initialTo}</span>
      <span data-testid="initial-query">{props.initialQuery}</span>
    </div>
  ),
}));

import { auth as _auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getCompletedCastingEntries,
  getCompletedEmployeePayments,
  getCompletedPlatingEntries,
  getCompletedPurchases,
  getCompletedSales,
} from "@/lib/completed-queries";

import CompletedPage from "./page";

type Role = "ADMIN" | "PURCHASE_DEPT" | "LABOUR_MGMT" | "CASTING_PLATING_MGMT";
type Session = {
  user: { id: string; email: string; name: string; role: Role };
  expires: string;
};
const auth = _auth as unknown as () => Promise<Session | null>;

function sessionFor(role: Role): Session {
  return {
    user: { id: "u", email: "u@x", name: "U", role },
    expires: "2099-12-31T00:00:00.000Z",
  };
}

function emptySearchParams(
  override: Record<string, string> = {},
): Promise<Record<string, string | string[] | undefined>> {
  return Promise.resolve(override);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCompletedSales).mockResolvedValue([]);
  vi.mocked(getCompletedPurchases).mockResolvedValue([]);
  vi.mocked(getCompletedCastingEntries).mockResolvedValue([]);
  vi.mocked(getCompletedPlatingEntries).mockResolvedValue([]);
  vi.mocked(getCompletedEmployeePayments).mockResolvedValue([]);
});

describe("CompletedPage — auth gate", () => {
  it("redirects to /auth/login when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await expect(
      CompletedPage({ searchParams: emptySearchParams() }),
    ).rejects.toThrow("REDIRECT:/auth/login");
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects to /dashboard for PURCHASE_DEPT", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("PURCHASE_DEPT"));
    await expect(
      CompletedPage({ searchParams: emptySearchParams() }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("redirects to /dashboard for LABOUR_MGMT and CASTING_PLATING_MGMT", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("LABOUR_MGMT"));
    await expect(
      CompletedPage({ searchParams: emptySearchParams() }),
    ).rejects.toThrow("REDIRECT:/dashboard");

    vi.mocked(auth).mockResolvedValue(sessionFor("CASTING_PLATING_MGMT"));
    await expect(
      CompletedPage({ searchParams: emptySearchParams() }),
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("allows ADMIN to reach the page", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    const ui = await CompletedPage({ searchParams: emptySearchParams() });
    render(ui);
    expect(screen.getByTestId("completed-client")).toBeInTheDocument();
  });
});

describe("CompletedPage — initial data + filter resolution", () => {
  it("fetches all five tabs in parallel and passes counts to client", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getCompletedSales).mockResolvedValue([{ id: "s1" }] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getCompletedPurchases).mockResolvedValue([{ id: "p1" }, { id: "p2" }] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getCompletedEmployeePayments).mockResolvedValue([{ id: "ep1" }] as any);

    const ui = await CompletedPage({ searchParams: emptySearchParams() });
    render(ui);

    expect(screen.getByTestId("sales-count")).toHaveTextContent("1");
    expect(screen.getByTestId("purchases-count")).toHaveTextContent("2");
    expect(screen.getByTestId("casting-count")).toHaveTextContent("0");
    expect(screen.getByTestId("plating-count")).toHaveTextContent("0");
    expect(screen.getByTestId("payroll-count")).toHaveTextContent("1");
  });

  it("forwards explicit from/to/q query params to the helpers", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    await CompletedPage({
      searchParams: emptySearchParams({
        from: "2026-03-01",
        to: "2026-03-31",
        q: "ramesh",
      }),
    });
    const call = vi.mocked(getCompletedSales).mock.calls[0][0];
    expect(call.range.from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    // `to` is pushed forward by one day to make the UI's inclusive
    // range work with the half-open SQL filter.
    expect(call.range.to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(call.partyQuery).toBe("ramesh");
  });

  it("defaults to the current IST calendar month when no params", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    await CompletedPage({ searchParams: emptySearchParams() });
    const call = vi.mocked(getCompletedSales).mock.calls[0][0];
    // The `from` should be the 1st-of-current-IST-month at midnight UTC.
    // We assert structurally (day of month + month boundary), not against
    // the literal current date — tests would otherwise drift each month.
    expect(call.range.from.getUTCDate()).toBe(1);
    expect(call.range.from.getUTCHours()).toBe(0);
    expect(call.range.to.getUTCDate()).toBe(1);
    expect(call.range.to.getTime()).toBeGreaterThan(call.range.from.getTime());
  });
});
