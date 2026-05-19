"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Paperclip } from "lucide-react";

import { formatCurrency, formatDate } from "@/lib/format";
import type { SaleWithOutstanding } from "@/lib/outstanding-balances";
import type { Party } from "@/generated/prisma";

import { PartyPaymentModal } from "@/components/action-modals/party-payment-modal";
import type { PartyPaymentTransaction } from "@/components/action-modals/party-payment-modal";

type Props = {
  party: Party;
  sales: SaleWithOutstanding[];
  totalOutstanding: number;
};

export function PartyReceivablesDetail({ party, sales, totalOutstanding }: Props) {
  const router = useRouter();
  const [receiving, setReceiving] = useState(false);

  const transactions: PartyPaymentTransaction[] = sales.map((s) => ({
    entityType: "SALE",
    entityId: s.id,
    date: s.date,
    label: `Sale · ${s.partyName ?? "Walk-in"}`,
    total: Number(s.total),
    outstanding: s.outstanding,
    hasAttachment: s.hasAttachment,
  }));

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
          onClick={() => setReceiving(true)}
          disabled={transactions.length === 0}
          className="h-11 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <DollarSign className="size-4" />
          <span>Receive Payment</span>
        </button>
      </div>

      {transactions.length === 0 && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            No outstanding sales for this customer.
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
                  key={t.entityId}
                  className={`${idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} border-b border-outline-variant last:border-b-0`}
                >
                  <td className="px-4 py-3 tabular-nums text-on-surface-variant">
                    {formatDate(t.date)}
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

      {receiving && (
        <PartyPaymentModal
          open={receiving}
          onClose={() => setReceiving(false)}
          onSaved={() => router.refresh()}
          direction="receivable"
          party={party}
          transactions={transactions}
        />
      )}
    </>
  );
}
