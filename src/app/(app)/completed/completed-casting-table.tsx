"use client";

// Phase 19 — read-only completed-casting table.
// Casting/Plating list use a different rate model (kg × ₹/kg) but the
// surface only needs to show material summary + total. Weight detail
// lives in the detail modal opened on row click.

import { Link as LinkIcon } from "lucide-react";

import {
  ResponsiveTable,
  MobileCard,
  MobileCardHeader,
  MobileCardTitle,
} from "@/components/responsive-table";
import { TransactionStatusChip } from "@/components/transaction-status-chip";
import { formatCurrency, formatDate } from "@/lib/format";

import type { CastingEntryForClient } from "@/app/(app)/casting/casting-helpers";

type Props = {
  entries: CastingEntryForClient[];
  onRowClick: (id: string) => void;
};

export function CompletedCastingTable({ entries, onRowClick }: Props) {
  return (
    <ResponsiveTable
      desktopTable={
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high sticky top-0">
              <tr>
                <Th>Date</Th>
                <Th>Vendor</Th>
                <Th>Materials</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.id}
                  data-testid={`completed-casting-row-${e.id}`}
                  onClick={() => onRowClick(e.id)}
                  className="odd:bg-surface-container-low even:bg-surface-container hover:bg-surface-container-high cursor-pointer border-b border-outline-variant last:border-b-0 transition-colors"
                >
                  <Td>
                    <span className="text-on-surface-variant tabular-nums">
                      {formatDate(e.date)}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {e.partyId !== null && (
                        <LinkIcon
                          className="size-3 text-secondary shrink-0"
                          aria-label="Linked vendor"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-on-surface truncate">
                          {e.partyName}
                        </div>
                        {e.partyPhone && (
                          <div className="text-on-surface-variant tabular-nums text-xs truncate">
                            {e.partyPhone}
                          </div>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <ItemSummary
                      items={e.lineItems.map((l) => l.materialDescription)}
                    />
                  </Td>
                  <Td className="text-right">
                    <span className="text-on-surface tabular-nums font-mono">
                      {formatCurrency(e.total)}
                    </span>
                  </Td>
                  <Td>
                    <TransactionStatusChip status={e.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      mobileCards={
        <>
          {entries.map((e) => (
            <MobileCard
              key={e.id}
              clickable
              onClick={() => onRowClick(e.id)}
              data-testid={`completed-casting-card-${e.id}`}
            >
              <MobileCardHeader>
                <MobileCardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {e.partyId !== null && (
                      <LinkIcon
                        className="size-3 text-secondary shrink-0"
                        aria-label="Linked vendor"
                      />
                    )}
                    <span className="truncate">{e.partyName}</span>
                  </div>
                  {e.partyPhone && (
                    <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
                      {e.partyPhone}
                    </div>
                  )}
                </MobileCardTitle>
                <TransactionStatusChip status={e.status} />
              </MobileCardHeader>
              <div className="text-sm text-on-surface-variant">
                <ItemSummary
                  items={e.lineItems.map((l) => l.materialDescription)}
                />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-on-surface-variant tabular-nums">
                  {formatDate(e.date)}
                </span>
                <span className="text-lg font-display tabular-nums text-on-surface">
                  {formatCurrency(e.total)}
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
