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
  Camera,
  DollarSign,
  Edit3,
  Link as LinkIcon,
  Loader2,
  Paperclip,
  Plus,
  Printer,
  Trash2,
  Undo2,
} from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/format";
import {
  PaymentActionModal,
} from "@/components/action-modals/payment-action-modal";
import {
  AttachmentActionModal,
} from "@/components/action-modals/attachment-action-modal";
import {
  ReturnActionModal,
} from "@/components/action-modals/return-action-modal";

import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
  MobileCardActions,
} from "@/components/responsive-table";

import { softDeleteSale } from "./actions";
import { createSalePayment } from "./payment-actions";
import { createSaleReturn } from "./return-actions";
import { SaleDetailModal } from "./sale-detail-modal";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import type { SaleForClient } from "./sale-helpers";

type Props = {
  sales: SaleForClient[];
};

export function SalesTable({ sales }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Phase 10: derive viewing sale from id (same live-update pattern as before).
  const [viewingSaleId, setViewingSaleId] = useState<string | null>(null);
  const viewingSale = viewingSaleId
    ? (sales.find((s) => s.id === viewingSaleId) ?? null)
    : null;
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Phase 10: single action-modal state slot at the table level (one slot
  // per modal type, plus the activeRowId that owns it). Cleaner than
  // per-row state — three modals × N rows would otherwise be N × 3
  // mount/unmount cycles.
  const [paymentRowId, setPaymentRowId] = useState<string | null>(null);
  const [billRowId, setBillRowId] = useState<string | null>(null);
  const [returnRowId, setReturnRowId] = useState<string | null>(null);

  const paymentRow = paymentRowId
    ? (sales.find((s) => s.id === paymentRowId) ?? null)
    : null;

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
          {row.original.partyId !== null && (
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
              <div className="text-on-surface-variant tabular-nums text-xs truncate">
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
        const items = row.original.lineItems;
        if (items.length === 0)
          return <span className="text-on-surface-variant">—</span>;
        const first = items[0].itemDescription;
        const extra = items.length - 1;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-on-surface-variant text-sm truncate">
              {first}
              {extra > 0 && (
                <span className="text-on-surface-variant"> + {extra} more</span>
              )}
            </span>
            {row.original.photoCount > 0 && (
              <PhotoCountBadge count={row.original.photoCount} />
            )}
          </div>
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
          saleId={row.original.id}
          onPay={() => setPaymentRowId(row.original.id)}
          onBill={() => setBillRowId(row.original.id)}
          onReturn={() => setReturnRowId(row.original.id)}
        />
      ),
    },
    {
      id: "rowActions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions
          saleId={row.original.id}
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
        r.lineItems.some((li) =>
          li.itemDescription.toLowerCase().includes(q),
        )
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
      {/* Phase 11.1 hotfix: stack vertically on mobile so the Add button
          doesn't compete with the search input for horizontal space.
          min-w-0 on the input lets it shrink past its intrinsic 20-char
          default in flex-row mode at sm+ widths. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <input
          type="search"
          placeholder="Search by party, phone, or item…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full sm:flex-1 min-w-0 bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
        />
        <Link
          href="/sales/new"
          className="h-11 sm:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 shrink-0 w-full sm:w-auto"
        >
          <Plus className="size-4" />
          <span>Add sale</span>
        </Link>
      </div>

      {hasSales && (
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
                    <SaleRow
                      key={row.id}
                      row={row}
                      onRowClick={(s) => setViewingSaleId(s.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <>
              {rows.map((row) => (
                <SaleMobileCard
                  key={row.id}
                  sale={row.original}
                  onCardClick={() => setViewingSaleId(row.original.id)}
                  onPay={() => setPaymentRowId(row.original.id)}
                  onBill={() => setBillRowId(row.original.id)}
                  onReturn={() => setReturnRowId(row.original.id)}
                />
              ))}
            </>
          }
        />
      )}

      {!hasSales && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No sales yet. Add your first sale to get started.
          </p>
        </div>
      )}
      {hasSales && !hasMatches && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No sales match your search.
          </p>
        </div>
      )}

      <SaleDetailModal
        open={viewingSale !== null}
        onOpenChange={(open) => !open && setViewingSaleId(null)}
        sale={viewingSale}
      />

      {paymentRow && (
        <PaymentActionModal
          entityType="sale"
          entityId={paymentRow.id}
          entityTotal={paymentRow.total - paymentRow.returnTotal}
          entityPaidAmount={paymentRow.paidAmount}
          open={paymentRowId !== null}
          onClose={() => setPaymentRowId(null)}
          // Prop-injection dispatch (Phase 10.5). Sales server actions
          // take a single object that includes the saleId; we close over
          // it from the captured row and the modal stays entity-agnostic.
          onSave={(data) =>
            createSalePayment({
              saleId: paymentRow.id,
              date: data.date,
              amount: data.amount,
              type: data.type,
              note: data.note,
            })
          }
        />
      )}

      {billRowId && (
        // Sales bill flow uses the discriminator-only attachment pattern
        // (no `attachmentId` FK on the Sale row), so no onAttach/onDetach
        // props — the modal short-circuits both calls.
        <AttachmentActionModal
          entityType="sale"
          entityId={billRowId}
          open={billRowId !== null}
          onClose={() => setBillRowId(null)}
        />
      )}

      {returnRowId && (
        <ReturnActionModal
          entityType="sale"
          entityId={returnRowId}
          open={returnRowId !== null}
          onClose={() => setReturnRowId(null)}
          onSave={(data) =>
            createSaleReturn({
              saleId: returnRowId,
              date: data.date,
              qtyReturned: data.qtyReturned,
              refundAmount: data.refundAmount,
              note: data.note,
            })
          }
        />
      )}
    </>
  );
}

// Phase 12c — compact photo-count indicator. Inline near the items column
// (desktop) and inside the mobile card. Renders nothing when count is 0.
function PhotoCountBadge({ count }: { count: number }) {
  return (
    <span
      data-testid="photo-count-badge"
      data-count={count}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-display uppercase tracking-wider bg-surface-container-high text-on-surface-variant border border-outline-variant tabular-nums shrink-0"
      aria-label={`${count} photo${count === 1 ? "" : "s"}`}
    >
      <Camera className="size-3" />
      {count}
    </span>
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

function QuickActions({
  saleId,
  onPay,
  onBill,
  onReturn,
}: {
  saleId: string;
  onPay: () => void;
  onBill: () => void;
  onReturn: () => void;
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
        aria-label="Manage invoice attachment"
        title="Manage invoice attachment"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Paperclip className="size-4" />
      </button>
      {/* Phase 20: Print bill — opens a printable receipt in a new
          tab. Distinct from the Paperclip "Manage invoice attachment"
          (uploaded invoice document) via icon + label + leading verb. */}
      <a
        href={`/sales/${saleId}/bill`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label="Print bill"
        title="Print bill"
        data-testid={`print-bill-${saleId}`}
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Printer className="size-4" />
      </a>
      <button
        type="button"
        onClick={onReturn}
        aria-label="Record return"
        title="Record return"
        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container transition-colors"
      >
        <Undo2 className="size-4" />
      </button>
    </div>
  );
}

function RowActions({
  saleId,
  isConfirming,
  isPending,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  saleId: string;
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
        href={`/sales/${saleId}/edit`}
        aria-label="Edit sale"
        className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      >
        <Edit3 className="size-4" />
      </Link>
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

// Phase 11: mobile-card render for a single sale row. Stacked layout
// with primary identifier + items summary + amount/status + date +
// three action buttons (Pay, Attachment, Return) at the bottom of the card.
function SaleMobileCard({
  sale,
  onCardClick,
  onPay,
  onBill,
  onReturn,
}: {
  sale: SaleForClient;
  onCardClick: () => void;
  onPay: () => void;
  onBill: () => void;
  onReturn: () => void;
}) {
  const firstItem = sale.lineItems[0]?.itemDescription ?? "—";
  const extraLines = Math.max(0, sale.lineItems.length - 1);
  return (
    <MobileCard
      clickable
      onClick={onCardClick}
      data-testid={`sale-mobile-card-${sale.id}`}
    >
      <MobileCardHeader>
        <MobileCardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {sale.partyId !== null && (
              <LinkIcon
                className="size-3 text-secondary shrink-0"
                aria-label="Linked customer"
              />
            )}
            <span className="truncate">{sale.partyName}</span>
          </div>
          {sale.partyPhone && (
            <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
              {sale.partyPhone}
            </div>
          )}
        </MobileCardTitle>
        <TransactionStatusChip status={sale.status} />
      </MobileCardHeader>

      <div className="flex items-center gap-2 text-sm text-on-surface-variant">
        <span className="truncate min-w-0">
          {firstItem}
          {extraLines > 0 && (
            <span className="text-on-surface-variant"> + {extraLines} more</span>
          )}
        </span>
        {sale.photoCount > 0 && (
          <PhotoCountBadge count={sale.photoCount} />
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-on-surface-variant tabular-nums">
          {formatDate(sale.date)}
        </span>
        <span className="text-lg font-display tabular-nums text-on-surface">
          {formatCurrency(sale.total)}
        </span>
      </div>

      <MobileCardActions>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPay();
          }}
          aria-label="Add payment"
          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-2 text-sm bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <DollarSign className="size-4" />
          <span>Pay</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onBill();
          }}
          aria-label="Manage invoice attachment"
          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-2 text-sm bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <Paperclip className="size-4" />
          <span>Attach</span>
        </button>
        {/* Phase 20: Print bill — opens printable receipt in a new tab. */}
        <a
          href={`/sales/${sale.id}/bill`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label="Print bill"
          data-testid={`print-bill-mobile-${sale.id}`}
          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-2 text-sm bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <Printer className="size-4" />
          <span>Print</span>
        </a>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReturn();
          }}
          aria-label="Record return"
          className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-2 text-sm bg-surface-container border border-outline-variant text-on-surface hover:bg-surface-container-high transition-colors"
        >
          <Undo2 className="size-4" />
          <span>Return</span>
        </button>
      </MobileCardActions>
    </MobileCard>
  );
}
