"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LabeledField } from "@/components/labeled-field";
import { formatCurrency, formatDate } from "@/lib/format";

import { softDeleteVendor } from "./actions";
import type { VendorForClient } from "./vendors-table";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor: VendorForClient | null;
  onEdit: () => void;
};

export function VendorDetailModal({
  open,
  onOpenChange,
  vendor,
  onEdit,
}: Props) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open, vendor?.id]);

  if (!vendor) return null;

  const handleDelete = () => {
    startTransition(async () => {
      await softDeleteVendor(vendor.id);
      setConfirmingDelete(false);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[500px] bg-surface-container border border-outline-variant p-6 gap-0">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-lg font-semibold tracking-tight text-on-surface">
            {vendor.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <LabeledField label="Phone" value={vendor.phone} />
          <LabeledField label="Address" value={vendor.address} multiline />
          <LabeledField label="Notes" value={vendor.notes} multiline />
          <div className="grid grid-cols-3 gap-4">
            <LabeledField
              label="Casting jobs"
              value={String(vendor.castingCount)}
            />
            <LabeledField
              label="Plating jobs"
              value={String(vendor.platingCount)}
            />
            <LabeledField
              label="Owed"
              value={
                vendor.owedPaise > 0 ? formatCurrency(vendor.owedPaise) : "—"
              }
            />
          </div>
          <LabeledField label="Created" value={formatDate(vendor.createdAt)} />
        </div>

        <div className="mt-6 -mx-6 -mb-6 px-6 py-4 border-t border-outline-variant">
          {confirmingDelete ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-on-surface">
                Delete vendor? This can be undone by an admin.
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
