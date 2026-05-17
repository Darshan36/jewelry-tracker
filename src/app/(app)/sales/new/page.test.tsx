// Smoke test for /sales/new — minimal verification that the server
// page fetches customers and renders. The form's behavior is covered
// in sale-form.test.tsx; the role gate is enforced by proxy.ts and
// covered there.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/prisma");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
// Stub the form component — the page test cares about page-level
// concerns (server fetch, header, layout), not the form internals.
vi.mock("../sale-form", () => ({
  SaleForm: (props: { mode: string; customers: unknown[] }) => (
    <div
      data-testid="sale-form"
      data-mode={props.mode}
      data-customer-count={props.customers.length}
    />
  ),
}));

import { prisma } from "@/lib/prisma";

import NewSalePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NewSalePage (server)", () => {
  it("queries non-deleted customers ordered by name (drop-down population)", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([]);
    await NewSalePage();
    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    });
  });

  it("renders the page header + back link + SaleForm in create mode", async () => {
    vi.mocked(prisma.customer.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "c1", name: "Alice", phone: "1" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "c2", name: "Bob", phone: "2" } as any,
    ]);

    const tree = await NewSalePage();
    render(tree);

    expect(screen.getByRole("heading", { name: /new sale/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to sales/i })).toHaveAttribute(
      "href",
      "/sales",
    );
    const form = screen.getByTestId("sale-form");
    expect(form.getAttribute("data-mode")).toBe("create");
    expect(form.getAttribute("data-customer-count")).toBe("2");
  });
});
