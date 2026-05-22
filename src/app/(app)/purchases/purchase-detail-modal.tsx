"use client";

// Phase 10: PurchaseDetailModal is now read-only. All mutation surfaces
// (Add Payment, Add Return, Replace Attachment, Delete) have moved off the
// detail modal: payments + returns happen via the inline action
// buttons in the row's Actions column (which open dedicated modals);
// the full edit lives at /purchases/[id]/edit; soft-delete is on the row's
// hover-action cluster.
//
// What stays in the detail modal:
//   - Read-only line items table
//   - Subtotal / discount / total
//   - Read-only history of payments + returns
//   - Notes
//   - Status chip
//   - One "Edit" link at the bottom that routes to /purchases/[id]/edit
//
// Why: separates view from write. The detail modal was carrying too
// many responsibilities (view + four kinds of mutation); splitting
// them gives the user a cleaner mental model and makes mobile
// adaptation in Phase 11 straightforward.

import Link from "next/link";
import { ArrowRight, Link as LinkIcon } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { LabeledField } from "@/components/labeled-field";
import { PhotoGallery } from "@/components/photo-gallery";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import { formatCurrency, formatDate } from "@/lib/format";

import type { PurchaseForClient } from "./purchase-helpers";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase: PurchaseForClient | null;
};

export function PurchaseDetailModal({ open, onOpenChange, purchase }: Props) {
  if (!purchase) return null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[600px] md:p-6"
        className="bg-surface-container border-outline-variant p-6 gap-0"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-2">
              {purchase.partyId !== null && (
                <LinkIcon
                  className="size-4 text-secondary"
                  aria-label="Linked supplier"
                />
              )}
              <span>{purchase.partyName}</span>
            </span>
            <TransactionStatusChip status={purchase.status} />
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-5">
            <LabeledField label="Date" value={formatDate(purchase.date)} />
            <LabeledField label="Phone" value={purchase.partyPhone} />
          </div>

          {/* Line items (read-only) */}
          <div>
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-2">
              Items
            </p>
            <div className="border border-outline-variant">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-high">
                  <tr>
                    <th className="text-left px-3 py-2 font-display text-xs uppercase tracking-wider text-on-surface-variant">
                      Description
                    </th>
                    <th className="text-right px-3 py-2 font-display text-xs uppercase tracking-wider text-on-surface-variant w-20">
                      Qty
                    </th>
                    <th className="text-right px-3 py-2 font-display text-xs uppercase tracking-wider text-on-surface-variant w-28">
                      Rate
                    </th>
                    <th className="text-right px-3 py-2 font-display text-xs uppercase tracking-wider text-on-surface-variant w-32">
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.lineItems.map((line, idx) => (
                    <tr
                      key={line.id}
                      className={
                        idx % 2 === 0
                          ? "bg-surface-container-low"
                          : "bg-surface-container"
                      }
                    >
                      <td className="px-3 py-2 text-on-surface">
                        {line.itemDescription}
                      </td>
                      <td className="px-3 py-2 text-right text-on-surface tabular-nums">
                        {line.qty}
                      </td>
                      <td className="px-3 py-2 text-right text-on-surface tabular-nums font-mono">
                        {formatCurrency(line.rate)}
                      </td>
                      <td className="px-3 py-2 text-right text-on-surface tabular-nums font-mono">
                        {formatCurrency(line.qty * line.rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Subtotal / Discount / Final total */}
          <div className="border-t border-outline-variant pt-4 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Subtotal</span>
              <span className="tabular-nums font-mono text-on-surface">
                {formatCurrency(purchase.total + purchase.discount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Discount</span>
              <span className="tabular-nums font-mono text-on-surface">
                −{formatCurrency(purchase.discount)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-outline-variant/40">
              <span className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
                Total
              </span>
              <span className="text-2xl font-display tabular-nums text-on-surface">
                {formatCurrency(purchase.total)}
              </span>
            </div>
          </div>

          {purchase.notes && (
            <LabeledField label="Notes" value={purchase.notes} multiline />
          )}

          {/* Phase 21a: party-linked purchases reconcile on the
              party ledger; walk-ins keep their per-bill list. */}
          {purchase.partyId !== null ? (
            <PartyLedgerPointer partyId={purchase.partyId} />
          ) : (
            <ReadOnlyPaymentsList
              payments={purchase.payments}
              paidAmount={purchase.paidAmount}
            />
          )}

          {/* Returns history (read-only) */}
          {purchase.returns.length > 0 && (
            <ReadOnlyReturnsList returns={purchase.returns} returnTotal={purchase.returnTotal} />
          )}

          {/* Photos (Phase 12a — read-only gallery; self-hides when empty). */}
          {purchase.photoCount > 0 && (
            <div>
              <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                Photos
              </p>
              <PhotoGallery
                mode="view"
                entityType="PURCHASE_PHOTO"
                entityId={purchase.id}
              />
            </div>
          )}
        </div>

        <div className="mt-6 -mx-6 -mb-6 px-6 py-4 border-t border-outline-variant flex items-center justify-end">
          <Link
            href={`/purchases/${purchase.id}/edit`}
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 bg-secondary-container text-on-secondary-container font-display text-sm font-medium uppercase tracking-wider hover:bg-secondary-container/90 transition-colors flex items-center"
          >
            Edit
          </Link>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function ReadOnlyPaymentsList({
  payments,
  paidAmount,
}: {
  payments: PurchaseForClient["payments"];
  paidAmount: number;
}) {
  if (payments.length === 0) {
    return (
      <div>
        <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-2">
          Payments
        </p>
        <p className="text-sm text-on-surface-variant italic">
          No payments recorded yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
          Payments
        </p>
        <p className="text-xs text-on-surface-variant">
          Net paid:{" "}
          <span className="tabular-nums font-mono text-on-surface">
            {formatCurrency(paidAmount)}
          </span>
        </p>
      </div>
      <div className="border border-outline-variant divide-y divide-outline-variant/40">
        {payments.map((p) => {
          const isRefund = p.type === "REFUND";
          return (
            <div
              key={p.id}
              className="grid grid-cols-[100px_70px_1fr_120px] gap-2 items-center text-sm px-3 py-2"
            >
              <span className="text-xs text-on-surface-variant tabular-nums">
                {formatDate(p.date)}
              </span>
              <span
                className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 inline-block w-fit ${
                  isRefund
                    ? "bg-error/20 text-error"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {p.type}
              </span>
              <span className="text-xs text-on-surface-variant truncate">
                {p.note ?? ""}
              </span>
              <span
                className={`text-right tabular-nums font-mono text-sm ${
                  isRefund ? "text-error" : ""
                }`}
              >
                {isRefund ? "−" : ""}
                {formatCurrency(p.amount)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PartyLedgerPointer({ partyId }: { partyId: string }) {
  // Phase 21a — party-linked purchases reconcile on the party ledger.
  return (
    <div>
      <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-2">
        Payments
      </p>
      <Link
        href={`/payables/${partyId}`}
        className="inline-flex items-center gap-1.5 text-sm text-on-surface hover:underline"
      >
        <span>Tracked on this supplier&apos;s ledger</span>
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function ReadOnlyReturnsList({
  returns,
  returnTotal,
}: {
  returns: PurchaseForClient["returns"];
  returnTotal: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
          Returns
        </p>
        <p className="text-xs text-on-surface-variant">
          Total refunded:{" "}
          <span className="tabular-nums font-mono text-on-surface">
            {formatCurrency(returnTotal)}
          </span>
        </p>
      </div>
      <div className="border border-outline-variant divide-y divide-outline-variant/40">
        {returns.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[100px_70px_1fr_120px] gap-2 items-center text-sm px-3 py-2"
          >
            <span className="text-xs text-on-surface-variant tabular-nums">
              {formatDate(r.date)}
            </span>
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 inline-block w-fit bg-surface-container-high text-on-surface-variant tabular-nums">
              {r.qtyReturned}x
            </span>
            <span className="text-xs text-on-surface-variant truncate">
              {r.note ?? ""}
            </span>
            <span className="text-right tabular-nums font-mono text-sm">
              {formatCurrency(r.refundAmount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
