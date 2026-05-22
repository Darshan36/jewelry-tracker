"use client";

// Phase 21a — Receivables list, ledger-driven.
// Mirrors PayablesTable shape. ADMIN-only access.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DollarSign, Paperclip, Search } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import type {
  PartyReceivableRollup,
  WalkInReceivable,
} from "@/lib/outstanding-balances";
import { PartyLedgerPaymentModal } from "@/components/action-modals/party-ledger-payment-modal";
import {
  PaymentActionModal,
  type PaymentSaveData,
  type PaymentSaveResult,
} from "@/components/action-modals/payment-action-modal";
import { createSalePayment } from "@/app/(app)/sales/payment-actions";

type Props = {
  rollups: PartyReceivableRollup[];
  walkIns: WalkInReceivable[];
};

function buildOnSave(row: WalkInReceivable) {
  return async (data: PaymentSaveData): Promise<PaymentSaveResult> => {
    return createSalePayment({
      saleId: row.id,
      date: data.date,
      amount: data.amount,
      type: data.type,
      note: data.note,
    });
  };
}

export function ReceivablesTable({ rollups, walkIns }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [receiving, setReceiving] = useState<PartyReceivableRollup | null>(
    null,
  );
  const [walkInReceiving, setWalkInReceiving] =
    useState<WalkInReceivable | null>(null);

  const filteredRollups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rollups.filter((r) => {
      // Phase 21a: rollups no longer carry hasMissingAttachment.
      if (missingOnly) return false;
      if (!q) return true;
      return (
        r.party.name.toLowerCase().includes(q) ||
        (r.party.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [rollups, query, missingOnly]);

  const filteredWalkIns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return walkIns.filter((r) => {
      if (missingOnly && r.hasAttachment) return false;
      if (!q) return true;
      return (
        r.partyName.toLowerCase().includes(q) ||
        (r.partyPhone ?? "").toLowerCase().includes(q)
      );
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
              ? "No outstanding receivables. All customers paid up."
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
                  Customer / Transaction
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Outstanding
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-40">
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
                    data-testid="receivable-rollup-row"
                    className={`${idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/receivables/${r.party.id}`}
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
                        onClick={() => setReceiving(r)}
                        aria-label={`Receive payment from ${r.party.name}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-primary text-on-primary hover:bg-primary/90 transition-colors"
                      >
                        <DollarSign className="size-3.5" />
                        Receive
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredWalkIns.map((r, idx) => {
                const stripeIdx = filteredRollups.length + idx;
                return (
                  <tr
                    key={`walkin-sale-${r.id}`}
                    data-testid="receivable-walkin-row"
                    className={`${stripeIdx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
                  >
                    <td className="px-4 py-3">
                      <div className="text-on-surface flex items-center gap-2 flex-wrap">
                        <span>{r.partyName || "(unnamed)"}</span>
                        <span
                          data-testid="walkin-chip"
                          title="Walk-in — no customer record"
                          className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-tertiary/10 text-tertiary border border-tertiary/30"
                        >
                          Walk-in · Sale
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
                        onClick={() => setWalkInReceiving(r)}
                        aria-label={`Receive walk-in sale from ${r.partyName}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-primary text-on-primary hover:bg-primary/90 transition-colors"
                      >
                        <DollarSign className="size-3.5" />
                        Receive
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {receiving && (
        <PartyLedgerPaymentModal
          open={receiving !== null}
          onClose={() => setReceiving(null)}
          onSaved={() => router.refresh()}
          direction="receivable"
          party={{
            id: receiving.party.id,
            name: receiving.party.name,
            phone: receiving.party.phone,
          }}
          defaultAmountPaise={
            receiving.totalOutstanding > 0
              ? receiving.totalOutstanding
              : undefined
          }
        />
      )}

      {walkInReceiving && (
        <PaymentActionModal
          entityType="sale"
          entityId={walkInReceiving.id}
          entityTotal={walkInReceiving.total}
          entityPaidAmount={walkInReceiving.paidAmount}
          open={walkInReceiving !== null}
          onClose={() => setWalkInReceiving(null)}
          onSave={buildOnSave(walkInReceiving)}
        />
      )}
    </>
  );
}
