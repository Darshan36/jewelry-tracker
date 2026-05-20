"use client";

// Bulk piece-entry form (Phase 18, Phase 18.1).
//
// Renders one row per LABOUR employee with:
//   - read-only name
//   - editable per-piece rate (Phase 18.1: rate is dynamic — entered
//     per entry, NOT pre-filled from a worker attribute)
//   - count input (number, defaults to empty)
//   - optional note (Phase 18.1: records what the piece work was for —
//     "polishing", "setting", etc.)
//   - live-computed line total
//
// "Save all" submits only the rows with count > 0 to
// createBulkPieceEntries. Zero-count rows are filtered out client-side
// AND server-side (defense in depth).
//
// UX considerations:
//   - Count input has autoFocus on the first row to let the user start
//     typing immediately.
//   - Tab order goes count → rate → note → count → rate → note, top to
//     bottom. (Sticking with HTML's natural tab order — no JS overrides.)
//   - The save button shows the live aggregate "₹X across N workers"
//     so the user can sanity-check before committing.
//   - On successful save: counts AND rates AND notes reset for next
//     day's entry (rates no longer persist since they're per-entry).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { FormError, FormInput, FormLabel } from "@/components/form-controls";
import { formatCurrency, todayIsoIST } from "@/lib/format";

import { createBulkPieceEntries } from "./actions";
import type { EmployeeForClient } from "../employees/types";

type RowState = {
  count: string; // string so empty doesn't render as "0"
  rate: string; // string for the same reason; empty by default (rate is dynamic per entry)
  note: string;
};

type Props = {
  employees: EmployeeForClient[];
  onSaved: () => void;
};

function defaultRows(employees: EmployeeForClient[]): Record<string, RowState> {
  const rows: Record<string, RowState> = {};
  for (const e of employees) {
    rows[e.id] = { count: "", rate: "", note: "" };
  }
  return rows;
}

export function BulkPieceEntrySection({ employees, onSaved }: Props) {
  const router = useRouter();
  const [date, setDate] = useState<string>(todayIsoIST());
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    defaultRows(employees),
  );
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  function setRow(employeeId: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [employeeId]: { ...prev[employeeId], ...patch },
    }));
  }

  // Compute aggregate stats and filterable plan in one pass.
  const { aggregate, activeCount } = useMemo(() => {
    let agg = 0;
    let active = 0;
    for (const e of employees) {
      const r = rows[e.id];
      if (!r) continue;
      const c = Number(r.count);
      const rate = Number(r.rate);
      if (!Number.isFinite(c) || c <= 0) continue;
      if (!Number.isFinite(rate) || rate < 0) continue;
      agg += Math.round(c * rate * 100); // paise
      active += 1;
    }
    return { aggregate: agg, activeCount: active };
  }, [employees, rows]);

  const canSave = activeCount > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setTopError(null);

    const entries = employees
      .map((e) => {
        const r = rows[e.id];
        if (!r) return null;
        const count = Number(r.count);
        const rate = Number(r.rate);
        if (!Number.isFinite(count) || count <= 0) return null;
        if (!Number.isFinite(rate) || rate < 0) return null;
        return {
          employeeId: e.id,
          count,
          ratePerPiece: rate,
          note: r.note.trim() === "" ? null : r.note.trim(),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (entries.length === 0) {
      setSaving(false);
      return;
    }

    const result = await createBulkPieceEntries({
      date: new Date(date),
      entries,
    });

    setSaving(false);

    if (!result.ok) {
      setTopError("Save failed. Please check entries and retry.");
      return;
    }

    // Reset every row — rate is now dynamic per entry, so it
    // shouldn't carry over to the next save.
    setRows(() => {
      const next: Record<string, RowState> = {};
      for (const e of employees) {
        next[e.id] = { count: "", rate: "", note: "" };
      }
      return next;
    });
    onSaved();
    router.refresh();
  }

  return (
    <section data-testid="bulk-piece-entry-section">
      <header className="flex items-baseline justify-between gap-2 mb-3 flex-wrap">
        <h2 className="font-display text-sm uppercase tracking-widest text-on-surface">
          Daily piece entry
        </h2>
        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
          <FormLabel htmlFor="bulk-date" className="m-0">
            Date
          </FormLabel>
          <input
            id="bulk-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-transparent border-0 border-b border-outline-variant focus:border-secondary focus:outline-none py-1 text-on-surface text-sm"
          />
        </div>
      </header>

      {employees.length === 0 ? (
        <div className="border border-outline-variant bg-surface-container-low p-6 text-center text-sm text-on-surface-variant">
          No labour employees. Add one in Employees first.
        </div>
      ) : (
        <>
          <div className="border border-outline-variant bg-surface-container-low">
            {/* Header row (desktop only) */}
            <div className="hidden md:grid grid-cols-[1fr_110px_100px_1fr_130px] gap-4 px-4 py-2 bg-surface-container-high text-xs uppercase tracking-wider font-display text-on-surface-variant">
              <span>Worker</span>
              <span className="text-right">Rate (₹)</span>
              <span className="text-right">Count</span>
              <span>Note</span>
              <span className="text-right">Line total</span>
            </div>
            {employees.map((e, idx) => {
              const r = rows[e.id] ?? { count: "", rate: "", note: "" };
              const c = Number(r.count);
              const rate = Number(r.rate);
              const lineTotal =
                Number.isFinite(c) && Number.isFinite(rate) && c > 0 && rate >= 0
                  ? Math.round(c * rate * 100)
                  : 0;
              return (
                <div
                  key={e.id}
                  data-testid="bulk-entry-row"
                  data-employee-id={e.id}
                  className={`grid grid-cols-1 md:grid-cols-[1fr_110px_100px_1fr_130px] gap-2 md:gap-4 px-4 py-3 items-start md:items-center ${
                    idx % 2 === 0
                      ? "bg-surface-container"
                      : "bg-surface-container-low"
                  }`}
                >
                  <div className="min-w-0 text-sm text-on-surface truncate font-medium md:self-center">
                    {e.name}
                  </div>
                  {/* Mobile: rate + count side by side (2 cols), note full-width below */}
                  <div className="grid grid-cols-2 md:contents gap-2">
                    <div>
                      <FormLabel
                        htmlFor={`bulk-rate-${e.id}`}
                        className="md:sr-only"
                      >
                        Rate
                      </FormLabel>
                      <FormInput
                        id={`bulk-rate-${e.id}`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={r.rate}
                        onChange={(ev) =>
                          setRow(e.id, { rate: ev.target.value })
                        }
                        className="text-right tabular-nums"
                      />
                    </div>
                    <div>
                      <FormLabel
                        htmlFor={`bulk-count-${e.id}`}
                        className="md:sr-only"
                      >
                        Count
                      </FormLabel>
                      <FormInput
                        id={`bulk-count-${e.id}`}
                        type="number"
                        inputMode="numeric"
                        step="1"
                        min="0"
                        value={r.count}
                        onChange={(ev) =>
                          setRow(e.id, { count: ev.target.value })
                        }
                        className="text-right tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="md:contents">
                    <div>
                      <FormLabel
                        htmlFor={`bulk-note-${e.id}`}
                        className="md:sr-only"
                      >
                        Note
                      </FormLabel>
                      <FormInput
                        id={`bulk-note-${e.id}`}
                        type="text"
                        autoComplete="off"
                        maxLength={500}
                        value={r.note}
                        onChange={(ev) =>
                          setRow(e.id, { note: ev.target.value })
                        }
                        placeholder="e.g. polishing, setting"
                      />
                    </div>
                  </div>
                  <div className="text-sm tabular-nums font-mono text-on-surface md:text-right">
                    {lineTotal > 0 ? formatCurrency(lineTotal) : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {topError && (
            <div className="mt-3">
              <FormError>{topError}</FormError>
            </div>
          )}

          <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="text-sm text-on-surface-variant">
              {activeCount === 0 ? (
                "No entries to save"
              ) : (
                <>
                  {activeCount} {activeCount === 1 ? "worker" : "workers"} ·{" "}
                  <span className="text-on-surface font-mono tabular-nums">
                    {formatCurrency(aggregate)}
                  </span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="h-11 md:h-10 px-6 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 w-full md:w-auto"
              data-testid="bulk-save-button"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              <span>{saving ? "Saving…" : "Save all"}</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
}
