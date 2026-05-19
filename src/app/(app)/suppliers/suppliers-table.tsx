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
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import type { Party as Supplier } from "@/generated/prisma";
import { formatDate } from "@/lib/format";
import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";

import { softDeleteSupplier } from "./actions";
import { SupplierDetailModal } from "./supplier-detail-modal";
import { SupplierFormModal } from "./supplier-form-modal";

type Props = { parties: Supplier[] };

export function SuppliersTable({ parties: suppliers }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | null>(null);

  // Per-row delete confirmation (inline; matches the design-system pattern
  // of replacing the action cluster rather than overlaying a separate modal).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // TanStack state
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<Supplier>[] = [
    {
      accessorKey: "name",
      header: "Name",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-on-surface">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "phone",
      header: "Phone",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-on-surface-variant tabular-nums">
          {row.original.phone ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-on-surface-variant tabular-nums">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <ActionCell
          supplier={row.original}
          isConfirming={confirmDeleteId === row.original.id}
          isPending={isPending}
          onEdit={() => setEditingSupplier(row.original)}
          onRequestDelete={() => setConfirmDeleteId(row.original.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleDelete(row.original.id)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: suppliers,
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
        r.name.toLowerCase().includes(q) ||
        (r.phone ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q)
      );
    },
  });

  function handleDelete(id: string) {
    startTransition(async () => {
      await softDeleteSupplier(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasSuppliers = suppliers.length > 0;
  const hasMatches = rows.length > 0;

  return (
    <>
      {/* Header bar: search + add — Phase 11.1 hotfix pattern. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <input
          type="search"
          placeholder="Search suppliers…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full sm:flex-1 min-w-0 bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
        />
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="h-11 sm:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto"
        >
          <Plus className="size-4" />
          <span>Add supplier</span>
        </button>
      </div>

      {hasSuppliers && (
        <ResponsiveTable
          desktopTable={
            <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
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
                    <SupplierRow
                      key={row.id}
                      row={row}
                      onRowClick={(s) => setViewingSupplier(s)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <>
              {rows.map((row) => (
                <SupplierMobileCard
                  key={row.id}
                  supplier={row.original}
                  onCardClick={() => setViewingSupplier(row.original)}
                />
              ))}
            </>
          }
        />
      )}

      {/* Empty states */}
      {!hasSuppliers && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No suppliers yet. Add your first supplier to get started.
          </p>
        </div>
      )}
      {hasSuppliers && !hasMatches && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No suppliers match your search.
          </p>
        </div>
      )}

      {/* Add / Edit form modal — same component, mode toggled by `supplier` prop */}
      <SupplierFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        supplier={undefined}
      />
      <SupplierFormModal
        open={editingSupplier !== null}
        onOpenChange={(open) => !open && setEditingSupplier(null)}
        supplier={editingSupplier ?? undefined}
      />

      {/* Detail modal — opened by row click. Edit transitions to the form modal. */}
      <SupplierDetailModal
        open={viewingSupplier !== null}
        onOpenChange={(open) => !open && setViewingSupplier(null)}
        supplier={viewingSupplier}
        onEdit={() => {
          const target = viewingSupplier;
          setViewingSupplier(null);
          setEditingSupplier(target);
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

// Phase 11.2: simpler mobile card for master data — name + phone, no
// inline action buttons. Mutations go through the detail modal's Edit link.
function SupplierMobileCard({
  supplier,
  onCardClick,
}: {
  supplier: Supplier;
  onCardClick: () => void;
}) {
  return (
    <MobileCard
      clickable
      onClick={onCardClick}
      data-testid={`supplier-mobile-card-${supplier.id}`}
    >
      <MobileCardHeader>
        <MobileCardTitle>{supplier.name}</MobileCardTitle>
      </MobileCardHeader>
      {supplier.phone && (
        <div className="text-sm text-on-surface-variant tabular-nums">
          {supplier.phone}
        </div>
      )}
    </MobileCard>
  );
}

function SupplierRow({
  row,
  onRowClick,
}: {
  row: Row<Supplier>;
  onRowClick?: (supplier: Supplier) => void;
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
  supplier: _supplier,
  isConfirming,
  isPending,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  supplier: Supplier;
  isConfirming: boolean;
  isPending: boolean;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  // stopPropagation everywhere — the row click must not fire when the user
  // is targeting one of these action buttons.
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
        aria-label="Edit supplier"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Delete supplier"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
