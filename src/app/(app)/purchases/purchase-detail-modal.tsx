"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link as LinkIcon, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LabeledField } from "@/components/labeled-field";
import { formatCurrency, formatDate } from "@/lib/format";

import { softDeletePurchase } from "./actions";
import { PaymentPanel } from "./payment-panel";
import { ReturnPanel } from "./return-panel";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import type { PurchaseForClient } from "./purchase-helpers";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase: PurchaseForClient | null;
  onEdit: () => void;
};

export function PurchaseDetailModal({
  open,
  onOpenChange,
  purchase,
  onEdit,
}: Props) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open, purchase?.id]);

  if (!purchase) return null;

  const handleDelete = () => {
    startTransition(async () => {
      await softDeletePurchase(purchase.id);
      setConfirmingDelete(false);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[600px] bg-surface-container border border-outline-variant p-6 gap-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-lg font-semibold tracking-tight text-on-surface flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-2">
              {purchase.supplierId !== null && (
                <LinkIcon
                  className="size-4 text-secondary"
                  aria-label="Linked supplier"
                />
              )}
              <span>{purchase.partyName}</span>
            </span>
            <TransactionStatusChip status={purchase.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-5">
            <LabeledField label="Date" value={formatDate(purchase.date)} />
            <LabeledField label="Phone" value={purchase.partyPhone} />
          </div>

          <LabeledField
            label="Item"
            value={purchase.itemDescription}
            multiline
          />

          <div className="grid grid-cols-3 gap-5">
            <LabeledField label="Qty" value={String(purchase.qty)} />
            <LabeledField label="Rate" value={formatCurrency(purchase.rate)} />
            <LabeledField
              label="Discount"
              value={formatCurrency(purchase.discount)}
            />
          </div>

          <div className="border-t border-outline-variant pt-4">
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-1">
              Total
            </p>
            <p className="text-2xl font-display tabular-nums text-on-surface">
              {formatCurrency(purchase.total)}
            </p>
          </div>

          {purchase.notes && (
            <LabeledField label="Notes" value={purchase.notes} multiline />
          )}

          <PaymentPanel purchase={purchase} payments={purchase.payments} />
          <ReturnPanel purchase={purchase} returns={purchase.returns} />
        </div>

        <div className="mt-6 -mx-6 -mb-6 px-6 py-4 border-t border-outline-variant">
          {confirmingDelete ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-on-surface">
                Delete purchase? This can be undone by an admin.
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
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Delete"
                )}
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
