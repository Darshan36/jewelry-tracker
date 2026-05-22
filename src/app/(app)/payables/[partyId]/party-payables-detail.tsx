"use client";

// Phase 21a — party-payables ledger statement view.
//
// Replaces the Phase 17b transaction-allocation table. The page now
// renders a chronological LedgerEntry stream with a running balance
// + one "Add payment" button (single party-level payment, no bulk
// allocation). The Phase 17b modal is gone — this page uses
// PartyLedgerPaymentModal instead.

import { useState } from "react";
import { DollarSign } from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/format";
import type { Party } from "@/generated/prisma";
import type {
  PartyLedgerEntryForClient,
  PayableScope,
} from "@/lib/outstanding-balances";

import { PartyLedgerPaymentModal } from "@/components/action-modals/party-ledger-payment-modal";

type Props = {
  party: Party;
  totalOutstanding: number;
  showScopeFootnote: boolean;
  entries: PartyLedgerEntryForClient[];
  scope: PayableScope;
};

const SCOPE_FOOTNOTE: Record<PayableScope, string> = {
  purchase:
    "Showing purchase activity only. Payments to this party are tracked on the full account.",
  casting_plating:
    "Showing casting and plating activity only. Payments to this party are tracked on the full account.",
  // ADMIN sees full ledger including MANUAL_PAYMENT — no footnote.
  all: "",
};

export function PartyPayablesDetail({
  party,
  totalOutstanding,
  showScopeFootnote,
  entries,
  scope,
}: Props) {
  const [paying, setPaying] = useState(false);

  // The "outstanding" label is sign-aware:
  //   - positive → "Outstanding ₹X" (shop owes party)
  //   - negative → "Credit balance ₹X" (party prepaid; we owe them back)
  //   - zero (filtered out at the list level; defensive here)
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
          {showScopeFootnote && scope !== "all" && (
            <p
              data-testid="scope-footnote"
              className="mt-2 text-xs text-on-surface-variant max-w-md"
            >
              {SCOPE_FOOTNOTE[scope]}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPaying(true)}
          className="h-11 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          data-testid="add-payment-button"
        >
          <DollarSign className="size-4" />
          <span>Add payment</span>
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No ledger activity for this party in scope yet.
          </p>
        </div>
      ) : (
        <LedgerStatement entries={entries} />
      )}

      {paying && (
        <PartyLedgerPaymentModal
          open={paying}
          onClose={() => setPaying(false)}
          onSaved={() => setPaying(false)}
          direction="payable"
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
