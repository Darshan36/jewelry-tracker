"use client";

// Phase 21c.1 — /ledger landing page client.
//
// Renders three sections:
//   1. Role-scoped boxes (1-4 cards) — derived totals from listLedgerHome.
//   2. Unified owner list — parties + karigar, role-scoped. Rows are
//      LINK-ONLY (no inline Pay button); clicking navigates to the
//      owner's khata view where the existing 21a.1 / 21b.1 actions live.
//      Rationale: one consistent affordance across both owner kinds,
//      one place where mutations happen → less inline-state plumbing
//      and matches the karigar-already-uses-this-pattern UX.
//   3. Walk-in section — payables (any role except LABOUR_MGMT) +
//      receivables (ADMIN-only). Walk-in rows have NO khata, so the
//      inline Pay button remains (mirrors the /payables walk-in
//      affordance). Mounts `PaymentActionModal` per kind.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DollarSign, Paperclip, Search } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import type { LedgerBox, LedgerOwnerRow } from "@/lib/ledger-home";
import type {
  WalkInPayable,
  WalkInReceivable,
} from "@/lib/outstanding-balances";
import {
  PaymentActionModal,
  type PaymentEntityType,
  type PaymentSaveData,
  type PaymentSaveResult,
} from "@/components/action-modals/payment-action-modal";
import { createPurchasePayment } from "@/app/(app)/purchases/payment-actions";
import { createCastingPayment } from "@/app/(app)/casting/payment-actions";
import { createPlatingPayment } from "@/app/(app)/plating/payment-actions";
import { createSalePayment } from "@/app/(app)/sales/payment-actions";

type Props = {
  boxes: LedgerBox[];
  owners: LedgerOwnerRow[];
  walkInPayables: WalkInPayable[];
  walkInReceivables: WalkInReceivable[];
};

type WalkInRow =
  | { kind: "purchase"; row: WalkInPayable }
  | { kind: "casting"; row: WalkInPayable }
  | { kind: "plating"; row: WalkInPayable }
  | { kind: "sale"; row: WalkInReceivable };

function walkInChip(kind: WalkInRow["kind"]): string {
  switch (kind) {
    case "purchase":
      return "Purchase";
    case "casting":
      return "Casting";
    case "plating":
      return "Plating";
    case "sale":
      return "Sale";
  }
}

function walkInPayEntityType(kind: WalkInRow["kind"]): PaymentEntityType {
  return kind;
}

function buildWalkInOnSave(row: WalkInRow) {
  return async (data: PaymentSaveData): Promise<PaymentSaveResult> => {
    switch (row.kind) {
      case "purchase":
        return createPurchasePayment({
          purchaseId: row.row.id,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
      case "casting":
        return createCastingPayment({
          castingEntryId: row.row.id,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
      case "plating":
        return createPlatingPayment({
          platingEntryId: row.row.id,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
      case "sale":
        return createSalePayment({
          saleId: row.row.id,
          date: data.date,
          amount: data.amount,
          type: data.type,
          note: data.note,
        });
    }
  };
}

export function LedgerClient({
  boxes,
  owners,
  walkInPayables,
  walkInReceivables,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [walkInPaying, setWalkInPaying] = useState<WalkInRow | null>(null);

  // Build the unified walk-in list (typed discriminated union).
  const walkInRows: WalkInRow[] = useMemo(() => {
    const out: WalkInRow[] = [];
    for (const w of walkInPayables) {
      if (w.kind === "PURCHASE") out.push({ kind: "purchase", row: w });
      else if (w.kind === "CASTING") out.push({ kind: "casting", row: w });
      else if (w.kind === "PLATING") out.push({ kind: "plating", row: w });
    }
    for (const w of walkInReceivables) {
      out.push({ kind: "sale", row: w });
    }
    return out;
  }, [walkInPayables, walkInReceivables]);

  const filteredOwners = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) => {
      const name = o.name.toLowerCase();
      const phone = (o.phone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [owners, query]);

  const filteredWalkIns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return walkInRows;
    return walkInRows.filter((w) => {
      const name = w.row.partyName.toLowerCase();
      const phone = (w.row.partyPhone ?? "").toLowerCase();
      return name.includes(q) || phone.includes(q);
    });
  }, [walkInRows, query]);

  return (
    <>
      {/* ---- Boxes ---- */}
      {boxes.length > 0 && (
        <div
          data-testid="ledger-boxes"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6"
        >
          {boxes.map((b) => (
            <LedgerBoxCard key={b.key} box={b} />
          ))}
        </div>
      )}

      {/* ---- Search ---- */}
      <div className="mb-4">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-on-surface-variant" />
          <input
            type="search"
            placeholder="Search by name or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none pl-9 pr-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors"
          />
        </div>
      </div>

      {/* ---- Owners ---- */}
      <section id="owners" className="mb-8">
        <header className="flex items-baseline justify-between gap-2 mb-3">
          <h2 className="font-display text-sm uppercase tracking-widest text-on-surface">
            Owners
          </h2>
          <span className="text-xs text-on-surface-variant tabular-nums">
            {filteredOwners.length} {filteredOwners.length === 1 ? "owner" : "owners"}
          </span>
        </header>

        {filteredOwners.length === 0 ? (
          <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
            <p className="text-on-surface-variant text-sm">
              {owners.length === 0
                ? "No owners in scope yet."
                : "No owners match your filter."}
            </p>
          </div>
        ) : (
          <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-container-high">
                <tr>
                  <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                    Owner
                  </th>
                  <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-28">
                    Kind
                  </th>
                  <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-40">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredOwners.map((o, idx) => (
                  <OwnerRow key={`${o.kind}-${o.id}`} owner={o} stripeIdx={idx} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---- Walk-ins ---- */}
      {walkInRows.length > 0 && (
        <section id="walkins" className="mb-4">
          <header className="flex items-baseline justify-between gap-2 mb-3">
            <h2 className="font-display text-sm uppercase tracking-widest text-on-surface">
              Walk-ins
            </h2>
            <span className="text-xs text-on-surface-variant tabular-nums">
              {filteredWalkIns.length}{" "}
              {filteredWalkIns.length === 1 ? "transaction" : "transactions"}
            </span>
          </header>

          {filteredWalkIns.length === 0 ? (
            <div className="border border-outline-variant bg-surface-container-low p-6 text-center">
              <p className="text-on-surface-variant text-sm">
                No walk-ins match your filter.
              </p>
            </div>
          ) : (
            <div className="border border-outline-variant bg-surface-container-low overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-container-high">
                  <tr>
                    <th className="text-left text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3">
                      Party / Transaction
                    </th>
                    <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-32">
                      Outstanding
                    </th>
                    <th className="text-right text-xs uppercase tracking-wider text-on-surface-variant font-medium px-4 py-3 w-28">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWalkIns.map((w, idx) => (
                    <tr
                      key={`walkin-${w.kind}-${w.row.id}`}
                      data-testid="ledger-walkin-row"
                      data-walkin-kind={w.kind}
                      className={`${idx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
                    >
                      <td className="px-4 py-3">
                        <div className="text-on-surface flex items-center gap-2 flex-wrap">
                          <span>{w.row.partyName || "(unnamed)"}</span>
                          <span
                            data-testid="walkin-chip"
                            title="Walk-in — no party record"
                            className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-tertiary/10 text-tertiary border border-tertiary/30"
                          >
                            Walk-in · {walkInChip(w.kind)}
                          </span>
                          {!w.row.hasAttachment && (
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
                        {w.row.partyPhone && (
                          <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
                            {w.row.partyPhone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-mono text-on-surface">
                        {formatCurrency(w.row.outstanding)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setWalkInPaying(w)}
                          aria-label={`Pay walk-in ${walkInChip(w.kind)} ${w.row.partyName}`}
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
        </section>
      )}

      {walkInPaying && (
        <PaymentActionModal
          entityType={walkInPayEntityType(walkInPaying.kind)}
          entityId={walkInPaying.row.id}
          entityTotal={walkInPaying.row.total}
          entityPaidAmount={walkInPaying.row.paidAmount}
          open={walkInPaying !== null}
          onClose={() => setWalkInPaying(null)}
          onSave={async (data) => {
            const result = await buildWalkInOnSave(walkInPaying)(data);
            if (result.ok) router.refresh();
            return result;
          }}
        />
      )}
    </>
  );
}

function LedgerBoxCard({ box }: { box: LedgerBox }) {
  const isCredit = box.total < 0;
  const isZero = box.total === 0;
  const displayValue = formatCurrency(Math.abs(box.total));
  return (
    <div
      data-testid="ledger-box"
      data-box-key={box.key}
      className="p-5 bg-surface-container border border-outline-variant"
    >
      <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-2">
        {box.label}
      </p>
      <p
        className={`font-display text-2xl font-semibold tabular-nums ${
          isZero
            ? "text-on-surface-variant"
            : isCredit
              ? "text-secondary"
              : "text-on-surface"
        }`}
      >
        {isCredit ? "−" : ""}
        {displayValue}
      </p>
      <p className="text-xs text-on-surface-variant mt-1">
        {box.count === 0
          ? "Settled"
          : `${box.count} ${box.count === 1 ? "owner" : "owners"}${isCredit ? " · credit" : ""}`}
      </p>
    </div>
  );
}

function OwnerRow({
  owner,
  stripeIdx,
}: {
  owner: LedgerOwnerRow;
  stripeIdx: number;
}) {
  const isCredit = owner.balance < 0;
  const isZero = owner.balance === 0;
  const display = formatCurrency(Math.abs(owner.balance));
  const kindLabel = owner.kind === "karigar" ? "Karigar" : "Party";

  return (
    <tr
      data-testid="ledger-owner-row"
      data-owner-kind={owner.kind}
      data-owner-id={owner.id}
      className={`${stripeIdx % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"} hover:bg-surface-container-high border-b border-outline-variant last:border-b-0`}
    >
      <td className="px-4 py-3">
        <Link
          href={owner.href}
          className="text-on-surface hover:underline flex items-center gap-2 flex-wrap"
        >
          <span>{owner.name}</span>
          {isCredit && (
            <span
              data-testid="credit-badge"
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-secondary-container text-on-secondary-container border border-secondary/30"
            >
              Credit
            </span>
          )}
          {isZero && owner.kind === "karigar" && (
            <span
              data-testid="zero-badge"
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-tertiary/10 text-tertiary border border-tertiary/30"
            >
              Caught up
            </span>
          )}
        </Link>
        {owner.phone && (
          <div className="text-xs text-on-surface-variant tabular-nums mt-0.5">
            {owner.phone}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span
          data-testid="owner-kind-chip"
          className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wider border ${
            owner.kind === "karigar"
              ? "bg-secondary/10 text-secondary border-secondary/30"
              : "bg-primary/10 text-primary border-primary/30"
          }`}
        >
          {kindLabel}
        </span>
      </td>
      <td
        className={`px-4 py-3 text-right tabular-nums font-mono ${
          isZero
            ? "text-on-surface-variant"
            : isCredit
              ? "text-secondary"
              : "text-on-surface"
        }`}
      >
        {isCredit ? "−" : ""}
        {display}
      </td>
    </tr>
  );
}
