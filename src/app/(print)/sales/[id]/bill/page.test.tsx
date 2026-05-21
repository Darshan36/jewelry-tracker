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
// html2canvas-pro and jspdf don't run cleanly under jsdom (canvas
// APIs, DOM ranges). Mock both to noop stubs that surface the call
// shape the toolbar drives.
vi.mock("html2canvas-pro", () => {
  const fakeCanvas = {
    toDataURL: vi.fn(() => "data:image/jpeg;base64,fake"),
    width: 800,
    height: 1000,
  };
  return {
    default: vi.fn(async () => fakeCanvas),
    __canvas: fakeCanvas,
  };
});
vi.mock("jspdf", () => {
  const pdf = {
    addImage: vi.fn(),
    addPage: vi.fn(),
    save: vi.fn(),
    internal: {
      pageSize: { getWidth: () => 210, getHeight: () => 297 },
    },
  };
  // Use a constructable function so `new jsPDF(...)` works.
  const jsPDF = vi.fn(function (this: unknown) {
    return pdf;
  });
  return { jsPDF, __pdf: pdf };
});

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

describe("BillPage — toolbar (Print + Save as PDF, no Back link)", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    vi.mocked(getShopSettings).mockResolvedValueOnce(makeShopSettings());
  });

  it("renders BOTH a Print button and a Save-as-PDF button", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    expect(screen.getByTestId("print-button")).toBeInTheDocument();
    expect(screen.getByTestId("download-pdf-button")).toBeInTheDocument();
  });

  it("does NOT render the '← Back to sales' link in the toolbar", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);

    const jsx = await BillPage({ params: params("sale-1") });
    const { container } = render(jsx);

    // No link element pointing back to /sales (the toolbar dropped it).
    const backLink = container.querySelector('a[href="/sales"]');
    expect(backLink).toBeNull();
    // And no text "Back to sales".
    expect(screen.queryByText(/back to sales/i)).toBeNull();
  });

  it("wraps the bill body in a #bill-printable container (html2pdf target)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(makeSale() as any);

    const jsx = await BillPage({ params: params("sale-1") });
    const { container } = render(jsx);

    const printable = container.querySelector("#bill-printable");
    expect(printable).toBeInTheDocument();
    // The toolbar must NOT be inside the printable container (so it
    // doesn't appear in the downloaded PDF).
    expect(printable?.querySelector('[data-testid="print-button"]')).toBeNull();
    expect(
      printable?.querySelector('[data-testid="download-pdf-button"]'),
    ).toBeNull();
    // The shop header (and everything else) MUST be inside.
    expect(
      printable?.querySelector('[data-testid="bill-shop-header"]'),
    ).toBeInTheDocument();
  });
});

describe("BillPage — Save-as-PDF download handler", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(sessionFor("ADMIN"));
    vi.mocked(getShopSettings).mockResolvedValueOnce(makeShopSettings());
  });

  it("invokes html2canvas-pro with the bill element and saves a customer-named PDF", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h2cMod = (await import("html2canvas-pro")) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsMod = (await import("jspdf")) as any;
    const h2cFn = h2cMod.default as ReturnType<typeof vi.fn>;
    const jsPDFFn = jsMod.jsPDF as ReturnType<typeof vi.fn>;
    const pdf = jsMod.__pdf;
    h2cFn.mockClear();
    jsPDFFn.mockClear();
    pdf.addImage.mockClear();
    pdf.save.mockClear();

    const sale = makeSale({
      partyName: "John Customer",
      date: new Date("2026-05-20T00:00:00Z"),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(sale as any);

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();

    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);

    await user.click(screen.getByTestId("download-pdf-button"));

    // Captures the #bill-printable element.
    expect(h2cFn).toHaveBeenCalled();
    const captured = h2cFn.mock.calls[0][0];
    expect(captured).toBeInstanceOf(HTMLElement);
    expect((captured as HTMLElement).id).toBe("bill-printable");

    // Builds an A4 portrait PDF and writes a single image at the
    // configured 14mm margins (short-receipt case — fits one page).
    expect(jsPDFFn).toHaveBeenCalledWith({
      unit: "mm",
      format: "a4",
      orientation: "portrait",
    });
    expect(pdf.addImage).toHaveBeenCalledTimes(1);
    const addArgs = pdf.addImage.mock.calls[0];
    expect(addArgs[0]).toBe("data:image/jpeg;base64,fake");
    expect(addArgs[1]).toBe("JPEG");
    expect(addArgs[2]).toBe(14); // x = left margin
    expect(addArgs[3]).toBe(14); // y = top margin

    // Filename uses a slugified customer name + the sale's date.
    expect(pdf.save).toHaveBeenCalledWith(
      "bill-john-customer-2026-05-20.pdf",
    );
  });

  it("filename slug falls back to 'bill' for unusable customer names", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsMod = (await import("jspdf")) as any;
    const pdf = jsMod.__pdf;
    pdf.save.mockClear();

    const sale = makeSale({
      partyName: "!!!!", // non-alphanumeric only → empty slug
      date: new Date("2026-01-15T00:00:00Z"),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.sale.findUnique).mockResolvedValueOnce(sale as any);

    const userEvent = (await import("@testing-library/user-event")).default;
    const user = userEvent.setup();
    const jsx = await BillPage({ params: params("sale-1") });
    render(jsx);
    await user.click(screen.getByTestId("download-pdf-button"));

    expect(pdf.save).toHaveBeenCalledWith("bill-bill-2026-01-15.pdf");
  });
});

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
