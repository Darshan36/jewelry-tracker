"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Row,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  DollarSign,
  Edit3,
  Link as LinkIcon,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/format";
import {
  PaymentActionModal,
} from "@/components/action-modals/payment-action-modal";
import {
  BillActionModal,
} from "@/components/action-modals/bill-action-modal";

import {
  attachBillToPlatingEntry,
  detachBillFromPlatingEntry,
  softDeletePlatingEntry,
} from "./actions";
import { createPlatingPayment } from "./payment-actions";
import { PlatingDetailModal } from "./plating-detail-modal";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import type { PlatingEntryForClient } from "./plating-helpers";

type Props = {
  entries: PlatingEntryForClient[];
};

export function PlatingTable({ entries }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Phase 10.6: derive viewing entry from id (live-update pattern).
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = viewingId
    ? (entries.find((e) => e.id === viewingId) ?? null)
    : null;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Phase 10.6: TWO action-modal state slots (Pay, Bill) — Plating has
  // no Returns workflow so there's no third slot.
  const [paymentRowId, setPaymentRowId] = useState<string | null>(null);
  const [billRowId, setBillRowId] = useState<string | null>(null);

  const paymentRow = paymentRowId
    ? (entries.find((e) => e.id === paymentRowId) ?? null)
    : null;

  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<PlatingEntryForClient>[] = [
    {
      accessorKey: "date",
      header: "Date",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-on-surface-variant tabular-nums">
          {formatDate(row.original.date)}
        </span>
      ),
    },
    {
      accessorKey: "partyName",
      header: "Vendor",
      enableSorting: true,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.vendorId !== null && (
            <LinkIcon
              className="size-3 text-secondary shrink-0"
              aria-label="Linked vendor"
            />
          )}
          <div className="min-w-0">
            <div className="text-on-surface truncate">
              {row.original.partyName}
            </div>
            {row.original.partyPhone && (
              <div className="text-on-surface-variant tabular-nums text-xs truncate">
                {row.original.partyPhone}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "materials",
      header: "Materials",
      enableSorting: false,
      cell: ({ row }) => {
        const lines = row.original.lineItems;
        if (lines.length === 0)
          return <span className="text-on-surface-variant">—</span>;
        const first = lines[0].materialDescription;
        const extra = lines.length - 1;
        return (
          <span className="text-on-surface-variant text-sm">
            {first}
            {extra > 0 && (
              <span className="text-on-surface-variant"> + {extra} more</span>
            )}
          </span>
        );
      },
    },
    {
      accessorKey: "total",
      header: "Total",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-on-surface tabular-nums font-mono">
          {formatCurrency(row.original.total)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => <TransactionStatusChip status={row.original.status} />,
    },
    {
      id: "quickActions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => (
        <QuickActions
          onPay={() => setPaymentRowId(row.original.id)}
          onBill={() => setBillRowId(row.original.id)}
        />
      ),
    },
    {
      id: "rowActions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions
          entryId={row.original.id}
          isConfirming={confirmDeleteId === row.original.id}
          isPending={isPending}
          onRequestDelete={() => setConfirmDeleteId(row.original.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleDelete(row.original.id)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: entries,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).toLowerCase().trim();
      if (!q) return true;
      const r = row.original;
      if (r.partyName.toLowerCase().includes(q)) return true;
      if ((r.partyPhone ?? "").toLowerCase().includes(q)) return true;
      for (const li of r.lineItems) {
        if (li.materialDescription.toLowerCase().includes(q)) return true;
      }
      return false;
    },
  });

  function handleDelete(id: string) {
    startTransition(async () => {
      await softDeletePlatingEntry(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasEntries = entries.length > 0;
  const hasMatches = rows.length > 0;

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search plating entries…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="flex-1 bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
        />
        <Link
          href="/plating/new"
          className="h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center gap-2 shrink-0"
        >
          <Plus className="size-4" />
          <span>Add plating entry</span>
        </Link>
      </div>

      <div className="border border-outline-variant bg-surface-container-low">
        {hasEntries && (
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high sticky top-0">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3"
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="flex items-center gap-1.5 hover:text-on-surface transition-colors"
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                            <SortIndicator sorted={sorted} />
                          </button>
                        ) : (
                          flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((row) => (
                <EntryRow
                  key={row.id}
                  row={row}
                  onRowClick={(e) => setViewingId(e.id)}
                />
              ))}
            </tbody>
          </table>
        )}

        {!hasEntries && (
          <div className="p-12 text-center">
            <p className="text-on-surface-variant text-sm">
              No plating entries yet. Add your first one to get started.
            </p>
          </div>
        )}
        {hasEntries && !hasMatches && (
          <div className="p-12 text-center">
            <p className="text-on-surface-variant text-sm">
              No plating entries match your search.
            </p>
          </div>
        )}
      </div>

      <PlatingDetailModal
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewingId(null)}
        entry={viewing}
      />

      {paymentRow && (
        <PaymentActionModal
          entityType="plating"
          entityId={paymentRow.id}
          entityTotal={paymentRow.total}
          entityPaidAmount={paymentRow.paidAmount}
          open={paymentRowId !== null}
          onClose={() => setPaymentRowId(null)}
          // Prop-injection dispatch (Phase 10.5 pattern). The modal stays
          // entity-agnostic; we close over the plating-specific server
          // action here.
          onSave={(data) =>
            createPlatingPayment({
              platingEntryId: paymentRow.id,
              date: data.date,
              amount: data.amount,
              type: data.type,
              note: data.note,
            })
          }
        />
      )}

      {billRowId && (
        // Plating bill flow uses the FK-based attachment pattern (the
        // PlatingEntry row carries a `billId @unique` FK), so the modal
        // gets the onAttach/onDetach callbacks. The modal still runs the
        // discriminator-side `getBillForEntity` to load the existing
        // bill (via attachedToType="PLATING_ENTRY" + attachedToId), then
        // attaches/detaches the FK on either side of the upload.
        <BillActionModal
          entityType="plating"
          entityId={billRowId}
          open={billRowId !== null}
          onClose={() => setBillRowId(null)}
          onAttach={(entityId, billId) =>
            attachBillToPlatingEntry(entityId, billId)
          }
          onDetach={(entityId) => detachBillFromPlatingEntry(entityId)}
        />
      )}
    </>
  );
}

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="size-3" />;
  if (sorted === "desc") return <ArrowDown className="size-3" />;
  return <ArrowUpDown className="size-3 opacity-40" />;
}

function EntryRow({
  row,
  onRowClick,
}: {
  row: Row<PlatingEntryForClient>;
  onRowClick?: (entry: PlatingEntryForClient) => void;
}) {
  return (
    <tr
      onClick={onRowClick ? () => onRowClick(row.original) : undefined}
      className={`
        group
        odd:bg-surface-container-low even:bg-surface-container
        hover:bg-surface-container-high
        ${onRowClick ? "cursor-pointer" : ""}
        border-b border-outline-variant last:border-b-0
        transition-colors
      `}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-4 py-3 align-middle">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

function QuickActions({
  onPay,
  onBill,
}: {
  onPay: () => void;
  onBill: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onPay}
        aria-label="Add payment"
        title="Add payment"
        className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-surface-container transition-colors"
      >
        <DollarSign className="size-4" />
      </button>
      <button
        type="button"
        onClick={onBill}
        aria-label="Manage bill"
        title="Manage bill"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Paperclip className="size-4" />
      </button>
    </div>
  );
}

function RowActions({
  entryId,
  isConfirming,
  isPending,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  entryId: string;
  isConfirming: boolean;
  isPending: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  if (isConfirming) {
    return (
      <div
        className="flex items-center justify-end gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs uppercase tracking-wider text-error">
          Delete?
        </span>
        <button
          type="button"
          onClick={onCancelDelete}
          disabled={isPending}
          className="px-2 py-1 text-xs uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirmDelete}
          disabled={isPending}
          className="min-w-[70px] h-7 px-2 text-xs font-display uppercase tracking-wider bg-error text-on-error hover:bg-error/90 disabled:opacity-70 transition-colors flex items-center justify-center gap-1.5"
        >
          {isPending ? <Loader2 className="size-3 animate-spin" /> : "Delete"}
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      <Link
        href={`/plating/${entryId}/edit`}
        aria-label="Edit plating entry"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </Link>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Delete plating entry"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
