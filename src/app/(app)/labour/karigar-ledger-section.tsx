"use client";

// Phase 21b.1 — unified karigar ledger section on /labour.
//
// Replaces Phase 18's OutstandingWagesSection. Lists EVERY active LABOUR
// karigar with their current balance (raw signed) and two action
// buttons:
//   - "Record entry" — always visible. Opens KarigarLedgerEntryModal to
//     post a direct MANUAL_PAYMENT ledger entry (advance / payment /
//     adjustment). The bug this section fixes: previously a user could
//     only reach a "Pay" button when balance > 0, so advances were
//     entered as fake piece work (wrong direction).
//   - "Pay" — visible only when balance > 0 (shop owes wages). Opens
//     EmployeePaymentModal in WAGE mode with the outstanding amount
//     prefilled. Settles wages against work done (the original Phase 18
//     workflow).
//
// Balance label is sign-aware:
//   - balance > 0n  → "Owed wages"   (positive secondary tone)
//   - balance === 0n → "Caught up"   (muted)
//   - balance < 0n  → "Advance held" (credit, secondary tone, "−" prefix)

import { formatCurrency } from "@/lib/format";
import type { KarigarBalanceRow } from "@/lib/labour-balances";

type Props = {
  rows: KarigarBalanceRow[];
  /** "Pay" → opens WAGE EmployeePaymentModal. */
  onPayClick: (row: KarigarBalanceRow) => void;
  /** "Record entry" → opens direct KarigarLedgerEntryModal. */
  onRecordEntryClick: (row: KarigarBalanceRow) => void;
};

function BalanceCell({ balance }: { balance: number }) {
  if (balance > 0) {
    return (
      <div className="md:text-right">
        <div className="text-sm tabular-nums font-mono text-on-surface">
          {formatCurrency(balance)}
        </div>
        <div
          className="text-[10px] uppercase tracking-wider text-secondary"
          data-testid="balance-label-owed"
        >
          Owed wages
        </div>
      </div>
    );
  }
  if (balance < 0) {
    return (
      <div className="md:text-right">
        <div
          className="text-sm tabular-nums font-mono text-secondary"
          data-testid="balance-amount-credit"
        >
          −{formatCurrency(-balance)}
        </div>
        <div
          className="text-[10px] uppercase tracking-wider text-secondary"
          data-testid="balance-label-credit"
        >
          Advance held
        </div>
      </div>
    );
  }
  return (
    <div className="md:text-right">
      <div className="text-sm tabular-nums font-mono text-on-surface-variant">
        {formatCurrency(0)}
      </div>
      <div
        className="text-[10px] uppercase tracking-wider text-on-surface-variant"
        data-testid="balance-label-zero"
      >
        Caught up
      </div>
    </div>
  );
}

export function KarigarLedgerSection({
  rows,
  onPayClick,
  onRecordEntryClick,
}: Props) {
  return (
    <section data-testid="karigar-ledger-section">
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="font-display text-sm uppercase tracking-widest text-on-surface">
          Karigar ledger
        </h2>
        <span className="text-xs text-on-surface-variant tabular-nums">
          {rows.length === 0
            ? "No karigars"
            : `${rows.length} ${rows.length === 1 ? "karigar" : "karigars"}`}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="border border-outline-variant bg-surface-container-low p-6 text-center text-sm text-on-surface-variant">
          No labour employees. Add one in Employees first.
        </div>
      ) : (
        <div className="border border-outline-variant bg-surface-container-low">
          {rows.map((row, idx) => (
            <div
              key={row.employee.id}
              data-testid="karigar-ledger-row"
              data-employee-id={row.employee.id}
              className={`grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 md:gap-4 px-4 py-3 items-start md:items-center ${
                idx % 2 === 0 ? "bg-surface-container" : "bg-surface-container-low"
              }`}
            >
              <div className="min-w-0 md:self-center">
                <div className="text-sm text-on-surface truncate font-medium">
                  {row.employee.name}
                </div>
                {row.employee.phone && (
                  <div className="text-xs text-on-surface-variant tabular-nums">
                    {row.employee.phone}
                  </div>
                )}
              </div>
              <BalanceCell balance={row.balance} />
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <button
                  type="button"
                  onClick={() => onRecordEntryClick(row)}
                  className="h-11 md:h-9 px-3 border border-outline-variant bg-surface-container-low text-on-surface font-display text-xs font-medium uppercase tracking-wider hover:bg-surface-container-high transition-colors"
                  data-testid="record-entry-button"
                >
                  Record entry
                </button>
                {row.balance > 0 && (
                  <button
                    type="button"
                    onClick={() => onPayClick(row)}
                    className="h-11 md:h-9 px-4 bg-primary text-on-primary font-display text-xs font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors"
                    data-testid="pay-wage-button"
                  >
                    Pay
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
