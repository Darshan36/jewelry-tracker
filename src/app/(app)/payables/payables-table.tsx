"use client";

// Phase 21a — Payables list, ledger-driven.
//
// Two row kinds, one table:
//   - Rollup row (kind: 'party') — one per master Party, "Pay" opens
//     the PartyLedgerPaymentModal (single party-level payment, no
//     per-bill allocation).
//   - Walk-in row (kind: 'walk-in') — one per transaction whose
//     `partyId IS NULL`. Each row carries its own entity-type chip
//     (Casting / Plating / Purchase) and "Pay" opens the per-entity
//     PaymentActionModal. Walk-ins stay on the legacy *Payment rails
//     in 21a.
//
// Phase 21a changes vs Phase 17b:
//   - Bulk-allocation modal replaced by single-payment modal.
//   - Missing-attachment badge dropped from rollup rows (the ledger
//     doesn't link to attachments per-row; the affordance was per-
//     transaction). Walk-in rows retain the badge — they still
//     aggregate per-bill.
//   - Rollup outstanding may be negative for parties with credit
//     balance; display absolute value with a "Credit" tag.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DollarSign, Paperclip, Search } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import type {
  PartyPayableRollup,
  PayableScope,
  WalkInPayable,
} from "@/lib/outstanding-balances";
import { PartyLedgerPaymentModal } from "@/components/action-modals/party-ledger-payment-modal";
import {
  PaymentActionModal,
  type PaymentEntityType,
  type PaymentSaveData,
  type PaymentSaveResult,
} from "@/components/action-modals/payment-action-modal";
import { createPurchasePayment } from "@/app/(app)/purchases/payment-actions";
import { createCastingPayment } from "@/app/(app)/casting/payment-actions";
import { createPlatingPayment } from "@/app/(app)/plating/payment-actions";

type Props = {
  rollups: PartyPayableRollup[];
  walkIns: WalkInPayable[];
  scope: PayableScope;
};

function chipLabel(kind: WalkInPayable["kind"]): string {
  switch (kind) {
    case "PURCHASE":
      return "Purchase";
    case "CASTING":
      return "Casting";
    case "PLATING":
      return "Plating";
  }
}

function payEntityType(kind: WalkInPayable["kind"]): PaymentEntityType {
  switch (kind) {
    case "PURCHASE":
      return "purchase";
    case "CASTING":
      return "casting";
    case "PLATING":
      return "plating";
  }
}

function buildOnSave(row: WalkInPayable) {
  return async (data: PaymentSaveData): Promise<PaymentSaveResult> => {
    switch (row.kind) {
      case "PURCHASE":
        return createPurchasePayment({
          purchaseId: row.id,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
      case "CASTING":
        return createCastingPayment({
          castingEntryId: row.id,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
      case "PLATING":
        return createPlatingPayment({
          platingEntryId: row.id,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
    }
  };
}

export function PayablesTable({ rollups, walkIns, scope: _scope }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [paying, setPaying] = useState<PartyPayableRollup | null>(null);
  const [walkInPaying, setWalkInPaying] = useState<WalkInPayable | null>(null);

  const filteredRollups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rollups.filter((r) => {
      // Phase 21a: rollups no longer carry hasMissingAttachment.
      // missingOnly filter only applies to walk-in rows.
      if (missingOnly) return false;
      if (!q) return true;
      const name = r.party.name.toLowerCase();
      const phone = (r.party.phone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [rollups, query, missingOnly]);

  const filteredWalkIns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return walkIns.filter((r) => {
      if (missingOnly && r.hasAttachment) return false;
      if (!q) return true;
      const name = r.partyName.toLowerCase();
      const phone = (r.partyPhone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [walkIns, query, missingOnly]);

  const totalVisible = filteredRollups.length + filteredWalkIns.length;
  const totalRows = rollups.length + walkIns.length;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
        <div className="relative w-full sm:flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-on-surface-variant" />
          <input
            type="search"
            placeholder="Search by name or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none pl-9 pr-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
          />
        </div>
        <label
          className="flex items-center gap-2 text-sm text-on-surface px-3 py-2 border border-outline-variant bg-surface-container-low cursor-pointer hover:bg-surface-container transition-colors"
          title="Filters walk-in rows only. Party rollups no longer surface per-transaction attachment state in 21a."
        >
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(e) => setMissingOnly(e.target.checked)}
            className="size-4 accent-primary"
          />
          <span>Missing attachments only (walk-ins)</span>
        </label>
      </div>

      {totalVisible === 0 && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            {totalRows === 0
              ? "No outstanding payables. All accounts settled."
              : "No rows match your filter."}
          </p>
        </div>
      )}

      {totalVisible > 0 && (
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Party / Transaction
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Outstanding
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-32">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRollups.map((r, idx) => {
                const isCredit = r.totalOutstanding < 0;
                return (
                  <tr
                    key={`party-${r.party.id}`}
                    data-testid="payable-rollup-row"
                    className={`${idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/payables/${r.party.id}`}
                        className="text-on-surface hover:underline flex items-center gap-2 flex-wrap"
                      >
                        <span>{r.party.name}</span>
                        {isCredit && (
                          <span
                            data-testid="credit-badge"
                            className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-secondary-container text-on-secondary-container border border-secondary/30"
                          >
                            Credit
                          </span>
                        )}
                      </Link>
                      {r.party.phone && (
                        <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
                          {r.party.phone}
                        </div>
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-mono ${
                        isCredit ? "text-secondary" : "text-on-surface"
                      }`}
                    >
                      {isCredit ? "−" : ""}
                      {formatCurrency(Math.abs(r.totalOutstanding))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setPaying(r)}
                        aria-label={`Pay ${r.party.name}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-primary text-on-primary hover:bg-primary/90 transition-colors"
                      >
                        <DollarSign className="size-3.5" />
                        Pay
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredWalkIns.map((r, idx) => {
                const stripeIdx = filteredRollups.length + idx;
                return (
                  <tr
                    key={`walkin-${r.kind}-${r.id}`}
                    data-testid="payable-walkin-row"
                    data-walkin-kind={r.kind}
                    className={`${stripeIdx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-on-surface flex items-center gap-2 flex-wrap">
                        <span>{r.partyName || "(unnamed)"}</span>
                        <span
                          data-testid="walkin-chip"
                          title="Walk-in — no party record"
                          className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-tertiary/10 text-tertiary border border-tertiary/30"
                        >
                          Walk-in · {chipLabel(r.kind)}
                        </span>
                        {!r.hasAttachment && (
                          <span
                            data-testid="missing-attachment-badge"
                            title="Missing bill attachment"
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-error/10 text-error border border-error/30"
                          >
                            <Paperclip className="size-3" />
                            Missing
                          </span>
                        )}
                      </div>
                      {r.partyPhone && (
                        <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
                          {r.partyPhone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                      {formatCurrency(r.outstanding)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setWalkInPaying(r)}
                        aria-label={`Pay walk-in ${chipLabel(r.kind)} ${r.partyName}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-primary text-on-primary hover:bg-primary/90 transition-colors"
                      >
                        <DollarSign className="size-3.5" />
                        Pay
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {paying && (
        <PartyLedgerPaymentModal
          open={paying !== null}
          onClose={() => setPaying(null)}
          onSaved={() => router.refresh()}
          direction="payable"
          party={{
            id: paying.party.id,
            name: paying.party.name,
            phone: paying.party.phone,
          }}
          defaultAmountPaise={
            // Pre-fill with the displayed outstanding when it's a debit
            // balance (>0). For credit balances, leave the field empty —
            // the user is doing something unusual ("pay extra to the
            // party for the future") and shouldn't be defaulted into the
            // wrong number.
            paying.totalOutstanding > 0
              ? paying.totalOutstanding
              : undefined
          }
        />
      )}

      {walkInPaying && (
        <PaymentActionModal
          entityType={payEntityType(walkInPaying.kind)}
          entityId={walkInPaying.id}
          entityTotal={walkInPaying.total}
          entityPaidAmount={walkInPaying.paidAmount}
          open={walkInPaying !== null}
          onClose={() => setWalkInPaying(null)}
          onSave={buildOnSave(walkInPaying)}
        />
      )}
    </>
  );
}
