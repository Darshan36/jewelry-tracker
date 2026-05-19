"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DollarSign, Paperclip, Search } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import type { PartyReceivableRollup } from "@/lib/outstanding-balances";
import { PartyPaymentModal } from "@/components/action-modals/party-payment-modal";
import type { PartyPaymentTransaction } from "@/components/action-modals/party-payment-modal";
import { getPartyTransactionsForReceivable } from "../payables/client-helpers";

type Props = {
  rollups: PartyReceivableRollup[];
};

export function ReceivablesTable({ rollups }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [receiving, setReceiving] = useState<PartyReceivableRollup | null>(null);
  const [transactions, setTransactions] = useState<PartyPaymentTransaction[]>([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rollups.filter((r) => {
      if (missingOnly && !r.hasMissingAttachment) return false;
      if (!q) return true;
      return (
        r.party.name.toLowerCase().includes(q) ||
        (r.party.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [rollups, query, missingOnly]);

  async function openReceiveModal(rollup: PartyReceivableRollup) {
    const txns = await getPartyTransactionsForReceivable(rollup.party.id);
    setTransactions(txns);
    setReceiving(rollup);
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

      {filtered.length === 0 && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            {rollups.length === 0
              ? "No outstanding receivables. All customers paid up."
              : "No customers match your filter."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Customer
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
              {filtered.map((r, idx) => (
                <tr
                  key={r.party.id}
                  className={`${idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/receivables/${r.party.id}`}
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
                      onClick={() => openReceiveModal(r)}
                      aria-label={`Receive payment from ${r.party.name}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-primary text-on-primary hover:bg-primary/90 transition-colors"
                    >
                      <DollarSign className="size-3.5" />
                      Receive
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {receiving && (
        <PartyPaymentModal
          open={receiving !== null}
          onClose={() => setReceiving(null)}
          onSaved={() => router.refresh()}
          direction="receivable"
          party={receiving.party}
          transactions={transactions}
        />
      )}
    </>
  );
}
