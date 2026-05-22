"use client";

// Phase 21a — party-receivables ledger statement view.
//
// Mirror of party-payables-detail.tsx. ADMIN-only access; no scope
// footnote (ADMIN always sees the true net balance, including
// MANUAL_PAYMENT entries against this party).

import { useState } from "react";
import { DollarSign } from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/format";
import type { Party } from "@/generated/prisma";
import type { PartyLedgerEntryForClient } from "@/lib/outstanding-balances";

import { PartyLedgerPaymentModal } from "@/components/action-modals/party-ledger-payment-modal";

type Props = {
  party: Party;
  totalOutstanding: number;
  entries: PartyLedgerEntryForClient[];
};

export function PartyReceivablesDetail({
  party,
  totalOutstanding,
  entries,
}: Props) {
  const [receiving, setReceiving] = useState(false);

  const isCredit = totalOutstanding < 0;
  const balanceLabel = isCredit ? "Credit balance" : "Outstanding";
  const displayAmount = Math.abs(totalOutstanding);

  return (
    <>
      <div className="border border-outline-variant bg-surface-container-low p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">
            {balanceLabel}
          </div>
          <div
            className={`text-2xl md:text-3xl font-display tabular-nums ${
              isCredit ? "text-secondary" : "text-on-surface"
            }`}
            data-testid="party-balance"
            data-signed={totalOutstanding}
          >
            {formatCurrency(displayAmount)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setReceiving(true)}
          className="h-11 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          data-testid="add-payment-button"
        >
          <DollarSign className="size-4" />
          <span>Receive Payment</span>
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No ledger activity for this customer yet.
          </p>
        </div>
      ) : (
        <LedgerStatement entries={entries} />
      )}

      {receiving && (
        <PartyLedgerPaymentModal
          open={receiving}
          onClose={() => setReceiving(false)}
          onSaved={() => setReceiving(false)}
          direction="receivable"
          party={{ id: party.id, name: party.name, phone: party.phone }}
        />
      )}
    </>
  );
}

function LedgerStatement({
  entries,
}: {
  entries: PartyLedgerEntryForClient[];
}) {
  return (
    <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-container-high">
          <tr>
            <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-32">
              Date
            </th>
            <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
              Description
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-28">
              Increase
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-28">
              Decrease
            </th>
            <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-32">
              Balance
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, idx) => (
            <tr
              key={e.id}
              className={`${
                idx % 2 === 0
                  ? "bg-surface-container-low"
                  : "bg-surface-container"
              } border-b border-outline-variant last:border-b-0`}
            >
              <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                {formatDate(e.date)}
              </td>
              <td className="px-4 py-3 text-on-surface">
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{e.description ?? "—"}</span>
                  {e.entryType === "MANUAL_PAYMENT" && (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-secondary-container text-on-secondary-container border border-secondary/30"
                      data-testid="manual-payment-tag"
                    >
                      Payment
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                {e.direction === "INCREASE" ? formatCurrency(e.amount) : ""}
              </td>
              <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                {e.direction === "DECREASE" ? formatCurrency(e.amount) : ""}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums font-mono ${
                  e.runningBalance < 0 ? "text-secondary" : "text-on-surface"
                }`}
              >
                {e.runningBalance < 0 ? "−" : ""}
                {formatCurrency(Math.abs(e.runningBalance))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
