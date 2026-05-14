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

import { softDeleteEmployee } from "./actions";
import { TypeChip } from "./type-chip";
import type { EmployeeForClient } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeForClient | null;
  onEdit: () => void;
};

export function EmployeeDetailModal({
  open,
  onOpenChange,
  employee,
  onEdit,
}: Props) {
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open, employee?.id]);

  if (!employee) return null;

  const handleDelete = () => {
    startTransition(async () => {
      await softDeleteEmployee(employee.id);
      setConfirmingDelete(false);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[500px] bg-surface-container border border-outline-variant p-6 gap-0">
        <DialogHeader className="mb-6">
          <DialogTitle className="text-lg font-semibold tracking-tight text-on-surface flex items-center gap-3">
            <span>{employee.name}</span>
            <TypeChip type={employee.type} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <LabeledField label="Phone" value={employee.phone} />
          {/* monthlySalary only shown for FIXED — LABOUR has no salary by design. */}
          {employee.type === "FIXED" && (
            <LabeledField
              label="Monthly salary"
              value={formatCurrency(employee.monthlySalary)}
            />
          )}
          <LabeledField label="Address" value={employee.address} multiline />
          <LabeledField label="Notes" value={employee.notes} multiline />
          <LabeledField label="Created" value={formatDate(employee.createdAt)} />
        </div>

        <div className="mt-6 -mx-6 -mb-6 px-6 py-4 border-t border-outline-variant">
          {confirmingDelete ? (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-on-surface">
                Delete employee? This can be undone by an admin.
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
