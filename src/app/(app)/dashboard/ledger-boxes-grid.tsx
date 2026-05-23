// Phase 21c.1.1 — per-category dashboard ledger boxes.
//
// Renders one clickable box per LedgerBox passed in. Each deep-links
// into /ledger pre-selecting the matching tab via `?tab=<slug>`.
// Box → tab slug mapping lives in `ledgerHrefForBox()`.
//
// DRIFT-PROOF SAME-SOURCE INVARIANT: the boxes prop comes from the
// SAME `listLedgerHome(role)` call /ledger's page server-component
// makes. Never recompute totals here independently — that's the entire
// point of the 21a→21c arc. Both the dashboard render site and the
// /ledger render site read the same numbers from the same source.

import Link from "next/link";

import { formatCurrency } from "@/lib/format";
import { ledgerHrefForBox, type LedgerBox } from "@/lib/ledger-home";

export function LedgerBoxesGrid({ boxes }: { boxes: LedgerBox[] }) {
  if (boxes.length === 0) return null;
  return (
    <>
      {boxes.map((b) => (
        <LedgerBoxCard key={b.key} box={b} />
      ))}
    </>
  );
}

export function LedgerBoxCard({ box }: { box: LedgerBox }) {
  const isCredit = box.total < 0;
  const isZero = box.total === 0;
  const display = formatCurrency(Math.abs(box.total));
  return (
    <Link
      href={ledgerHrefForBox(box.key)}
      data-testid="dashboard-ledger-box"
      data-box-key={box.key}
      className="block p-6 bg-surface-container border border-outline-variant hover:bg-surface-container-high transition-colors"
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
        {display}
      </p>
      <p className="text-xs text-on-surface-variant mt-1">
        {box.count === 0
          ? "Settled"
          : `${box.count} ${box.count === 1 ? "owner" : "owners"}${isCredit ? " · credit" : ""}`}
      </p>
    </Link>
  );
}
