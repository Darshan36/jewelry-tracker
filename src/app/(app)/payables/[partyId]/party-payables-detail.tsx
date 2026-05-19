"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Paperclip } from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/format";
import type {
  CastingEntryWithOutstanding,
  PayableScope,
  PlatingEntryWithOutstanding,
  PurchaseWithOutstanding,
} from "@/lib/outstanding-balances";
import type { Party } from "@/generated/prisma";

import { PartyPaymentModal } from "@/components/action-modals/party-payment-modal";
import type { PartyPaymentTransaction } from "@/components/action-modals/party-payment-modal";

type Props = {
  party: Party;
  purchases: PurchaseWithOutstanding[];
  castingEntries: CastingEntryWithOutstanding[];
  platingEntries: PlatingEntryWithOutstanding[];
  totalOutstanding: number;
  scope: PayableScope;
};

export function PartyPayablesDetail({
  party,
  purchases,
  castingEntries,
  platingEntries,
  totalOutstanding,
}: Props) {
  const router = useRouter();
  const [paying, setPaying] = useState(false);

  // Flatten all outstanding transactions into the shape PartyPaymentModal
  // accepts. The modal owns the row state (selection + amount edit).
  const transactions: PartyPaymentTransaction[] = [
    ...purchases.map<PartyPaymentTransaction>((p) => ({
      entityType: "PURCHASE",
      entityId: p.id,
      date: p.date,
      label: `Purchase · ${p.partyName ?? "Walk-in"}`,
      total: Number(p.total),
      outstanding: p.outstanding,
      hasAttachment: p.hasAttachment,
    })),
    ...castingEntries.map<PartyPaymentTransaction>((e) => ({
      entityType: "CASTING_ENTRY",
      entityId: e.id,
      date: e.date,
      label: `Casting · ${e.partyName ?? "Walk-in"}`,
      total: Number(e.total),
      outstanding: e.outstanding,
      hasAttachment: e.hasAttachment,
    })),
    ...platingEntries.map<PartyPaymentTransaction>((e) => ({
      entityType: "PLATING_ENTRY",
      entityId: e.id,
      date: e.date,
      label: `Plating · ${e.partyName ?? "Walk-in"}`,
      total: Number(e.total),
      outstanding: e.outstanding,
      hasAttachment: e.hasAttachment,
    })),
  ];

  return (
    <>
      <div className="border border-outline-variant bg-surface-container-low p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-on-surface-variant mb-1">
            Total outstanding
          </div>
          <div className="text-2xl md:text-3xl font-display tabular-nums text-on-surface">
            {formatCurrency(totalOutstanding)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPaying(true)}
          disabled={transactions.length === 0}
          className="h-11 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <DollarSign className="size-4" />
          <span>Pay {party.name}</span>
        </button>
      </div>

      {transactions.length === 0 && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No outstanding transactions for this party.
          </p>
        </div>
      )}

      {transactions.length > 0 && (
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Date
                </th>
                <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Type
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Total
                </th>
                <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Outstanding
                </th>
                <th className="text-center text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-24">
                  Bill
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t, idx) => (
                <tr
                  key={`${t.entityType}-${t.entityId}`}
                  className={`${idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} border-b border-outline-variant last:border-b-0`}
                >
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {formatDate(t.date)}
                  </td>
                  <td className="px-4 py-3 text-on-surface">
                    {t.entityType === "PURCHASE"
                      ? "Purchase"
                      : t.entityType === "CASTING_ENTRY"
                        ? "Casting"
                        : t.entityType === "PLATING_ENTRY"
                          ? "Plating"
                          : "Sale"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                    {formatCurrency(t.total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                    {formatCurrency(t.outstanding)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.hasAttachment ? (
                      <Paperclip
                        className="size-4 inline text-on-surface-variant"
                        aria-label="Attachment present"
                      />
                    ) : (
                      <span
                        data-testid="missing-attachment-badge"
                        title="Missing bill attachment"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-error/10 text-error border border-error/30"
                      >
                        Missing
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paying && (
        <PartyPaymentModal
          open={paying}
          onClose={() => setPaying(false)}
          onSaved={() => router.refresh()}
          direction="payable"
          party={party}
          transactions={transactions}
        />
      )}
    </>
  );
}
