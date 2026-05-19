"use client";

import { formatCurrency } from "@/lib/format";
import type { MissingSalaryEmployee } from "@/lib/labour-balances";

type Props = {
  rows: MissingSalaryEmployee[];
  onPayClick: (row: MissingSalaryEmployee) => void;
};

export function PendingSalariesSection({ rows, onPayClick }: Props) {
  return (
    <section data-testid="pending-salaries-section">
      <header className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="font-display text-sm uppercase tracking-widest text-on-surface">
          Pending salaries
        </h2>
        <span className="text-xs text-on-surface-variant tabular-nums">
          {rows.length === 0
            ? "All caught up"
            : `${rows.length} pending`}
        </span>
      </header>

      {rows.length === 0 ? (
        <div className="border border-outline-variant bg-surface-container-low p-6 text-center text-sm text-on-surface-variant">
          Every fixed-salary employee has been paid for the current month.
        </div>
      ) : (
        <div className="border border-outline-variant bg-surface-container-low">
          {rows.map((row, idx) => (
            <div
              key={row.employee.id}
              data-testid="pending-salary-row"
              className={`grid grid-cols-1 md:grid-cols-[1fr_180px_120px] gap-2 md:gap-4 px-4 py-3 items-center ${
                idx % 2 === 0 ? "bg-surface-container" : "bg-surface-container-low"
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm text-on-surface truncate font-medium">
                  {row.employee.name}
                </div>
                <div className="text-xs text-on-surface-variant">
                  {row.currentMonth}
                </div>
              </div>
              <div className="text-sm tabular-nums font-mono text-on-surface md:text-right">
                {formatCurrency(row.monthlySalary)}
              </div>
              <button
                type="button"
                onClick={() => onPayClick(row)}
                className="h-11 md:h-9 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 transition-colors w-full md:w-auto"
                data-testid="pay-salary-button"
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
