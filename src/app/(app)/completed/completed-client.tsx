"use client";

// Phase 19 — /completed client component.
//
// Owns: tab selection, filter state (from / to / partyQuery), modal
// state per entity. Filters are SHARED across all five tabs — changing
// the date range or party query updates every tab's underlying list at
// once via a server-side re-fetch. The page server-component parses
// the URL search params and fetches initial data; this client component
// keeps the inputs in sync with the URL via `router.replace(...)` on
// debounced input changes (300ms for text, immediate for date).

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { SaleDetailModal } from "@/app/(app)/sales/sale-detail-modal";
import { PurchaseDetailModal } from "@/app/(app)/purchases/purchase-detail-modal";
import { CastingDetailModal } from "@/app/(app)/casting/casting-detail-modal";
import { PlatingDetailModal } from "@/app/(app)/plating/plating-detail-modal";
import { PaymentDetailModal } from "@/components/payment-detail-modal";

import type { SaleForClient } from "@/app/(app)/sales/sale-helpers";
import type { PurchaseForClient } from "@/app/(app)/purchases/purchase-helpers";
import type { CastingEntryForClient } from "@/app/(app)/casting/casting-helpers";
import type { PlatingEntryForClient } from "@/app/(app)/plating/plating-helpers";
import type { EmployeePaymentForCompleted } from "@/lib/completed-queries";

import { CompletedSalesTable } from "./completed-sales-table";
import { CompletedPurchasesTable } from "./completed-purchases-table";
import { CompletedCastingTable } from "./completed-casting-table";
import { CompletedPlatingTable } from "./completed-plating-table";
import { CompletedPayrollTable } from "./completed-payroll-table";

type Props = {
  sales: SaleForClient[];
  purchases: PurchaseForClient[];
  casting: CastingEntryForClient[];
  plating: PlatingEntryForClient[];
  payroll: EmployeePaymentForCompleted[];
  initialFrom: string; // "YYYY-MM-DD"
  initialTo: string; // "YYYY-MM-DD"
  initialQuery: string;
};

type TabKey = "sales" | "purchases" | "casting" | "plating" | "payroll";

export function CompletedClient({
  sales,
  purchases,
  casting,
  plating,
  payroll,
  initialFrom,
  initialTo,
  initialQuery,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [tab, setTab] = useState<TabKey>("sales");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [query, setQuery] = useState(initialQuery);

  // Detail-modal slots — one per entity. Derive from the parent list
  // via id-lookup so a router.refresh() flips the modal to the fresh
  // row (live-update pattern from Phase 3.2 — KNOWN_GAPS).
  const [viewingSaleId, setViewingSaleId] = useState<string | null>(null);
  const [viewingPurchaseId, setViewingPurchaseId] = useState<string | null>(null);
  const [viewingCastingId, setViewingCastingId] = useState<string | null>(null);
  const [viewingPlatingId, setViewingPlatingId] = useState<string | null>(null);
  const [viewingPayrollId, setViewingPayrollId] = useState<string | null>(null);

  const viewingSale = viewingSaleId
    ? (sales.find((s) => s.id === viewingSaleId) ?? null)
    : null;
  const viewingPurchase = viewingPurchaseId
    ? (purchases.find((p) => p.id === viewingPurchaseId) ?? null)
    : null;
  const viewingCasting = viewingCastingId
    ? (casting.find((c) => c.id === viewingCastingId) ?? null)
    : null;
  const viewingPlating = viewingPlatingId
    ? (plating.find((p) => p.id === viewingPlatingId) ?? null)
    : null;
  const viewingPayroll = viewingPayrollId
    ? (payroll.find((p) => p.id === viewingPayrollId) ?? null)
    : null;

  // Push current filter state to URL. Date changes commit immediately;
  // text query is debounced 300ms.
  const pushFilters = (next: { from: string; to: string; query: string }) => {
    const params = new URLSearchParams();
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.query.trim()) params.set("q", next.query.trim());
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/completed?${qs}` : "/completed");
    });
  };

  // Debounce text-query updates so each keystroke doesn't fire a
  // server round-trip.
  const queryRef = useRef(query);
  queryRef.current = query;
  const queryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    queryTimerRef.current = setTimeout(() => {
      pushFilters({ from, to, query: queryRef.current });
    }, 300);
    return () => {
      if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const handleFromChange = (value: string) => {
    setFrom(value);
    pushFilters({ from: value, to, query });
  };
  const handleToChange = (value: string) => {
    setTo(value);
    pushFilters({ from, to: value, query });
  };

  const counts = {
    sales: sales.length,
    purchases: purchases.length,
    casting: casting.length,
    plating: plating.length,
    payroll: payroll.length,
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Filters — shared across all tabs */}
      <div
        data-testid="completed-filters"
        className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4"
      >
        <div className="flex flex-col gap-1 md:flex-1 md:max-w-xs">
          <label
            htmlFor="completed-from"
            className="text-[10px] uppercase tracking-wider text-on-surface-variant font-display"
          >
            From
          </label>
          <input
            id="completed-from"
            data-testid="completed-from"
            type="date"
            value={from}
            onChange={(e) => handleFromChange(e.target.value)}
            className="bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface transition-colors h-11 md:h-10"
          />
        </div>
        <div className="flex flex-col gap-1 md:flex-1 md:max-w-xs">
          <label
            htmlFor="completed-to"
            className="text-[10px] uppercase tracking-wider text-on-surface-variant font-display"
          >
            To
          </label>
          <input
            id="completed-to"
            data-testid="completed-to"
            type="date"
            value={to}
            onChange={(e) => handleToChange(e.target.value)}
            className="bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface transition-colors h-11 md:h-10"
          />
        </div>
        <div className="flex flex-col gap-1 md:flex-1">
          <label
            htmlFor="completed-query"
            className="text-[10px] uppercase tracking-wider text-on-surface-variant font-display"
          >
            Search party / employee
          </label>
          <input
            id="completed-query"
            data-testid="completed-query"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or phone…"
            className="bg-surface-container-low border border-outline-variant focus:border-secondary focus:outline-none px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 transition-colors h-11 md:h-10"
          />
        </div>
        {isPending && (
          <span
            data-testid="completed-loading"
            className="text-xs uppercase tracking-wider text-on-surface-variant md:pb-2"
          >
            Loading…
          </span>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="sales" data-testid="tab-sales">
            Sales
            <CountBadge count={counts.sales} />
          </TabsTrigger>
          <TabsTrigger value="purchases" data-testid="tab-purchases">
            Purchases
            <CountBadge count={counts.purchases} />
          </TabsTrigger>
          <TabsTrigger value="casting" data-testid="tab-casting">
            Casting
            <CountBadge count={counts.casting} />
          </TabsTrigger>
          <TabsTrigger value="plating" data-testid="tab-plating">
            Plating
            <CountBadge count={counts.plating} />
          </TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">
            Payroll
            <CountBadge count={counts.payroll} />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4 md:mt-6">
          {sales.length === 0 ? (
            <EmptyState label="No completed sales in this period." />
          ) : (
            <CompletedSalesTable
              sales={sales}
              onRowClick={(id) => setViewingSaleId(id)}
            />
          )}
        </TabsContent>
        <TabsContent value="purchases" className="mt-4 md:mt-6">
          {purchases.length === 0 ? (
            <EmptyState label="No completed purchases in this period." />
          ) : (
            <CompletedPurchasesTable
              purchases={purchases}
              onRowClick={(id) => setViewingPurchaseId(id)}
            />
          )}
        </TabsContent>
        <TabsContent value="casting" className="mt-4 md:mt-6">
          {casting.length === 0 ? (
            <EmptyState label="No completed casting jobs in this period." />
          ) : (
            <CompletedCastingTable
              entries={casting}
              onRowClick={(id) => setViewingCastingId(id)}
            />
          )}
        </TabsContent>
        <TabsContent value="plating" className="mt-4 md:mt-6">
          {plating.length === 0 ? (
            <EmptyState label="No completed plating jobs in this period." />
          ) : (
            <CompletedPlatingTable
              entries={plating}
              onRowClick={(id) => setViewingPlatingId(id)}
            />
          )}
        </TabsContent>
        <TabsContent value="payroll" className="mt-4 md:mt-6">
          {payroll.length === 0 ? (
            <EmptyState label="No employee payments in this period." />
          ) : (
            <CompletedPayrollTable
              payments={payroll}
              onRowClick={(id) => setViewingPayrollId(id)}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Detail modals — open on row click. Live-update via id-derived
          `viewing*` lookups so a router.refresh() in the parent flips
          the modal contents to the fresh row. */}
      <SaleDetailModal
        open={viewingSale !== null}
        onOpenChange={(open) => !open && setViewingSaleId(null)}
        sale={viewingSale}
      />
      <PurchaseDetailModal
        open={viewingPurchase !== null}
        onOpenChange={(open) => !open && setViewingPurchaseId(null)}
        purchase={viewingPurchase}
      />
      <CastingDetailModal
        open={viewingCasting !== null}
        onOpenChange={(open) => !open && setViewingCastingId(null)}
        entry={viewingCasting}
      />
      <PlatingDetailModal
        open={viewingPlating !== null}
        onOpenChange={(open) => !open && setViewingPlatingId(null)}
        entry={viewingPlating}
      />
      <PaymentDetailModal
        open={viewingPayroll !== null}
        onOpenChange={(open) => !open && setViewingPayrollId(null)}
        payment={viewingPayroll}
      />
    </div>
  );
}

function CountBadge({ count }: { count: number }) {
  return (
    <span
      data-testid="tab-count"
      className="ml-2 inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[10px] font-mono tabular-nums bg-surface-container border border-outline-variant text-on-surface-variant"
    >
      {count}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="border border-outline-variant bg-surface-container-low p-12 text-center">
      <p
        data-testid="completed-empty"
        className="text-on-surface-variant text-sm"
      >
        {label}
      </p>
      <p className="text-on-surface-variant text-xs uppercase tracking-wider mt-3">
        Try adjusting the date range.
      </p>
    </div>
  );
}
