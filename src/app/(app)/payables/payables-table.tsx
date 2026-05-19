"use client";

// Payables rollup list — one row per party, with quick-pay button per row.
//
// The list is server-rendered; this client component layers search,
// missing-attachment filter, and the PartyPaymentModal trigger on top.
// Clicking a party row navigates to /payables/[partyId] for the
// per-transaction breakdown.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DollarSign, Paperclip, Search } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import type {
  PartyPayableRollup,
  PayableScope,
} from "@/lib/outstanding-balances";
import { getPartyTransactionsForPayment } from "./client-helpers";
import { PartyPaymentModal } from "@/components/action-modals/party-payment-modal";
import type { PartyPaymentTransaction } from "@/components/action-modals/party-payment-modal";

type Props = {
  rollups: PartyPayableRollup[];
  scope: PayableScope;
};

export function PayablesTable({ rollups, scope }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [paying, setPaying] = useState<PartyPayableRollup | null>(null);
  const [payingTransactions, setPayingTransactions] = useState<
    PartyPaymentTransaction[]
  >([]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rollups.filter((r) => {
      if (missingOnly && !r.hasMissingAttachment) return false;
      if (!q) return true;
      const name = r.party.name.toLowerCase();
      const phone = (r.party.phone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [rollups, query, missingOnly]);

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

      {filtered.length === 0 && (
        <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
          <p className="text-on-surface-variant text-sm">
            {rollups.length === 0
              ? "No outstanding payables. All accounts settled."
              : "No parties match your filter."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-high">
              <tr>
                <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                  Party
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
              {filtered.map((r, idx) => (
                <tr
                  key={r.party.id}
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
    </>
  );
}
