// Tests for the /completed client component. Focus on tab rendering,
// filter wiring (URL replace + debounced query), row-click → modal
// open, and empty states per tab.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

// Stub the four detail modals to keep this test focused on tab plumbing.
// We capture the `open` + entity id props so we can assert which modal
// opened on row click.
vi.mock("@/app/(app)/sales/sale-detail-modal", () => ({
  SaleDetailModal: ({
    open,
    sale,
  }: {
    open: boolean;
    sale: { id: string } | null;
  }) =>
    open ? <div data-testid="sale-detail-modal">sale:{sale?.id}</div> : null,
}));
vi.mock("@/app/(app)/purchases/purchase-detail-modal", () => ({
  PurchaseDetailModal: ({
    open,
    purchase,
  }: {
    open: boolean;
    purchase: { id: string } | null;
  }) =>
    open ? (
      <div data-testid="purchase-detail-modal">purchase:{purchase?.id}</div>
    ) : null,
}));
vi.mock("@/app/(app)/casting/casting-detail-modal", () => ({
  CastingDetailModal: ({
    open,
    entry,
  }: {
    open: boolean;
    entry: { id: string } | null;
  }) =>
    open ? (
      <div data-testid="casting-detail-modal">casting:{entry?.id}</div>
    ) : null,
}));
vi.mock("@/app/(app)/plating/plating-detail-modal", () => ({
  PlatingDetailModal: ({
    open,
    entry,
  }: {
    open: boolean;
    entry: { id: string } | null;
  }) =>
    open ? (
      <div data-testid="plating-detail-modal">plating:{entry?.id}</div>
    ) : null,
}));

import { CompletedClient } from "./completed-client";
import type { SaleForClient } from "@/app/(app)/sales/sale-helpers";
import type { PurchaseForClient } from "@/app/(app)/purchases/purchase-helpers";
import type { CastingEntryForClient } from "@/app/(app)/casting/casting-helpers";
import type { PlatingEntryForClient } from "@/app/(app)/plating/plating-helpers";
import type { EmployeePaymentForCompleted } from "@/lib/completed-queries";

// ---------- Minimal client-shape fixtures ----------

const fakeSale = {
  id: "sale-1",
  date: new Date("2026-05-15T00:00:00Z"),
  partyId: null,
  partyName: "Walk-in customer",
  partyPhone: null,
  discount: 0,
  total: 10000,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  lineItems: [
    {
      id: "li-1",
      saleId: "sale-1",
      itemDescription: "Necklace",
      qty: 1,
      rate: 10000,
      createdAt: new Date(),
    },
  ],
  paidAmount: 10000,
  returnTotal: 0,
  status: "completed" as const,
  payments: [],
  returns: [],
} satisfies SaleForClient;

const fakePurchase = {
  id: "purchase-1",
  date: new Date("2026-05-15T00:00:00Z"),
  partyId: null,
  partyName: "Walk-in supplier",
  partyPhone: null,
  discount: 0,
  total: 20000,
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  lineItems: [
    {
      id: "li-p1",
      purchaseId: "purchase-1",
      itemDescription: "Wire",
      qty: 1,
      rate: 20000,
      createdAt: new Date(),
    },
  ],
  paidAmount: 20000,
  returnTotal: 0,
  status: "completed" as const,
  payments: [],
  returns: [],
  photoCount: 0,
} satisfies PurchaseForClient;

const fakeCasting = {
  id: "casting-1",
  date: new Date("2026-05-15T00:00:00Z"),
  partyId: null,
  partyName: "Vendor X",
  partyPhone: null,
  discount: 0,
  total: 30000,
  notes: null,
  attachmentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  lineItems: [
    {
      id: "li-c1",
      castingEntryId: "casting-1",
      materialDescription: "Brass",
      weightKg: "1.000",
      ratePerKg: 30000,
      lineTotal: 30000,
      createdAt: new Date(),
    },
  ],
  paidAmount: 30000,
  status: "completed" as const,
  payments: [],
  party: null,
  bill: null,
} satisfies CastingEntryForClient;

const fakePlating = {
  id: "plating-1",
  date: new Date("2026-05-15T00:00:00Z"),
  partyId: null,
  partyName: "Vendor Y",
  partyPhone: null,
  discount: 0,
  total: 40000,
  notes: null,
  attachmentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  lineItems: [
    {
      id: "li-pl1",
      platingEntryId: "plating-1",
      materialDescription: "Gold",
      weightKg: "0.500",
      ratePerKg: 80000,
      lineTotal: 40000,
      createdAt: new Date(),
    },
  ],
  paidAmount: 40000,
  status: "completed" as const,
  payments: [],
  party: null,
  bill: null,
} satisfies PlatingEntryForClient;

const fakePayment: EmployeePaymentForCompleted = {
  id: "ep-1",
  employeeId: "emp-1",
  employeeName: "Karigar A",
  employeeType: "LABOUR",
  type: "WAGE",
  paidAt: "2026-05-15T10:00:00.000Z",
  amount: 50000,
  periodStart: "2026-05-10T00:00:00.000Z",
  periodEnd: "2026-05-15T00:00:00.000Z",
  note: null,
};

function renderClient(overrides: Partial<{
  sales: SaleForClient[];
  purchases: PurchaseForClient[];
  casting: CastingEntryForClient[];
  plating: PlatingEntryForClient[];
  payroll: EmployeePaymentForCompleted[];
}> = {}) {
  return render(
    <CompletedClient
      sales={overrides.sales ?? []}
      purchases={overrides.purchases ?? []}
      casting={overrides.casting ?? []}
      plating={overrides.plating ?? []}
      payroll={overrides.payroll ?? []}
      initialFrom="2026-05-01"
      initialTo="2026-05-31"
      initialQuery=""
    />,
  );
}

beforeEach(() => {
  replaceMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CompletedClient — tab rendering", () => {
  it("renders all 5 tab triggers", () => {
    renderClient();
    expect(screen.getByTestId("tab-sales")).toBeInTheDocument();
    expect(screen.getByTestId("tab-purchases")).toBeInTheDocument();
    expect(screen.getByTestId("tab-casting")).toBeInTheDocument();
    expect(screen.getByTestId("tab-plating")).toBeInTheDocument();
    expect(screen.getByTestId("tab-payroll")).toBeInTheDocument();
  });

  it("shows count badges per tab", () => {
    renderClient({
      sales: [fakeSale],
      purchases: [fakePurchase, fakePurchase],
      payroll: [fakePayment],
    });
    const counts = screen.getAllByTestId("tab-count");
    // Order: sales, purchases, casting, plating, payroll
    expect(counts.map((c) => c.textContent)).toEqual(["1", "2", "0", "0", "1"]);
  });

  it("Sales tab is the default and shows the sale row", () => {
    renderClient({ sales: [fakeSale] });
    expect(
      screen.getByTestId("completed-sale-row-sale-1"),
    ).toBeInTheDocument();
  });
});

describe("CompletedClient — empty states", () => {
  it("Sales tab shows empty-state message when no sales", () => {
    renderClient();
    expect(screen.getByTestId("completed-empty")).toHaveTextContent(
      /no completed sales/i,
    );
  });

  it("Purchases tab shows empty-state when no purchases", async () => {
    const user = userEvent.setup();
    renderClient();
    await user.click(screen.getByTestId("tab-purchases"));
    await waitFor(() => {
      expect(screen.getByTestId("completed-empty")).toHaveTextContent(
        /no completed purchases/i,
      );
    });
  });

  it("Payroll tab shows employee-specific empty-state", async () => {
    const user = userEvent.setup();
    renderClient();
    await user.click(screen.getByTestId("tab-payroll"));
    await waitFor(() => {
      expect(screen.getByTestId("completed-empty")).toHaveTextContent(
        /no employee payments/i,
      );
    });
  });
});

describe("CompletedClient — row click opens detail modal", () => {
  it("opens SaleDetailModal on sale row click", () => {
    renderClient({ sales: [fakeSale] });
    fireEvent.click(screen.getByTestId("completed-sale-row-sale-1"));
    expect(screen.getByTestId("sale-detail-modal")).toHaveTextContent(
      "sale:sale-1",
    );
  });

  it("opens PurchaseDetailModal on purchase row click", async () => {
    const user = userEvent.setup();
    renderClient({ purchases: [fakePurchase] });
    await user.click(screen.getByTestId("tab-purchases"));
    const row = await screen.findByTestId(
      "completed-purchase-row-purchase-1",
    );
    fireEvent.click(row);
    expect(screen.getByTestId("purchase-detail-modal")).toHaveTextContent(
      "purchase:purchase-1",
    );
  });

  it("opens CastingDetailModal on casting row click", async () => {
    const user = userEvent.setup();
    renderClient({ casting: [fakeCasting] });
    await user.click(screen.getByTestId("tab-casting"));
    const row = await screen.findByTestId(
      "completed-casting-row-casting-1",
    );
    fireEvent.click(row);
    expect(screen.getByTestId("casting-detail-modal")).toHaveTextContent(
      "casting:casting-1",
    );
  });

  it("opens PlatingDetailModal on plating row click", async () => {
    const user = userEvent.setup();
    renderClient({ plating: [fakePlating] });
    await user.click(screen.getByTestId("tab-plating"));
    const row = await screen.findByTestId(
      "completed-plating-row-plating-1",
    );
    fireEvent.click(row);
    expect(screen.getByTestId("plating-detail-modal")).toHaveTextContent(
      "plating:plating-1",
    );
  });
});

describe("CompletedClient — filters update URL", () => {
  it("changing the From date calls router.replace with from param", () => {
    renderClient();
    fireEvent.change(screen.getByTestId("completed-from"), {
      target: { value: "2026-04-01" },
    });
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("from=2026-04-01");
  });

  it("changing the To date calls router.replace with to param", () => {
    renderClient();
    fireEvent.change(screen.getByTestId("completed-to"), {
      target: { value: "2026-04-30" },
    });
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("to=2026-04-30");
  });

  it("party query debounces 300ms before calling router.replace", () => {
    vi.useFakeTimers();
    renderClient();
    fireEvent.change(screen.getByTestId("completed-query"), {
      target: { value: "ram" },
    });
    // The mount-effect fires synchronously; we want to assert that the
    // debounced fire scheduled by THIS keystroke produces the right URL.
    replaceMock.mockClear();
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(replaceMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("q=ram");
  });
});
