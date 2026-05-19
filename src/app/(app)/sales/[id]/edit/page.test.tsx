// Smoke test for /sales/[id]/edit — verifies the server page fetches
// the right sale + customers, calls notFound() on missing/deleted
// sale rows, and hands the serialised sale to SaleForm in edit mode.

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
vi.mock("../../sale-form", () => ({
  SaleForm: (props: { mode: string; sale?: { id: string } }) => (
    <div
      data-testid="sale-form"
      data-mode={props.mode}
      data-sale-id={props.sale?.id ?? ""}
    />
  ),
}));

import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

import EditSalePage from "./page";

function makeSaleRow(overrides: Partial<{ id: string; deletedAt: Date | null }> = {}) {
  return {
    id: "sale-1",
    date: new Date("2026-05-10T00:00:00Z"),
    partyId: null,
    partyName: "Test Walk-in",
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

describe("EditSalePage (server)", () => {
  it("calls notFound() when the sale id doesn't exist", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    await expect(
      EditSalePage({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("queries the sale with deletedAt:null guard (soft-deleted rows treated as missing)", async () => {
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    try {
      await EditSalePage({ params: Promise.resolve({ id: "abc" }) });
    } catch {
      // notFound() throws — swallow for the assertion below.
    }

    expect(prisma.sale.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "abc", deletedAt: null },
      }),
    );
  });

  it("renders SaleForm in edit mode with the serialised sale", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow() as any);
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    const tree = await EditSalePage({ params: Promise.resolve({ id: "sale-1" }) });
    render(tree);

    const form = screen.getByTestId("sale-form");
    expect(form.getAttribute("data-mode")).toBe("edit");
    expect(form.getAttribute("data-sale-id")).toBe("sale-1");
    expect(screen.getByRole("link", { name: /back to sales/i })).toHaveAttribute(
      "href",
      "/sales",
    );
  });

  it("includes lineItems + payments + returns in the findUnique include shape", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValue(makeSaleRow() as any);
    vi.mocked(prisma.party.findMany).mockResolvedValue([]);

    await EditSalePage({ params: Promise.resolve({ id: "sale-1" }) });

    const call = vi.mocked(prisma.sale.findUnique).mock.calls[0][0];
    expect(call.include).toEqual(
      expect.objectContaining({
        lineItems: expect.anything(),
        payments: true,
        returns: true,
      }),
    );
  });
});
