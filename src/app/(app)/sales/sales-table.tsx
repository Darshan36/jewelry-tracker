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

import { softDeleteSale } from "./actions";
import { SaleDetailModal } from "./sale-detail-modal";
import { SaleFormModal } from "./sale-form-modal";
import { SaleStatusChip } from "./sale-status-chip";
import type { CustomerOption } from "./party-picker";
import type { SaleForClient } from "./sale-helpers";

type Props = {
  sales: SaleForClient[];
  customers: CustomerOption[];
};

export function SalesTable({ sales, customers }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<SaleForClient | null>(null);
  // Derive the currently-viewed sale from the sales array using just an id,
  // not a snapshot copy. After PaymentPanel's `router.refresh()` re-fetches
  // the page, the parent passes fresh `sales` here, the .find lookup yields
  // the updated row, and the detail modal re-renders with new status /
  // paidAmount / payments without needing the user to close and reopen.
  // If the sale is soft-deleted while the modal is open (e.g. via the
  // modal's own Delete button), .find returns undefined → viewingSale
  // becomes null → modal auto-closes. Desired.
  const [viewingSaleId, setViewingSaleId] = useState<string | null>(null);
  const viewingSale = viewingSaleId
    ? (sales.find((s) => s.id === viewingSaleId) ?? null)
    : null;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<SaleForClient>[] = [
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
          {row.original.customerId !== null && (
            <LinkIcon
              className="size-3 text-secondary shrink-0"
              aria-label="Linked customer"
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
      accessorKey: "itemDescription",
      header: "Item",
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className="text-on-surface block max-w-[280px] truncate"
          title={row.original.itemDescription}
        >
          {row.original.itemDescription}
        </span>
      ),
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
      cell: ({ row }) => <SaleStatusChip status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <ActionCell
          isConfirming={confirmDeleteId === row.original.id}
          isPending={isPending}
          onEdit={() => setEditingSale(row.original)}
          onRequestDelete={() => setConfirmDeleteId(row.original.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleDelete(row.original.id)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: sales,
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
        r.itemDescription.toLowerCase().includes(q)
      );
    },
  });

  function handleDelete(id: string) {
    startTransition(async () => {
      await softDeleteSale(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasSales = sales.length > 0;
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
          <span>Add sale</span>
        </button>
      </div>

      <div className="border border-outline-variant bg-surface-container-low">
        {hasSales && (
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
                <SaleRow
                  key={row.id}
                  row={row}
                  onRowClick={(s) => setViewingSaleId(s.id)}
                />
              ))}
            </tbody>
          </table>
        )}

        {!hasSales && (
          <div className="p-12 text-center">
            <p className="text-on-surface-variant text-sm">
              No sales yet. Add your first sale to get started.
            </p>
          </div>
        )}
        {hasSales && !hasMatches && (
          <div className="p-12 text-center">
            <p className="text-on-surface-variant text-sm">
              No sales match your search.
            </p>
          </div>
        )}
      </div>

      <SaleFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        sale={undefined}
        customers={customers}
      />
      <SaleFormModal
        open={editingSale !== null}
        onOpenChange={(open) => !open && setEditingSale(null)}
        sale={editingSale ?? undefined}
        customers={customers}
      />

      <SaleDetailModal
        open={viewingSale !== null}
        onOpenChange={(open) => !open && setViewingSaleId(null)}
        sale={viewingSale}
        onEdit={() => {
          const target = viewingSale;
          setViewingSaleId(null);
          setEditingSale(target);
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

function SaleRow({
  row,
  onRowClick,
}: {
  row: Row<SaleForClient>;
  onRowClick?: (sale: SaleForClient) => void;
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
        aria-label="Edit sale"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Delete sale"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
