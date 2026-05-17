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

import { formatCurrency, formatDate } from "@/lib/format";
import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";

import { softDeleteVendor } from "./actions";
import { VendorDetailModal } from "./vendor-detail-modal";
import { VendorFormModal } from "./vendor-form-modal";

// Vendor as passed from the server page. Includes precomputed aggregates
// (casting/plating counts + owed total in paise) so the table doesn't
// have to re-fetch.
export type VendorForClient = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  castingCount: number;
  platingCount: number;
  owedPaise: number;
};

type Props = { vendors: VendorForClient[] };

export function VendorsTable({ vendors }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorForClient | null>(null);
  const [viewingVendor, setViewingVendor] = useState<VendorForClient | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<VendorForClient>[] = [
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
      accessorKey: "castingCount",
      header: "Casting",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-on-surface-variant tabular-nums">
          {row.original.castingCount}
        </span>
      ),
    },
    {
      accessorKey: "platingCount",
      header: "Plating",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-on-surface-variant tabular-nums">
          {row.original.platingCount}
        </span>
      ),
    },
    {
      accessorKey: "owedPaise",
      header: "Owed",
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-on-surface tabular-nums">
          {row.original.owedPaise > 0
            ? formatCurrency(row.original.owedPaise)
            : "—"}
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
          isConfirming={confirmDeleteId === row.original.id}
          isPending={isPending}
          onEdit={() => setEditingVendor(row.original)}
          onRequestDelete={() => setConfirmDeleteId(row.original.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleDelete(row.original.id)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: vendors,
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
        (r.phone ?? "").toLowerCase().includes(q)
      );
    },
  });

  function handleDelete(id: string) {
    startTransition(async () => {
      await softDeleteVendor(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasVendors = vendors.length > 0;
  const hasMatches = rows.length > 0;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <input
          type="search"
          placeholder="Search vendors…"
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
          <span>Add vendor</span>
        </button>
      </div>

      {hasVendors && (
        <ResponsiveTable
          desktopTable={
            <div className="border border-outline-variant bg-surface-container-low">
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
                    <VendorRow
                      key={row.id}
                      row={row}
                      onRowClick={(v) => setViewingVendor(v)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <>
              {rows.map((row) => (
                <VendorMobileCard
                  key={row.id}
                  vendor={row.original}
                  onCardClick={() => setViewingVendor(row.original)}
                />
              ))}
            </>
          }
        />
      )}

      {!hasVendors && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No vendors yet. Add your first casting/plating vendor to get started.
          </p>
        </div>
      )}
      {hasVendors && !hasMatches && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No vendors match your search.
          </p>
        </div>
      )}

      <VendorFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        vendor={undefined}
      />
      <VendorFormModal
        open={editingVendor !== null}
        onOpenChange={(open) => !open && setEditingVendor(null)}
        vendor={editingVendor ?? undefined}
      />

      <VendorDetailModal
        open={viewingVendor !== null}
        onOpenChange={(open) => !open && setViewingVendor(null)}
        vendor={viewingVendor}
        onEdit={() => {
          const target = viewingVendor;
          setViewingVendor(null);
          setEditingVendor(target);
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

// Phase 11.2: simpler mobile card for master data — name + phone +
// casting/plating jobs count + owed amount. No inline action buttons.
function VendorMobileCard({
  vendor,
  onCardClick,
}: {
  vendor: VendorForClient;
  onCardClick: () => void;
}) {
  const totalJobs = vendor.castingCount + vendor.platingCount;
  return (
    <MobileCard
      clickable
      onClick={onCardClick}
      data-testid={`vendor-mobile-card-${vendor.id}`}
    >
      <MobileCardHeader>
        <MobileCardTitle>{vendor.name}</MobileCardTitle>
        {vendor.owedPaise > 0 && (
          <span className="text-sm tabular-nums font-mono text-on-surface shrink-0">
            {formatCurrency(vendor.owedPaise)}
          </span>
        )}
      </MobileCardHeader>
      {vendor.phone && (
        <div className="text-sm text-on-surface-variant tabular-nums">
          {vendor.phone}
        </div>
      )}
      <div className="text-xs text-on-surface-variant uppercase tracking-wider">
        {vendor.castingCount} casting · {vendor.platingCount} plating
        {totalJobs === 0 && " — no jobs yet"}
      </div>
    </MobileCard>
  );
}

function VendorRow({
  row,
  onRowClick,
}: {
  row: Row<VendorForClient>;
  onRowClick?: (vendor: VendorForClient) => void;
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
        aria-label="Edit vendor"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Delete vendor"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
