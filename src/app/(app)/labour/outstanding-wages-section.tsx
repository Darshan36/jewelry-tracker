"use client";

import { formatCurrency, formatDate } from "@/lib/format";
import type { EmployeeWagesRollup } from "@/lib/labour-balances";

type Props = {
  rows: EmployeeWagesRollup[];
  onPayClick: (row: EmployeeWagesRollup) => void;
};

export function OutstandingWagesSection({ rows, onPayClick }: Props) {
  return (
    <section data-testid="outstanding-wages-section">
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="font-display text-sm uppercase tracking-widest text-on-surface">
          Outstanding wages
        </h2>
        <span className="text-xs text-on-surface-variant tabular-nums">
          {rows.length === 0
            ? "All caught up"
            : `${rows.length} ${rows.length === 1 ? "worker" : "workers"}`}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="border border-outline-variant bg-surface-container-low p-6 text-center text-sm text-on-surface-variant">
          Every labour employee has been paid for current piece work.
        </div>
      ) : (
        <div className="border border-outline-variant bg-surface-container-low">
          {rows.map((row, idx) => (
            <div
              key={row.employee.id}
              data-testid="outstanding-wage-row"
              className={`grid grid-cols-1 md:grid-cols-[1fr_140px_160px_120px] gap-2 md:gap-4 px-4 py-3 items-center ${
                idx % 2 === 0 ? "bg-surface-container" : "bg-surface-container-low"
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm text-on-surface truncate font-medium">
                  {row.employee.name}
                </div>
                <div className="text-xs text-on-surface-variant">
                  {row.totalPieces} pieces unpaid
                </div>
              </div>
              <div className="text-sm tabular-nums font-mono text-on-surface md:text-right">
                {formatCurrency(row.totalAmount)}
              </div>
              <div className="text-xs text-on-surface-variant md:text-right">
                Since {row.earliestUnpaidDate ? formatDate(row.earliestUnpaidDate) : "—"}
              </div>
              <button
                type="button"
                onClick={() => onPayClick(row)}
                className="h-11 md:h-9 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors w-full md:w-auto"
                data-testid="pay-wage-button"
              >
                Pay
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
