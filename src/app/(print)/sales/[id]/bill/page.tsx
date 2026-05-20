// Phase 20 — print-friendly sales bill.
//
// Standalone B&W invoice rendered outside the (app) sidebar chrome.
// Reads ShopSettings live (no snapshotting) — the bill always reflects
// the current configured shop header. Renders a graceful fallback
// ("Shree Creation") when ShopSettings is unconfigured so a bill
// always prints.
//
// Locked-decision exclusions:
//   - NO payment status (the bill is the customer's receipt of items
//     sold + amount owed/paid; payment-collection state is internal)
//   - NO bill number (kaccha tradition; the workshop doesn't keep
//     sequential invoice numbers)
//
// Money math echoes the sale's stored numbers:
//   subtotal = Σ(qty × rate)  per line
//   discount = sale.discount  (sale-level)
//   total    = sale.total     (stored = subtotal − discount)
// Re-deriving subtotal client-side rather than storing it ensures the
// invariant `subtotal − discount = total` always holds in the rendered
// bill — if the stored numbers were ever inconsistent, the bill would
// still be self-consistent because we render `subtotal` from line
// items and `total` from the stored field.

import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canManageSettings } from "@/lib/role-access";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/format";

import { getShopSettings } from "@/app/(app)/settings/actions";
import { serializeSale } from "@/app/(app)/sales/sale-helpers";

import { BillToolbar } from "./print-button";

type Props = {
  params: Promise<{ id: string }>;
};

const FALLBACK_SHOP_NAME = "Shree Creation";

export default async function PrintBillPage({ params }: Props) {
  const { id } = await params;

  // Defense in depth — the proxy already gates `/sales` to ADMIN-only
  // (and `/sales/[id]/bill` inherits via prefix match), but a misrouted
  // import path would bypass. Re-check here. Settings + sales share
  // the ADMIN role for the print bill surface; `canManageSettings`
  // doubles as the gate.
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  if (!canManageSettings(session.user.role)) {
    redirect("/dashboard");
  }

  const [saleRow, shopSettings] = await Promise.all([
    prisma.sale.findUnique({
      where: { id, deletedAt: null },
      include: {
        lineItems: { orderBy: { createdAt: "asc" } },
        payments: true,
        returns: true,
      },
    }),
    getShopSettings(),
  ]);

  if (!saleRow) notFound();
  const sale = serializeSale(saleRow);

  // Subtotal derived from line items so the rendered bill is
  // self-consistent regardless of any drift in `sale.total`.
  const subtotal = sale.lineItems.reduce(
    (sum, li) => sum + li.qty * li.rate,
    0,
  );

  const shopName = shopSettings?.shopName ?? FALLBACK_SHOP_NAME;
  const shopPhone = shopSettings?.phone ?? null;
  const shopAddress = shopSettings?.address ?? null;
  const shopFooter = shopSettings?.footer ?? null;

  return (
    <div className="max-w-[210mm] mx-auto p-8 md:p-12 print:p-0">
      {/* Toolbar — Print + Save as PDF. Hidden in print output. */}
      <BillToolbar />

      {/* Shop header */}
      <header
        className="text-center pb-6 border-b-2 border-black"
        data-testid="bill-shop-header"
      >
        <h1
          className="text-3xl md:text-4xl font-bold tracking-tight"
          data-testid="bill-shop-name"
        >
          {shopName}
        </h1>
        {shopAddress && (
          <p
            className="mt-2 text-sm whitespace-pre-line leading-relaxed"
            data-testid="bill-shop-address"
          >
            {shopAddress}
          </p>
        )}
        {shopPhone && (
          <p className="mt-1 text-sm" data-testid="bill-shop-phone">
            Phone: {shopPhone}
          </p>
        )}
      </header>

      {/* Bill meta */}
      <section
        className="grid grid-cols-2 gap-4 mt-6 text-sm"
        data-testid="bill-meta"
      >
        <div>
          <div className="uppercase text-xs tracking-widest font-semibold mb-1">
            Date
          </div>
          <div data-testid="bill-date">{formatDate(sale.date)}</div>
        </div>
        <div className="text-right">
          <div className="uppercase text-xs tracking-widest font-semibold mb-1">
            Customer
          </div>
          <div data-testid="bill-customer-name">{sale.partyName}</div>
          {sale.partyPhone && (
            <div className="text-xs mt-0.5" data-testid="bill-customer-phone">
              {sale.partyPhone}
            </div>
          )}
        </div>
      </section>

      {/* Line items */}
      <section className="mt-8">
        <table
          className="w-full border-collapse text-sm"
          data-testid="bill-items-table"
        >
          <thead>
            <tr className="border-y-2 border-black">
              <th className="text-left py-2 px-2 font-semibold uppercase text-xs tracking-wider">
                Description
              </th>
              <th className="text-right py-2 px-2 font-semibold uppercase text-xs tracking-wider w-20">
                Qty
              </th>
              <th className="text-right py-2 px-2 font-semibold uppercase text-xs tracking-wider w-28">
                Rate
              </th>
              <th className="text-right py-2 px-2 font-semibold uppercase text-xs tracking-wider w-32">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {sale.lineItems.map((li) => (
              <tr
                key={li.id}
                className="border-b border-black/30"
                data-testid={`bill-line-item-${li.id}`}
              >
                <td className="py-2 px-2 align-top">{li.itemDescription}</td>
                <td className="py-2 px-2 text-right tabular-nums align-top">
                  {li.qty}
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-mono align-top">
                  {formatCurrency(li.rate)}
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-mono align-top">
                  {formatCurrency(li.qty * li.rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Totals — bottom-right */}
      <section
        className="mt-6 flex justify-end"
        data-testid="bill-totals"
      >
        <div className="w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span
              className="tabular-nums font-mono"
              data-testid="bill-subtotal"
            >
              {formatCurrency(subtotal)}
            </span>
          </div>
          {sale.discount > 0 && (
            <div className="flex justify-between">
              <span>Discount</span>
              <span
                className="tabular-nums font-mono"
                data-testid="bill-discount"
              >
                − {formatCurrency(sale.discount)}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t-2 border-black mt-2 pt-2 text-base font-bold">
            <span>Total</span>
            <span
              className="tabular-nums font-mono"
              data-testid="bill-total"
            >
              {formatCurrency(sale.total)}
            </span>
          </div>
        </div>
      </section>

      {sale.notes && (
        <section
          className="mt-8 pt-4 border-t border-black/30 text-sm"
          data-testid="bill-notes"
        >
          <div className="uppercase text-xs tracking-widest font-semibold mb-1">
            Notes
          </div>
          <p className="whitespace-pre-line">{sale.notes}</p>
        </section>
      )}

      {shopFooter && (
        <footer
          className="mt-12 pt-6 border-t-2 border-black text-center text-sm italic"
          data-testid="bill-footer"
        >
          {shopFooter}
        </footer>
      )}
    </div>
  );
}
