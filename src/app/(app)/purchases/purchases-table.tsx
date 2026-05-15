"use client";

import { useState, useTransition } from "react";
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
  Edit3,
  Link as LinkIcon,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/format";

import { softDeletePurchase } from "./actions";
import { PurchaseDetailModal } from "./purchase-detail-modal";
import { PurchaseFormModal } from "./purchase-form-modal";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import type { SupplierOption } from "./party-picker";
import type { PurchaseForClient } from "./purchase-helpers";

type Props = {
  purchases: PurchaseForClient[];
  suppliers: SupplierOption[];
};

export function PurchasesTable({ purchases, suppliers }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] =
    useState<PurchaseForClient | null>(null);
  // Derive viewing purchase from id + array — Phase 3.2 live-update pattern.
  const [viewingPurchaseId, setViewingPurchaseId] = useState<string | null>(
    null,
  );
  const viewingPurchase = viewingPurchaseId
    ? (purchases.find((p) => p.id === viewingPurchaseId) ?? null)
    : null;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<PurchaseForClient>[] = [
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
      header: "Party",
      enableSorting: true,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          {row.original.supplierId !== null && (
            <LinkIcon
              className="size-3 text-secondary shrink-0"
              aria-label="Linked supplier"
            />
          )}
          <div className="min-w-0">
            <div className="text-on-surface truncate">
              {row.original.partyName}
            </div>
            {row.original.partyPhone && (
              <div className="text-xs text-on-surface-variant tabular-nums truncate">
                {row.original.partyPhone}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: "items",
      header: "Items",
      enableSorting: false,
      cell: ({ row }) => {
        const lines = row.original.lineItems;
        if (lines.length === 0) return <span className="text-on-surface-variant">—</span>;
        const first = lines[0].itemDescription;
        const more = lines.length > 1 ? ` + ${lines.length - 1} more` : "";
        const summary = `${first}${more}`;
        const titleAll = lines
          .map((l) => `${l.itemDescription} (×${l.qty})`)
          .join(", ");
        return (
          <span
            className="text-on-surface block max-w-[280px] truncate"
            title={titleAll}
          >
            {summary}
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
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <ActionCell
          isConfirming={confirmDeleteId === row.original.id}
          isPending={isPending}
          onEdit={() => setEditingPurchase(row.original)}
          onRequestDelete={() => setConfirmDeleteId(row.original.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleDelete(row.original.id)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: purchases,
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
      return (
        r.partyName.toLowerCase().includes(q) ||
        (r.partyPhone ?? "").toLowerCase().includes(q) ||
        r.lineItems.some((li) =>
          li.itemDescription.toLowerCase().includes(q),
        )
      );
    },
  });

  function handleDelete(id: string) {
    startTransition(async () => {
      await softDeletePurchase(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasPurchases = purchases.length > 0;
  const hasMatches = rows.length > 0;

  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="search"
          placeholder="Search by party, phone, or item…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="flex-1 bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
        />
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center gap-2 shrink-0"
        >
          <Plus className="size-4" />
          <span>Add purchase</span>
        </button>
      </div>

      <div className="border border-outline-variant bg-surface-container-low">
        {hasPurchases && (
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
                <PurchaseRow
                  key={row.id}
                  row={row}
                  onRowClick={(p) => setViewingPurchaseId(p.id)}
                />
              ))}
            </tbody>
          </table>
        )}

        {!hasPurchases && (
          <div className="p-12 text-center">
            <p className="text-on-surface-variant text-sm">
              No purchases yet. Add your first purchase to get started.
            </p>
          </div>
        )}
        {hasPurchases && !hasMatches && (
          <div className="p-12 text-center">
            <p className="text-on-surface-variant text-sm">
              No purchases match your search.
            </p>
          </div>
        )}
      </div>

      <PurchaseFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        purchase={undefined}
        suppliers={suppliers}
      />
      <PurchaseFormModal
        open={editingPurchase !== null}
        onOpenChange={(open) => !open && setEditingPurchase(null)}
        purchase={editingPurchase ?? undefined}
        suppliers={suppliers}
      />

      <PurchaseDetailModal
        open={viewingPurchase !== null}
        onOpenChange={(open) => !open && setViewingPurchaseId(null)}
        purchase={viewingPurchase}
        onEdit={() => {
          const target = viewingPurchase;
          setViewingPurchaseId(null);
          setEditingPurchase(target);
        }}
      />
    </>
  );
}

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="size-3" />;
  if (sorted === "desc") return <ArrowDown className="size-3" />;
  return <ArrowUpDown className="size-3 opacity-40" />;
}

function PurchaseRow({
  row,
  onRowClick,
}: {
  row: Row<PurchaseForClient>;
  onRowClick?: (purchase: PurchaseForClient) => void;
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

function ActionCell({
  isConfirming,
  isPending,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  isConfirming: boolean;
  isPending: boolean;
  onEdit: () => void;
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
      <button
        type="button"
        onClick={onEdit}
        aria-label="Edit purchase"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Delete purchase"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
