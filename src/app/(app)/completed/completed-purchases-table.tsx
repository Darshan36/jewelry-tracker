"use client";

// Phase 19 — read-only completed-purchases table.
// Structural mirror of completed-sales-table.tsx — same shape, only the
// types and labels differ ("Customer" → "Supplier").

import { Link as LinkIcon } from "lucide-react";

import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import { formatCurrency, formatDate } from "@/lib/format";

import type { PurchaseForClient } from "@/app/(app)/purchases/purchase-helpers";

type Props = {
  purchases: PurchaseForClient[];
  onRowClick: (id: string) => void;
};

export function CompletedPurchasesTable({ purchases, onRowClick }: Props) {
  return (
    <ResponsiveTable
      desktopTable={
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high sticky top-0">
              <tr>
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th>Items</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr
                  key={p.id}
                  data-testid={`completed-purchase-row-${p.id}`}
                  onClick={() => onRowClick(p.id)}
                  className="odd:bg-surface-container-low even:bg-surface-container hover:bg-surface-container-high cursor-pointer border-b border-outline-variant last:border-b-0 transition-colors"
                >
                  <Td>
                    <span className="text-on-surface-variant tabular-nums">
                      {formatDate(p.date)}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {p.partyId !== null && (
                        <LinkIcon
                          className="size-3 text-secondary shrink-0"
                          aria-label="Linked supplier"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-on-surface truncate">
                          {p.partyName}
                        </div>
                        {p.partyPhone && (
                          <div className="text-on-surface-variant tabular-nums text-xs truncate">
                            {p.partyPhone}
                          </div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <ItemSummary
                      items={p.lineItems.map((l) => l.itemDescription)}
                    />
                  </Td>
                  <Td className="text-right">
                    <span className="text-on-surface tabular-nums font-mono">
                      {formatCurrency(p.total)}
                    </span>
                  </Td>
                  <Td>
                    <TransactionStatusChip status={p.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      mobileCards={
        <>
          {purchases.map((p) => (
            <MobileCard
              key={p.id}
              clickable
              onClick={() => onRowClick(p.id)}
              data-testid={`completed-purchase-card-${p.id}`}
            >
              <MobileCardHeader>
                <MobileCardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {p.partyId !== null && (
                      <LinkIcon
                        className="size-3 text-secondary shrink-0"
                        aria-label="Linked supplier"
                      />
                    )}
                    <span className="truncate">{p.partyName}</span>
                  </div>
                  {p.partyPhone && (
                    <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
                      {p.partyPhone}
                    </div>
                  )}
                </MobileCardTitle>
                <TransactionStatusChip status={p.status} />
              </MobileCardHeader>
              <div className="text-sm text-on-surface-variant">
                <ItemSummary
                  items={p.lineItems.map((l) => l.itemDescription)}
                />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-on-surface-variant tabular-nums">
                  {formatDate(p.date)}
                </span>
                <span className="text-lg font-display tabular-nums text-on-surface">
                  {formatCurrency(p.total)}
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
