// Smoke test for /purchases/new — minimal verification that the
// server page fetches suppliers and renders. The form's behavior is
// covered in purchase-form.test.tsx; the role gate is enforced by
// proxy.ts and covered there.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/prisma");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("../purchase-form", () => ({
  PurchaseForm: (props: { mode: string; suppliers: unknown[] }) => (
    <div
      data-testid="purchase-form"
      data-mode={props.mode}
      data-supplier-count={props.suppliers.length}
    />
  ),
}));

import { prisma } from "@/lib/prisma";

import NewPurchasePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NewPurchasePage (server)", () => {
  it("queries non-deleted suppliers ordered by name (drop-down population)", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([]);
    await NewPurchasePage();
    expect(prisma.supplier.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    });
  });

  it("renders the page header + back link + PurchaseForm in create mode", async () => {
    vi.mocked(prisma.supplier.findMany).mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "s1", name: "Alpha Castings", phone: "1" } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "s2", name: "Beta Wires", phone: "2" } as any,
    ]);

    const tree = await NewPurchasePage();
    render(tree);

    expect(
      screen.getByRole("heading", { name: /new purchase/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to purchases/i }),
    ).toHaveAttribute("href", "/purchases");
    const form = screen.getByTestId("purchase-form");
    expect(form.getAttribute("data-mode")).toBe("create");
    expect(form.getAttribute("data-supplier-count")).toBe("2");
  });
});
