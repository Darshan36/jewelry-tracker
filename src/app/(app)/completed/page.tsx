import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canViewCompleted } from "@/lib/role-access";
import {
  endOfCurrentMonthIST,
  startOfCurrentMonthIST,
} from "@/lib/format";
import {
  getCompletedCastingEntries,
  getCompletedEmployeePayments,
  getCompletedPlatingEntries,
  getCompletedPurchases,
  getCompletedSales,
  type DateRange,
} from "@/lib/completed-queries";

import { CompletedClient } from "./completed-client";

// Phase 19 — /completed: aggregated cross-entity history view.
//
// ADMIN-only. Other roles get redirected at the page layer (defense in
// depth alongside proxy.ts ROUTE_ROLES). Default date range is the
// current IST calendar month; query params (`from`, `to`, `q`) override.
//
// The page is a server component — it parses search params, fetches all
// five tabs' initial data in parallel, then hands the serialised lists
// to the client component. When filters change, the client navigates
// via `router.replace(...)` to a new URL with updated search params,
// triggering a fresh server-side fetch through Next.js's app-router
// re-render. No client-side data fetching needed.

type PageProps = {
  // Next.js 16 — searchParams is a Promise that resolves to the parsed
  // query (the new opt-in async signature). The legacy plain-object
  // shape is deprecated.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  // Accept "YYYY-MM-DD" (the <input type="date"> wire format).
  // Coerce to midnight UTC, matching how Sale/Purchase store their
  // `date` field — see CLAUDE.md §4.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  return new Date(Date.UTC(y, m - 1, d));
}

function resolveRange(
  fromParam: string | undefined,
  toParam: string | undefined,
): DateRange {
  const from = parseDate(fromParam);
  const to = parseDate(toParam);
  // Default: current IST calendar month.
  if (from === null || to === null) {
    return {
      from: startOfCurrentMonthIST(),
      to: endOfCurrentMonthIST(),
    };
  }
  // `to` is treated as inclusive at the UI layer (date input picks a
  // calendar day). Internally we use a half-open range, so push `to`
  // forward by one day so a single-day range still matches.
  const toExclusive = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  return { from, to: toExclusive };
}

function asString(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

export default async function CompletedPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  if (!canViewCompleted(session.user.role)) redirect("/dashboard");

  const params = await searchParams;
  const fromParam = asString(params.from);
  const toParam = asString(params.to);
  const partyQuery = asString(params.q)?.trim() || undefined;

  const range = resolveRange(fromParam, toParam);
  const filter = { range, partyQuery };

  const [sales, purchases, casting, plating, payroll] = await Promise.all([
    getCompletedSales(filter),
    getCompletedPurchases(filter),
    getCompletedCastingEntries(filter),
    getCompletedPlatingEntries(filter),
    getCompletedEmployeePayments(filter),
  ]);

  // Re-derive the inclusive UI-facing `to` from the half-open range so
  // the form pre-fills cleanly across refresh.
  const uiTo = new Date(range.to.getTime() - 24 * 60 * 60 * 1000);

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Completed
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Settled transactions across all entity types
        </p>
      </header>

      <CompletedClient
        sales={sales}
        purchases={purchases}
        casting={casting}
        plating={plating}
        payroll={payroll}
        initialFrom={isoDateUTC(range.from)}
        initialTo={isoDateUTC(uiTo)}
        initialQuery={partyQuery ?? ""}
      />
    </div>
  );
}

function isoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
