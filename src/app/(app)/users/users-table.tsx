"use client";

// Phase 16 — Users management table.
//
// Per-row action buttons (Edit / Reset password / Deactivate or
// Reactivate). Search across name + email. Mobile cards reuse the
// Phase 11.2 master-data card layout (no inline actions on mobile —
// edits go through the row tap → form modal flow).
//
// Self-protection UI mirrors the server guards:
//   - Own row's Deactivate button is disabled with a tooltip-style title.
//   - Own row in the form modal's role dropdown is disabled (handled
//     in UserFormModal).
// The action layer still rejects if anything sneaks past the UI guard.

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
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  UserX,
} from "lucide-react";

import { formatDate } from "@/lib/format";
import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";

import { deactivateUser, reactivateUser } from "./actions";
import { ResetPasswordModal } from "./reset-password-modal";
import { RoleChip, StatusChip } from "./role-chip";
import { UserFormModal } from "./user-form-modal";
import type { UserForClient } from "./types";

type Props = {
  users: UserForClient[];
  currentUserId: string;
};

export function UsersTable({ users, currentUserId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserForClient | null>(null);
  const [resettingUser, setResettingUser] = useState<UserForClient | null>(
    null,
  );
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const data = useMemo(() => users, [users]);

  const columns: ColumnDef<UserForClient>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-on-surface">
            {row.original.name}
            {row.original.id === currentUserId && (
              <span className="ml-2 text-xs text-on-surface-variant">(you)</span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-on-surface-variant tabular-nums">
            {row.original.email}
          </span>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        enableSorting: true,
        cell: ({ row }) => <RoleChip role={row.original.role} />,
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusChip active={row.original.deletedAt === null} />
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
            user={row.original}
            isSelf={row.original.id === currentUserId}
            isConfirming={confirmingId === row.original.id}
            isPending={isPending}
            onEdit={() => setEditingUser(row.original)}
            onReset={() => setResettingUser(row.original)}
            onRequestDeactivate={() => {
              setActionError(null);
              setConfirmingId(row.original.id);
            }}
            onCancelDeactivate={() => setConfirmingId(null)}
            onConfirmDeactivate={() => handleDeactivate(row.original.id)}
            onReactivate={() => handleReactivate(row.original.id)}
          />
        ),
      },
    ],
    [confirmingId, currentUserId, isPending],
  );

  const table = useReactTable({
    data,
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
        r.email.toLowerCase().includes(q)
      );
    },
  });

  function handleDeactivate(id: string) {
    startTransition(async () => {
      const result = await deactivateUser(id);
      if (!result.ok) {
        // Surface the server error (last-admin guard, self-deactivate
        // guard, etc.) so the UI never silently swallows a denial.
        const messages = Object.values(result.errors).flat();
        setActionError(messages[0] ?? "Could not deactivate this user.");
        setConfirmingId(null);
        return;
      }
      setConfirmingId(null);
      setActionError(null);
      router.refresh();
    });
  }

  function handleReactivate(id: string) {
    startTransition(async () => {
      const result = await reactivateUser(id);
      if (!result.ok) {
        const messages = Object.values(result.errors).flat();
        setActionError(messages[0] ?? "Could not reactivate this user.");
        return;
      }
      setActionError(null);
      router.refresh();
    });
  }

  const rows = table.getRowModel().rows;
  const hasUsers = users.length > 0;
  const hasMatches = rows.length > 0;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <input
          type="search"
          placeholder="Search users…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full sm:flex-1 min-w-0 bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
        />
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="h-11 sm:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto"
          data-testid="add-user-button"
        >
          <Plus className="size-4" />
          <span>Add user</span>
        </button>
      </div>

      {actionError && (
        <div
          className="mb-4 border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm"
          data-testid="users-action-error"
        >
          {actionError}
        </div>
      )}

      {hasUsers && (
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
                    <UserRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <>
              {rows.map((row) => (
                <UserMobileCard
                  key={row.id}
                  user={row.original}
                  isSelf={row.original.id === currentUserId}
                  onClick={() => setEditingUser(row.original)}
                />
              ))}
            </>
          }
        />
      )}

      {!hasUsers && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">No users yet.</p>
        </div>
      )}
      {hasUsers && !hasMatches && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No users match your search.
          </p>
        </div>
      )}

      <UserFormModal
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        user={undefined}
        currentUserId={currentUserId}
      />
      <UserFormModal
        open={editingUser !== null}
        onOpenChange={(open) => !open && setEditingUser(null)}
        user={editingUser ?? undefined}
        currentUserId={currentUserId}
      />

      <ResetPasswordModal
        open={resettingUser !== null}
        onOpenChange={(open) => !open && setResettingUser(null)}
        user={resettingUser}
      />
    </>
  );
}

function SortIndicator({ sorted }: { sorted: false | "asc" | "desc" }) {
  if (sorted === "asc") return <ArrowUp className="size-3" />;
  if (sorted === "desc") return <ArrowDown className="size-3" />;
  return <ArrowUpDown className="size-3 opacity-40" />;
}

function UserRow({ row }: { row: Row<UserForClient> }) {
  const inactive = row.original.deletedAt !== null;
  return (
    <tr
      data-testid={`user-row-${row.original.id}`}
      className={[
        "group",
        "odd:bg-surface-container-low even:bg-surface-container",
        "hover:bg-surface-container-high",
        inactive ? "opacity-70" : "",
        "border-b border-outline-variant last:border-b-0",
        "transition-colors",
      ].join(" ")}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id} className="px-4 py-3 align-middle">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );
}

function UserMobileCard({
  user,
  isSelf,
  onClick,
}: {
  user: UserForClient;
  isSelf: boolean;
  onClick: () => void;
}) {
  const inactive = user.deletedAt !== null;
  return (
    <MobileCard
      clickable
      onClick={onClick}
      data-testid={`user-mobile-card-${user.id}`}
    >
      <MobileCardHeader>
        <MobileCardTitle>
          {user.name}
          {isSelf && (
            <span className="ml-2 text-xs text-on-surface-variant">(you)</span>
          )}
        </MobileCardTitle>
        <StatusChip active={!inactive} />
      </MobileCardHeader>
      <div className="text-sm text-on-surface-variant break-all">
        {user.email}
      </div>
      <div className="mt-1">
        <RoleChip role={user.role} />
      </div>
    </MobileCard>
  );
}

function ActionCell({
  user,
  isSelf,
  isConfirming,
  isPending,
  onEdit,
  onReset,
  onRequestDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
  onReactivate,
}: {
  user: UserForClient;
  isSelf: boolean;
  isConfirming: boolean;
  isPending: boolean;
  onEdit: () => void;
  onReset: () => void;
  onRequestDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
  onReactivate: () => void;
}) {
  const inactive = user.deletedAt !== null;

  if (isConfirming) {
    return (
      <div
        className="flex items-center justify-end gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs uppercase tracking-wider text-error">
          Deactivate?
        </span>
        <button
          type="button"
          onClick={onCancelDeactivate}
          disabled={isPending}
          className="px-2 py-1 text-xs uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirmDeactivate}
          disabled={isPending}
          className="min-w-[100px] h-7 px-2 text-xs font-display uppercase tracking-wider bg-error text-on-error hover:bg-error/90 disabled:opacity-70 transition-colors flex items-center justify-center gap-1.5"
          data-testid={`confirm-deactivate-${user.id}`}
        >
          {isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            "Deactivate"
          )}
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
        aria-label="Edit user"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
        data-testid={`edit-user-${user.id}`}
      >
        <Edit3 className="size-4" />
      </button>
      <button
        type="button"
        onClick={onReset}
        aria-label="Reset password"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
        data-testid={`reset-password-${user.id}`}
      >
        <KeyRound className="size-4" />
      </button>
      {inactive ? (
        <button
          type="button"
          onClick={onReactivate}
          disabled={isPending}
          aria-label="Reactivate user"
          title="Reactivate user"
          className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          data-testid={`reactivate-user-${user.id}`}
        >
          <RotateCcw className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onRequestDeactivate}
          disabled={isSelf || isPending}
          aria-label="Deactivate user"
          title={
            isSelf
              ? "You cannot deactivate your own account"
              : "Deactivate user"
          }
          className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container disabled:opacity-30 disabled:hover:text-on-surface-variant disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
          data-testid={`deactivate-user-${user.id}`}
        >
          <UserX className="size-4" />
        </button>
      )}
    </div>
  );
}
