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

import type { Customer } from "@/generated/prisma";
import { formatDate } from "@/lib/format";
import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";

import { softDeleteCustomer } from "./actions";
import { CustomerDetailModal } from "./customer-detail-modal";
import { CustomerFormModal } from "./customer-form-modal";

type Props = { customers: Customer[] };

export function CustomersTable({ customers }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);

  // Per-row delete confirmation (inline; matches the design-system pattern
  // of replacing the action cluster rather than overlaying a separate modal).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // TanStack state
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<Customer>[] = [
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
          customer={row.original}
          isConfirming={confirmDeleteId === row.original.id}
          isPending={isPending}
          onEdit={() => setEditingCustomer(row.original)}
          onRequestDelete={() => setConfirmDeleteId(row.original.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleDelete(row.original.id)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: customers,
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
      await softDeleteCustomer(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasCustomers = customers.length > 0;
  const hasMatches = rows.length > 0;

  return (
    <>
      {/* Header bar: search + add. Same Phase 11.1 hotfix pattern as the
          transactional list pages — stack vertically on mobile so the
          "Add customer" button doesn't compete with the search input
          for horizontal space. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <input
          type="search"
          placeholder="Search customers…"
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
          <span>Add customer</span>
        </button>
      </div>

      {hasCustomers && (
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
                    <CustomerRow
                      key={row.id}
                      row={row}
                      onRowClick={(c) => setViewingCustomer(c)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <>
              {rows.map((row) => (
                <CustomerMobileCard
                  key={row.id}
                  customer={row.original}
                  onCardClick={() => setViewingCustomer(row.original)}
                />
              ))}
            </>
          }
        />
      )}

      {/* Empty states */}
      {!hasCustomers && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No customers yet. Add your first customer to get started.
          </p>
        </div>
      )}
      {hasCustomers && !hasMatches && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No customers match your search.
          </p>
        </div>
      )}

      {/* Add / Edit form modal — same component, mode toggled by `customer` prop */}
      <CustomerFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        customer={undefined}
      />
      <CustomerFormModal
        open={editingCustomer !== null}
        onOpenChange={(open) => !open && setEditingCustomer(null)}
        customer={editingCustomer ?? undefined}
      />

      {/* Detail modal — opened by row click. Edit transitions to the form modal. */}
      <CustomerDetailModal
        open={viewingCustomer !== null}
        onOpenChange={(open) => !open && setViewingCustomer(null)}
        customer={viewingCustomer}
        onEdit={() => {
          const target = viewingCustomer;
          setViewingCustomer(null);
          setEditingCustomer(target);
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
// inline action buttons. Mutations go through the detail modal's Edit
// link (tap card → detail modal → Edit) — different workflow shape
// from transactional entities (Sales/Purchases etc.) which surface
// Pay/Bill/Return as inline quick actions.
function CustomerMobileCard({
  customer,
  onCardClick,
}: {
  customer: Customer;
  onCardClick: () => void;
}) {
  return (
    <MobileCard
      clickable
      onClick={onCardClick}
      data-testid={`customer-mobile-card-${customer.id}`}
    >
      <MobileCardHeader>
        <MobileCardTitle>{customer.name}</MobileCardTitle>
      </MobileCardHeader>
      {customer.phone && (
        <div className="text-sm text-on-surface-variant tabular-nums">
          {customer.phone}
        </div>
      )}
    </MobileCard>
  );
}

function CustomerRow({
  row,
  onRowClick,
}: {
  row: Row<Customer>;
  onRowClick?: (customer: Customer) => void;
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
  customer: _customer,
  isConfirming,
  isPending,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  customer: Customer;
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
        aria-label="Edit customer"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Delete customer"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
