"use client";

// Phase 19 — read-only completed-sales table for the /completed Sales tab.
//
// Why a dedicated table instead of reusing sales-table.tsx: the main
// SalesTable bakes in mutation UX (Pay/Bill/Return inline buttons,
// Edit/Delete row actions, search input, Add button). All of that is
// noise on a "view completed history" surface. This table renders the
// minimum a viewer needs: date, party, items summary, total, status.
// Row click → SaleDetailModal owned by the parent client.

import { Link as LinkIcon } from "lucide-react";

import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import { formatCurrency, formatDate } from "@/lib/format";

import type { SaleForClient } from "@/app/(app)/sales/sale-helpers";

type Props = {
  sales: SaleForClient[];
  onRowClick: (id: string) => void;
};

export function CompletedSalesTable({ sales, onRowClick }: Props) {
  return (
    <ResponsiveTable
      desktopTable={
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high sticky top-0">
              <tr>
                <Th>Date</Th>
                <Th>Customer</Th>
                <Th>Items</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr
                  key={sale.id}
                  data-testid={`completed-sale-row-${sale.id}`}
                  onClick={() => onRowClick(sale.id)}
                  className="odd:bg-surface-container-low even:bg-surface-container hover:bg-surface-container-high cursor-pointer border-b border-outline-variant last:border-b-0 transition-colors"
                >
                  <Td>
                    <span className="text-on-surface-variant tabular-nums">
                      {formatDate(sale.date)}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {sale.partyId !== null && (
                        <LinkIcon
                          className="size-3 text-secondary shrink-0"
                          aria-label="Linked customer"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-on-surface truncate">
                          {sale.partyName}
                        </div>
                        {sale.partyPhone && (
                          <div className="text-on-surface-variant tabular-nums text-xs truncate">
                            {sale.partyPhone}
                          </div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <ItemSummary
                      items={sale.lineItems.map((l) => l.itemDescription)}
                    />
                  </Td>
                  <Td className="text-right">
                    <span className="text-on-surface tabular-nums font-mono">
                      {formatCurrency(sale.total)}
                    </span>
                  </Td>
                  <Td>
                    <TransactionStatusChip status={sale.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      mobileCards={
        <>
          {sales.map((sale) => (
            <MobileCard
              key={sale.id}
              clickable
              onClick={() => onRowClick(sale.id)}
              data-testid={`completed-sale-card-${sale.id}`}
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
              <div className="text-sm text-on-surface-variant">
                <ItemSummary
                  items={sale.lineItems.map((l) => l.itemDescription)}
                />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-on-surface-variant tabular-nums">
                  {formatDate(sale.date)}
                </span>
                <span className="text-lg font-display tabular-nums text-on-surface">
                  {formatCurrency(sale.total)}
                </span>
              </div>
            </MobileCard>
          ))}
        </>
      }
    />
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-4 py-3 align-middle ${className ?? ""}`}>{children}</td>
  );
}

function ItemSummary({ items }: { items: string[] }) {
  if (items.length === 0)
    return <span className="text-on-surface-variant">—</span>;
  const first = items[0];
  const extra = items.length - 1;
  return (
    <span className="text-on-surface-variant text-sm">
      {first}
      {extra > 0 && (
        <span className="text-on-surface-variant"> + {extra} more</span>
      )}
    </span>
  );
}
