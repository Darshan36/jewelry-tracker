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

import { softDeleteSale } from "./actions";
import { PaymentPanel } from "./payment-panel";
import { SaleStatusChip } from "./sale-status-chip";
import type { SaleForClient } from "./sale-helpers";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sale: SaleForClient | null;
  onEdit: () => void;
};

export function SaleDetailModal({
  open,
  onOpenChange,
  sale,
  onEdit,
}: Props) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open, sale?.id]);

  if (!sale) return null;

  const handleDelete = () => {
    startTransition(async () => {
      await softDeleteSale(sale.id);
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
              {sale.customerId !== null && (
                <LinkIcon
                  className="size-4 text-secondary"
                  aria-label="Linked customer"
                />
              )}
              <span>{sale.partyName}</span>
            </span>
            <SaleStatusChip status={sale.status} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-5">
            <LabeledField label="Date" value={formatDate(sale.date)} />
            <LabeledField label="Phone" value={sale.partyPhone} />
          </div>

          <LabeledField
            label="Item"
            value={sale.itemDescription}
            multiline
          />

          <div className="grid grid-cols-3 gap-5">
            <LabeledField label="Qty" value={String(sale.qty)} />
            <LabeledField label="Rate" value={formatCurrency(sale.rate)} />
            <LabeledField
              label="Discount"
              value={formatCurrency(sale.discount)}
            />
          </div>

          {/* Total emphasized */}
          <div className="border-t border-outline-variant pt-4">
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant mb-1">
              Total
            </p>
            <p className="text-2xl font-display tabular-nums text-on-surface">
              {formatCurrency(sale.total)}
            </p>
          </div>

          {sale.notes && (
            <LabeledField label="Notes" value={sale.notes} multiline />
          )}

          <PaymentPanel sale={sale} payments={sale.payments} />
        </div>

        <div className="mt-6 -mx-6 -mb-6 px-6 py-4 border-t border-outline-variant">
          {confirmingDelete ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-on-surface">
                Delete sale? This can be undone by an admin.
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
