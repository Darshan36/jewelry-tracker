"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
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
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[500px] md:p-6"
        mobileClassName="p-4"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            <span className="inline-flex items-center gap-3 flex-wrap">
              <span>{employee.name}</span>
              <TypeChip type={employee.type} />
            </span>
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

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

        <div className="mt-6 -mx-4 -mb-4 md:-mx-6 md:-mb-6 px-4 md:px-6 py-4 border-t border-outline-variant">
          {confirmingDelete ? (
            <div className="flex flex-col-reverse md:flex-row md:items-center gap-3">
              <p className="md:flex-1 text-sm text-on-surface">
                Delete employee? This can be undone by an admin.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={isPending}
                  className="h-11 md:h-9 px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending}
                  className="min-w-[100px] h-11 md:h-9 px-3 font-display text-sm font-medium uppercase tracking-wider bg-error text-on-error hover:bg-error/90 disabled:opacity-70 transition-colors flex items-center justify-center gap-2"
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Delete"
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="h-11 md:h-9 px-3 py-2 text-sm text-error hover:bg-surface-container transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="h-11 md:h-9 px-4 bg-secondary-container text-on-secondary-container font-display text-sm font-medium uppercase tracking-wider hover:bg-secondary-container/90 transition-colors"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
