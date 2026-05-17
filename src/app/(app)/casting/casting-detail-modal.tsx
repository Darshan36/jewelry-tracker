"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LabeledField } from "@/components/labeled-field";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import { formatCurrency, formatDate } from "@/lib/format";
import { formatKg } from "@/lib/weight-helpers";
import { getBillViewUrl } from "@/app/(app)/bills/actions";

import { softDeleteCastingEntry } from "./actions";
import type { CastingEntryForClient } from "./casting-helpers";
import { PaymentPanel } from "./payment-panel";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: CastingEntryForClient | null;
  onEdit: () => void;
};

export function CastingDetailModal({
  open,
  onOpenChange,
  entry,
  onEdit,
}: Props) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [billOpening, setBillOpening] = useState(false);

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open, entry?.id]);

  if (!entry) return null;

  const subtotal = entry.lineItems.reduce((s, l) => s + l.lineTotal, 0);

  const handleDelete = () => {
    startTransition(async () => {
      await softDeleteCastingEntry(entry.id);
      setConfirmingDelete(false);
      onOpenChange(false);
      router.refresh();
    });
  };

  const openBill = async () => {
    if (!entry.bill) return;
    setBillOpening(true);
    try {
      const res = await getBillViewUrl(entry.bill.id);
      if (res.ok) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setBillOpening(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[820px] bg-surface-container border border-outline-variant p-6 gap-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-6">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-lg font-semibold tracking-tight text-on-surface">
              Casting entry — {entry.partyName}
            </DialogTitle>
            <TransactionStatusChip status={entry.status} />
          </div>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <LabeledField label="Date" value={formatDate(entry.date)} />
            <LabeledField label="Vendor phone" value={entry.partyPhone} />
            <LabeledField
              label="Vendor link"
              value={entry.vendor ? "Linked vendor" : "Walk-in"}
            />
          </div>

          {/* Line items */}
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
            <div className="mt-2 grid grid-cols-[1fr_130px] gap-2 text-sm">
              <span className="text-right text-on-surface-variant">
                Subtotal
              </span>
              <span className="text-right tabular-nums font-mono">
                {formatCurrency(subtotal)}
              </span>
              <span className="text-right text-on-surface-variant">
                Discount
              </span>
              <span className="text-right tabular-nums font-mono">
                {formatCurrency(entry.discount)}
              </span>
              <span className="text-right font-display uppercase tracking-wider text-xs text-on-surface-variant border-t border-outline-variant pt-1">
                Total
              </span>
              <span className="text-right tabular-nums font-mono text-base border-t border-outline-variant pt-1">
                {formatCurrency(entry.total)}
              </span>
            </div>
          </div>

          {/* Notes */}
          {entry.notes && (
            <LabeledField label="Notes" value={entry.notes} multiline />
          )}

          {/* Bill */}
          <div>
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-2">
              Bill
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

          {/* Payments */}
          <PaymentPanel entry={entry} payments={entry.payments} />
        </div>

        <div className="mt-6 -mx-6 -mb-6 px-6 py-4 border-t border-outline-variant">
          {confirmingDelete ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-on-surface">
                Delete casting entry? This can be undone by an admin.
              </p>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={isPending}
                className="px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="min-w-[100px] h-9 px-3 font-display text-sm font-medium uppercase tracking-wider bg-error text-on-error hover:bg-error/90 disabled:opacity-70 transition-colors flex items-center justify-center gap-2"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="px-3 py-2 text-sm text-error hover:bg-surface-container transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="h-9 px-4 bg-secondary-container text-on-secondary-container font-display text-sm font-medium uppercase tracking-wider hover:bg-secondary-container/90 transition-colors"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
