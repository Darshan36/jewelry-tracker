"use client";

// Payables list — party-rollup rows plus walk-in transaction rows.
//
// Two row kinds, one table:
//   - Rollup row (kind: 'party') — one per master Party, "Pay" opens
//     the PartyPaymentModal for bulk allocation across that party's
//     in-scope outstanding transactions.
//   - Walk-in row (kind: 'walk-in') — one per transaction whose
//     `partyId IS NULL`. Each row carries its own entity-type chip
//     (Casting / Plating / Purchase) and "Pay" opens the per-entity
//     PaymentActionModal (no bulk allocation — there is no party).

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
import { getPartyTransactionsForPayment } from "./client-helpers";
import { PartyPaymentModal } from "@/components/action-modals/party-payment-modal";
import type { PartyPaymentTransaction } from "@/components/action-modals/party-payment-modal";
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

// Display string for the entity-type chip on a walk-in row. Kept here
// (rather than on the type) so the chip wording can evolve without
// touching the data layer.
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

// Closes over the walk-in row and dispatches to the right
// per-entity payment action.
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

export function PayablesTable({ rollups, walkIns, scope }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [paying, setPaying] = useState<PartyPayableRollup | null>(null);
  const [payingTransactions, setPayingTransactions] = useState<
    PartyPaymentTransaction[]
  >([]);
  const [walkInPaying, setWalkInPaying] = useState<WalkInPayable | null>(null);

  const filteredRollups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rollups.filter((r) => {
      if (missingOnly && !r.hasMissingAttachment) return false;
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

  async function openPayModal(rollup: PartyPayableRollup) {
    const transactions = await getPartyTransactionsForPayment(
      rollup.party.id,
      scope,
    );
    setPayingTransactions(transactions);
    setPaying(rollup);
  }

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
        <label className="flex items-center gap-2 text-sm text-on-surface px-3 py-2 border border-outline-variant bg-surface-container-low cursor-pointer hover:bg-surface-container transition-colors">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(e) => setMissingOnly(e.target.checked)}
            className="size-4 accent-primary"
          />
          <span>Missing attachments only</span>
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
              {filteredRollups.map((r, idx) => (
                <tr
                  key={`party-${r.party.id}`}
                  data-testid="payable-rollup-row"
                  className={`${idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/payables/${r.party.id}`}
                      className="text-on-surface hover:underline flex items-center gap-2"
                    >
                      <span>{r.party.name}</span>
                      {r.hasMissingAttachment && (
                        <span
                          data-testid="missing-attachment-badge"
                          title="Missing bill attachment"
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-error/10 text-error border border-error/30"
                        >
                          <Paperclip className="size-3" />
                          Missing
                        </span>
                      )}
                    </Link>
                    {r.party.phone && (
                      <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
                        {r.party.phone}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                    {formatCurrency(r.totalOutstanding)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openPayModal(r)}
                      aria-label={`Pay ${r.party.name}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-primary text-on-primary hover:bg-primary/90 transition-colors"
                    >
                      <DollarSign className="size-3.5" />
                      Pay
                    </button>
                  </td>
                </tr>
              ))}

              {filteredWalkIns.map((r, idx) => {
                // Continue the zebra stripe across both row groups so
                // the boundary doesn't double up the same shade.
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
        <PartyPaymentModal
          open={paying !== null}
          onClose={() => setPaying(null)}
          onSaved={() => router.refresh()}
          direction="payable"
          party={paying.party}
          transactions={payingTransactions}
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
