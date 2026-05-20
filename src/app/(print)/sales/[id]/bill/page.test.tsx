// Phase 20 — bill page rendering + auth gate tests.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma");
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/app/(app)/settings/actions", () => ({
  getShopSettings: vi.fn(),
}));

import { auth as _auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { getShopSettings } from "@/app/(app)/settings/actions";

import BillPage from "./page";

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

function params(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

function makeSale(
  overrides: Partial<{
    id: string;
    partyName: string;
    partyPhone: string | null;
    partyId: string | null;
    date: Date;
    discount: bigint;
    total: bigint;
    notes: string | null;
    deletedAt: Date | null;
    lineItems: Array<{
      id: string;
      saleId: string;
      itemDescription: string;
      qty: number;
      rate: bigint;
      createdAt: Date;
    }>;
    payments: unknown[];
    returns: unknown[];
  }> = {},
) {
  return {
    id: "sale-1",
    partyId: null,
    partyName: "John Customer",
    partyPhone: "9999999999",
    date: new Date("2026-05-20T00:00:00Z"),
    discount: 10000n, // ₹100 in paise
    total: 290000n, // ₹2900 in paise
    notes: null,
    createdAt: new Date("2026-05-20T00:00:00Z"),
    updatedAt: new Date("2026-05-20T00:00:00Z"),
    deletedAt: null,
    lineItems: [
      {
        id: "li-1",
        saleId: "sale-1",
        itemDescription: "Gold ring 22k",
        qty: 2,
        rate: 150000n, // ₹1500 in paise
        createdAt: new Date("2026-05-20T00:00:00Z"),
      },
    ],
    payments: [],
    returns: [],
    ...overrides,
  };
}

function makeShopSettings(
  overrides: Partial<{
    id: string;
    shopName: string;
    phone: string | null;
    address: string | null;
    footer: string | null;
    updatedById: string | null;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "settings-1",
    shopName: "Shree Creation",
    phone: "+91 99999 11111",
    address: "12 Zaveri Bazaar\nMumbai",
    footer: "Thank you!",
    updatedById: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// =====================================================================
// Auth + role gate
// =====================================================================

describe("BillPage — auth gate", () => {
  it("redirects to /auth/login when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await expect(BillPage({ params: params("sale-1") })).rejects.toThrow(
      "REDIRECT:/auth/login",
    );
    expect(redirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects PURCHASE_DEPT to /dashboard (ADMIN-only)", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("PURCHASE_DEPT"));
    await expect(BillPage({ params: params("sale-1") })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
  });

  it("redirects LABOUR_MGMT to /dashboard (ADMIN-only)", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("LABOUR_MGMT"));
    await expect(BillPage({ params: params("sale-1") })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
  });

  it("redirects CASTING_PLATING_MGMT to /dashboard (ADMIN-only)", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("CASTING_PLATING_MGMT"));
    await expect(BillPage({ params: params("sale-1") })).rejects.toThrow(
      "REDIRECT:/dashboard",
    );
  });
});

// =====================================================================
// notFound — missing or soft-deleted sale
// =====================================================================

describe("BillPage — notFound", () => {
  it("calls notFound() when sale id does not resolve", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(null as any);
    vi.mocked(getShopSettings).mockResolvedValueOnce(makeShopSettings());

    await expect(BillPage({ params: params("ghost") })).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(notFound).toHaveBeenCalled();
  });

  it("filters soft-deleted sales (the findUnique includes deletedAt: null)", async () => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(null as any);
    vi.mocked(getShopSettings).mockResolvedValueOnce(makeShopSettings());

    await BillPage({ params: params("sale-x") }).catch(() => {});
    // Verify the WHERE clause includes deletedAt: null.
    expect(prisma.sale.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sale-x", deletedAt: null },
      }),
    );
  });
});

// =====================================================================
// Render — shop header
// =====================================================================

describe("BillPage — shop header rendering", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
  });

  it("renders configured ShopSettings: name, phone, address, footer", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);
    vi.mocked(getShopSettings).mockResolvedValueOnce(
      makeShopSettings({
        shopName: "Acme Jewels",
        phone: "+91 11111 22222",
        address: "Line 1\nLine 2",
        footer: "Thank you very much",
      }),
    );

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    expect(screen.getByTestId("bill-shop-name").textContent).toBe("Acme Jewels");
    expect(screen.getByTestId("bill-shop-phone").textContent).toContain(
      "+91 11111 22222",
    );
    expect(screen.getByTestId("bill-shop-address").textContent).toContain(
      "Line 1",
    );
    expect(screen.getByTestId("bill-footer").textContent?.trim()).toBe(
      "Thank you very much",
    );
  });

  it("FALLBACK — when ShopSettings is null, shop name is 'Shree Creation' and optional fields hidden", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);
    vi.mocked(getShopSettings).mockResolvedValueOnce(null);

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    expect(screen.getByTestId("bill-shop-name").textContent).toBe(
      "Shree Creation",
    );
    expect(screen.queryByTestId("bill-shop-phone")).toBeNull();
    expect(screen.queryByTestId("bill-shop-address")).toBeNull();
    expect(screen.queryByTestId("bill-footer")).toBeNull();
  });

  it("hides individual optional fields when null but renders others", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);
    vi.mocked(getShopSettings).mockResolvedValueOnce(
      makeShopSettings({
        phone: null,
        address: "Address only",
        footer: null,
      }),
    );

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    expect(screen.queryByTestId("bill-shop-phone")).toBeNull();
    expect(screen.getByTestId("bill-shop-address").textContent).toContain(
      "Address only",
    );
    expect(screen.queryByTestId("bill-footer")).toBeNull();
  });
});

// =====================================================================
// Render — money math
// =====================================================================

describe("BillPage — money math", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    vi.mocked(getShopSettings).mockResolvedValueOnce(makeShopSettings());
  });

  it("CRITICAL: subtotal = Σ(qty × rate); discount and total match stored values", async () => {
    const sale = makeSale({
      discount: 10000n, // ₹100
      total: 290000n, // ₹2900
      lineItems: [
        {
          id: "li-1",
          saleId: "sale-1",
          itemDescription: "Gold ring 22k",
          qty: 2,
          rate: 150000n, // ₹1500
          createdAt: new Date(),
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(sale as any);

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    // Subtotal = 2 × 1500 = 3000 → ₹3,000.00 (Indian formatting)
    const sub = screen.getByTestId("bill-subtotal").textContent ?? "";
    expect(sub).toMatch(/₹\s*3,000\.00/);
    // Discount = 100
    const disc = screen.getByTestId("bill-discount").textContent ?? "";
    expect(disc).toMatch(/₹\s*100\.00/);
    // Total = 2900 (stored)
    const total = screen.getByTestId("bill-total").textContent ?? "";
    expect(total).toMatch(/₹\s*2,900\.00/);
  });

  it("hides discount row when discount === 0", async () => {
    const sale = makeSale({
      discount: 0n,
      total: 300000n,
      lineItems: [
        {
          id: "li-1",
          saleId: "sale-1",
          itemDescription: "Item",
          qty: 2,
          rate: 150000n,
          createdAt: new Date(),
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(sale as any);

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    expect(screen.queryByTestId("bill-discount")).toBeNull();
    expect(screen.getByTestId("bill-subtotal").textContent).toMatch(/3,000/);
    expect(screen.getByTestId("bill-total").textContent).toMatch(/3,000/);
  });

  it("renders multi-line items each with own line-total", async () => {
    const sale = makeSale({
      discount: 0n,
      total: 350000n, // ₹3500 = 2×1500 + 1×500
      lineItems: [
        {
          id: "li-1",
          saleId: "sale-1",
          itemDescription: "Gold ring",
          qty: 2,
          rate: 150000n,
          createdAt: new Date(),
        },
        {
          id: "li-2",
          saleId: "sale-1",
          itemDescription: "Silver chain",
          qty: 1,
          rate: 50000n,
          createdAt: new Date(),
        },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(sale as any);

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    expect(screen.getByTestId("bill-line-item-li-1")).toBeInTheDocument();
    expect(screen.getByTestId("bill-line-item-li-2")).toBeInTheDocument();
    expect(screen.getByTestId("bill-subtotal").textContent).toMatch(/3,500/);
  });
});

// =====================================================================
// Render — locked-decision exclusions
// =====================================================================

describe("BillPage — locked-decision exclusions", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    vi.mocked(getShopSettings).mockResolvedValueOnce(makeShopSettings());
  });

  it("does NOT render any TransactionStatusChip (no payment status)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);

    const jsx = await BillPage({ params: params("sale-1") });
    const { container } = render(jsx);
    // The chip uses a `data-status` attribute. None should be present.
    const chips = container.querySelectorAll("[data-status]");
    expect(chips.length).toBe(0);
  });

  it("does NOT render a bill / invoice number anywhere", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);

    const jsx = await BillPage({ params: params("sale-1") });
    const { container } = render(jsx);
    const body = container.textContent ?? "";
    // Avoid matching "Bill" in the toolbar Print button ("Print"
    // text only). The exclusion is the "#" combined with Bill/Invoice.
    expect(body.match(/\b(Bill|Invoice)\s*#/i)).toBeNull();
  });
});
