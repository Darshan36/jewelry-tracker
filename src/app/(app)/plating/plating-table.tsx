"use client";

import { useState } from "react";
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
  Plus,
} from "lucide-react";

import { TransactionStatusChip } from "@/components/transaction-status-chip";
import { formatCurrency, formatDate } from "@/lib/format";

import { PlatingDetailModal } from "./plating-detail-modal";
import { PlatingFormModal } from "./plating-form-modal";
import type { VendorOption } from "./party-picker";
import type { PlatingEntryForClient } from "./plating-helpers";

type Props = {
  entries: PlatingEntryForClient[];
  vendors: VendorOption[];
};

export function PlatingTable({ entries, vendors }: Props) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

  // Live-derive the viewed entity from the parent array (Phase 3.2 pattern)
  // so the detail modal re-renders with fresh data after router.refresh().
  const viewing = viewingId ? entries.find((e) => e.id === viewingId) : null;
  const editing = editingId ? entries.find((e) => e.id === editingId) : null;

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
        <span className="text-on-surface-variant tabular-nums text-xs">
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
          <span className="text-on-surface">{row.original.partyName}</span>
          {!row.original.vendor && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-surface-container-high text-on-surface-variant border border-outline-variant">
              Walk-in
            </span>
          )}
        </div>
      ),
    },
    {
      id: "materials",
      header: "Materials",
      enableSorting: false,
      cell: ({ row }) => {
        const lines = row.original.lineItems;
        if (lines.length === 0) return <span>—</span>;
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
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center gap-2 shrink-0"
        >
          <Plus className="size-4" />
          <span>Add plating entry</span>
        </button>
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
                  onClick={(e) => setViewingId(e.id)}
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

      <PlatingFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        entry={undefined}
        vendors={vendors}
      />
      <PlatingFormModal
        open={editing !== undefined && editing !== null}
        onOpenChange={(open) => !open && setEditingId(null)}
        entry={editing ?? undefined}
        vendors={vendors}
      />
      <PlatingDetailModal
        open={viewing !== null}
        onOpenChange={(open) => !open && setViewingId(null)}
        entry={viewing ?? null}
        onEdit={() => {
          if (viewing) {
            setEditingId(viewing.id);
            setViewingId(null);
          }
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

function EntryRow({
  row,
  onClick,
}: {
  row: Row<PlatingEntryForClient>;
  onClick: (entry: PlatingEntryForClient) => void;
}) {
  return (
    <tr
      onClick={() => onClick(row.original)}
      className="odd:bg-surface-container-low even:bg-surface-container hover:bg-surface-container-high cursor-pointer border-b border-outline-variant last:border-b-0 transition-colors"
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-4 py-3 align-middle">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}
