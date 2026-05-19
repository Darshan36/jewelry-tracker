"use client";

// Phase 10.6: CastingDetailModal is now read-only. All mutation surfaces
// (Add Payment, Replace Attachment, Delete) have moved off the detail modal:
// payments + bill replace happen via the inline action buttons in the
// row's Actions column (which open dedicated modals); the full edit
// lives at /casting/[id]/edit; soft-delete is on the row's hover-action
// cluster.
//
// What stays in the detail modal:
//   - Read-only Materials table (formatKg + ratePerKg/kg + lineTotal)
//   - Subtotal / discount / total
//   - Read-only Attachment section (filename + View button only — no Replace)
//   - Read-only Payments history list
//   - Notes
//   - Status chip
//   - One "Edit" link at the bottom that routes to /casting/[id]/edit
//
// Casting has no Returns workflow (see Phase 9 decision lineage), so
// the Sales detail-modal's ReturnsList has no analogue here.

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Link as LinkIcon, Loader2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { LabeledField } from "@/components/labeled-field";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import { formatCurrency, formatDate } from "@/lib/format";
import { formatKg } from "@/lib/weight-helpers";
import { getAttachmentViewUrl } from "@/app/(app)/attachments/actions";

import type { CastingEntryForClient } from "./casting-helpers";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: CastingEntryForClient | null;
};

export function CastingDetailModal({ open, onOpenChange, entry }: Props) {
  const [billOpening, setBillOpening] = useState(false);

  if (!entry) return null;

  const subtotal = entry.lineItems.reduce((s, l) => s + l.lineTotal, 0);

  const openBill = async () => {
    if (!entry.bill) return;
    setBillOpening(true);
    try {
      const res = await getAttachmentViewUrl(entry.bill.id);
      if (res.ok) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setBillOpening(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[820px] md:p-6"
        className="bg-surface-container border-outline-variant p-6 gap-0"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-2">
              {entry.partyId !== null && (
                <LinkIcon
                  className="size-4 text-secondary"
                  aria-label="Linked vendor"
                />
              )}
              <span>{entry.partyName}</span>
            </span>
            <TransactionStatusChip status={entry.status} />
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-5">
            <LabeledField label="Date" value={formatDate(entry.date)} />
            <LabeledField label="Vendor phone" value={entry.partyPhone} />
          </div>

          {/* Materials (read-only) */}
          <div>
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-2">
              Materials
            </p>
            <div className="border border-outline-variant">
              <div className="grid grid-cols-[1fr_110px_130px_130px] gap-2 px-3 py-2 bg-surface-container-high text-xs uppercase tracking-wider font-display text-on-surface-variant">
                <span>Material</span>
                <span className="text-right">Weight</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Line total</span>
              </div>
              {entry.lineItems.map((li, idx) => (
                <div
                  key={li.id}
                  className={`grid grid-cols-[1fr_110px_130px_130px] gap-2 px-3 py-2 items-center ${
                    idx % 2 === 0
                      ? "bg-surface-container-low"
                      : "bg-surface-container"
                  }`}
                >
                  <span className="text-on-surface text-sm">
                    {li.materialDescription}
                  </span>
                  <span className="text-right tabular-nums font-mono text-sm">
                    {formatKg(li.weightKg)} kg
                  </span>
                  <span className="text-right tabular-nums font-mono text-sm">
                    {formatCurrency(li.ratePerKg)}/kg
                  </span>
                  <span className="text-right tabular-nums font-mono text-sm">
                    {formatCurrency(li.lineTotal)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Subtotal / Discount / Final total */}
          <div className="border-t border-outline-variant pt-4 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Subtotal</span>
              <span className="tabular-nums font-mono text-on-surface">
                {formatCurrency(subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Discount</span>
              <span className="tabular-nums font-mono text-on-surface">
                −{formatCurrency(entry.discount)}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-outline-variant/40">
              <span className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
                Total
              </span>
              <span className="text-2xl font-display tabular-nums text-on-surface">
                {formatCurrency(entry.total)}
              </span>
            </div>
          </div>

          {entry.notes && (
            <LabeledField label="Notes" value={entry.notes} multiline />
          )}

          {/* Attachment (read-only — Replace lives in the row-level 📎 modal) */}
          <div>
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-2">
              Attachment
            </p>
            {entry.bill ? (
              <div className="border border-outline-variant bg-surface-container-low p-3 flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-on-surface truncate flex-1">
                  {entry.bill.originalFilename}
                </span>
                <button
                  type="button"
                  onClick={openBill}
                  disabled={billOpening}
                  className="ml-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-surface-container-high text-on-surface hover:bg-surface-container-highest border border-outline-variant transition-colors"
                >
                  {billOpening ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <>
                      <ExternalLink className="size-3.5" />
                      View
                    </>
                  )}
                </button>
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant italic">
                No bill uploaded.
              </p>
            )}
          </div>

          {/* Payments history (read-only) */}
          <ReadOnlyPaymentsList
            payments={entry.payments}
            paidAmount={entry.paidAmount}
          />
        </div>

        <div className="mt-6 -mx-6 -mb-6 px-6 py-4 border-t border-outline-variant flex items-center justify-end">
          <Link
            href={`/casting/${entry.id}/edit`}
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
  payments: CastingEntryForClient["payments"];
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
          // For Casting, REFUND = vendor refunded shop (money IN). Use
          // the Purchases-direction colour (secondary/blue) + plus prefix
          // — money INTO the shop is the positive direction here.
          return (
            <div
              key={p.id}
              className="grid grid-cols-[100px_90px_1fr_120px] gap-2 items-center text-sm px-3 py-2"
            >
              <span className="text-xs text-on-surface-variant tabular-nums">
                {formatDate(p.date)}
              </span>
              <span
                className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 inline-block w-fit ${
                  isRefund
                    ? "bg-secondary-container/40 text-secondary"
                    : "bg-surface-container-high text-on-surface-variant"
                }`}
              >
                {isRefund ? "Refund received" : p.type}
              </span>
              <span className="text-xs text-on-surface-variant truncate">
                {p.note ?? ""}
              </span>
              <span
                className={`text-right tabular-nums font-mono text-sm ${
                  isRefund ? "text-secondary" : ""
                }`}
              >
                {isRefund ? "+" : ""}
                {formatCurrency(p.amount)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
