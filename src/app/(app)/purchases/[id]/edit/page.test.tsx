// Smoke test for /purchases/[id]/edit — verifies the server page
// fetches the right purchase + suppliers, calls notFound() on
// missing/deleted purchase rows, and hands the serialised purchase
// to PurchaseForm in edit mode.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/prisma");
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("../../purchase-form", () => ({
  PurchaseForm: (props: { mode: string; purchase?: { id: string } }) => (
    <div
      data-testid="purchase-form"
      data-mode={props.mode}
      data-purchase-id={props.purchase?.id ?? ""}
    />
  ),
}));

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

import EditPurchasePage from "./page";

function makePurchaseRow(
  overrides: Partial<{ id: string; deletedAt: Date | null }> = {},
) {
  return {
    id: "purchase-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: null,
    partyName: "Test Walk-in Supplier",
    partyPhone: null,
    discount: 0n,
    total: 100000n,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    lineItems: [],
    payments: [],
    returns: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EditPurchasePage (server)", () => {
  it("calls notFound() when the purchase id doesn't exist", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    await expect(
      EditPurchasePage({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("queries the purchase with deletedAt:null guard (soft-deleted rows treated as missing)", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    try {
      await EditPurchasePage({ params: Promise.resolve({ id: "abc" }) });
    } catch {
      // notFound() throws — swallow.
    }

    expect(prisma.purchase.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
  });

  it("renders PurchaseForm in edit mode with the serialised purchase", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makePurchaseRow() as any,
    );
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    const tree = await EditPurchasePage({
      params: Promise.resolve({ id: "purchase-1" }),
    });
    render(tree);

    const form = screen.getByTestId("purchase-form");
    expect(form.getAttribute("data-mode")).toBe("edit");
    expect(form.getAttribute("data-purchase-id")).toBe("purchase-1");
    expect(
      screen.getByRole("link", { name: /back to purchases/i }),
    ).toHaveAttribute("href", "/purchases");
  });

  it("includes lineItems + payments + returns in the findUnique include shape", async () => {
    vi.mocked(prisma.purchase.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makePurchaseRow() as any,
    );
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    await EditPurchasePage({ params: Promise.resolve({ id: "purchase-1" }) });

    const call = vi.mocked(prisma.purchase.findUnique).mock.calls[0][0];
    expect(call.include).toEqual(
      expect.objectContaining({
        lineItems: expect.anything(),
        payments: true,
        returns: true,
      }),
    );
  });
});
