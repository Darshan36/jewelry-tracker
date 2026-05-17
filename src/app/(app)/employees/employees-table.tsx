"use client";

import { useMemo, useState, useTransition } from "react";
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

import { softDeleteEmployee } from "./actions";
import { EmployeeDetailModal } from "./employee-detail-modal";
import { EmployeeFormModal } from "./employee-form-modal";
import { TypeChip } from "./type-chip";
import type { EmployeeForClient } from "./types";

type TypeFilter = "ALL" | "FIXED" | "LABOUR";

type Props = { employees: EmployeeForClient[] };

export function EmployeesTable({ employees }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] =
    useState<EmployeeForClient | null>(null);
  const [viewingEmployee, setViewingEmployee] =
    useState<EmployeeForClient | null>(null);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // TanStack state
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  // Type filter — pre-filters the data array before TanStack sees it.
  // Combining type filter and search in globalFilterFn would conflate the
  // two state values; pre-filtering is cleaner.
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const filteredData = useMemo(
    () =>
      typeFilter === "ALL"
        ? employees
        : employees.filter((e) => e.type === typeFilter),
    [employees, typeFilter],
  );

  const columns: ColumnDef<EmployeeForClient>[] = [
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
      accessorKey: "type",
      header: "Type",
      enableSorting: true,
      cell: ({ row }) => <TypeChip type={row.original.type} />,
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
          onEdit={() => setEditingEmployee(row.original)}
          onRequestDelete={() => setConfirmDeleteId(row.original.id)}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onConfirmDelete={() => handleDelete(row.original.id)}
        />
      ),
    },
  ];

  const table = useReactTable({
    data: filteredData,
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
      await softDeleteEmployee(id);
      setConfirmDeleteId(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasEmployees = employees.length > 0;
  const hasMatches = rows.length > 0;

  return (
    <>
      {/* Type filter pills */}
      <div className="flex items-center gap-2 mb-4" role="radiogroup" aria-label="Filter by type">
        <FilterPill
          label="All"
          active={typeFilter === "ALL"}
          onClick={() => setTypeFilter("ALL")}
        />
        <FilterPill
          label="Fixed"
          active={typeFilter === "FIXED"}
          onClick={() => setTypeFilter("FIXED")}
        />
        <FilterPill
          label="Labour"
          active={typeFilter === "LABOUR"}
          onClick={() => setTypeFilter("LABOUR")}
        />
      </div>

      {/* Header bar: search + add — Phase 11.1 hotfix pattern. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <input
          type="search"
          placeholder="Search employees…"
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
          <span>Add employee</span>
        </button>
      </div>

      {hasEmployees && (
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
                    <EmployeeRow
                      key={row.id}
                      row={row}
                      onRowClick={(e) => setViewingEmployee(e)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <>
              {rows.map((row) => (
                <EmployeeMobileCard
                  key={row.id}
                  employee={row.original}
                  onCardClick={() => setViewingEmployee(row.original)}
                />
              ))}
            </>
          }
        />
      )}

      {/* Empty states */}
      {!hasEmployees && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No employees yet. Add your first employee to get started.
          </p>
        </div>
      )}
      {hasEmployees && !hasMatches && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No employees match your search.
          </p>
        </div>
      )}

      {/* Add / Edit form modal */}
      <EmployeeFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        employee={undefined}
      />
      <EmployeeFormModal
        open={editingEmployee !== null}
        onOpenChange={(open) => !open && setEditingEmployee(null)}
        employee={editingEmployee ?? undefined}
      />

      {/* Detail modal */}
      <EmployeeDetailModal
        open={viewingEmployee !== null}
        onOpenChange={(open) => !open && setViewingEmployee(null)}
        employee={viewingEmployee}
        onEdit={() => {
          const target = viewingEmployee;
          setViewingEmployee(null);
          setEditingEmployee(target);
        }}
      />
    </>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`h-8 px-3 text-xs font-display uppercase tracking-wider transition-colors ${
        active
          ? "bg-primary text-on-primary"
          : "bg-surface-container-high text-on-surface hover:bg-surface-container"
      }`}
    >
      {label}
    </button>
  );
}

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="size-3" />;
  if (sorted === "desc") return <ArrowDown className="size-3" />;
  return <ArrowUpDown className="size-3 opacity-40" />;
}

// Phase 11.2: simpler mobile card for master data — name + phone + type
// chip + monthly salary for FIXED employees. No inline action buttons.
function EmployeeMobileCard({
  employee,
  onCardClick,
}: {
  employee: EmployeeForClient;
  onCardClick: () => void;
}) {
  return (
    <MobileCard
      clickable
      onClick={onCardClick}
      data-testid={`employee-mobile-card-${employee.id}`}
    >
      <MobileCardHeader>
        <MobileCardTitle>{employee.name}</MobileCardTitle>
        <TypeChip type={employee.type} />
      </MobileCardHeader>
      {employee.phone && (
        <div className="text-sm text-on-surface-variant tabular-nums">
          {employee.phone}
        </div>
      )}
      {employee.type === "FIXED" && employee.monthlySalary !== null && (
        <div className="text-xs text-on-surface-variant tabular-nums font-mono">
          {formatCurrency(employee.monthlySalary)} / month
        </div>
      )}
    </MobileCard>
  );
}

function EmployeeRow({
  row,
  onRowClick,
}: {
  row: Row<EmployeeForClient>;
  onRowClick?: (employee: EmployeeForClient) => void;
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
        aria-label="Edit employee"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label="Delete employee"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
