import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canViewLedger } from "@/lib/role-access";
import {
  listLedgerHome,
  listLedgerHomeWalkIns,
  parseLedgerTabSlug,
} from "@/lib/ledger-home";

import { LedgerClient } from "./ledger-client";

type SearchParams = Promise<{ tab?: string | string[] }>;

// Phase 21c.1 — Unified ledger home page.
//
// Layout (top to bottom):
//   1. Role-scoped summary boxes (1-4 cards depending on role)
//   2. Unified owner list — parties + karigar, role-scoped, sorted by
//      abs(balance) desc; click any row → that owner's khata view
//      (/ledger/party/[id] or /ledger/karigar/[id]).
//   3. Walk-in section (transactions with partyId IS NULL that still
//      live on the *Payment rails). Inline Pay buttons because walk-ins
//      have no khata page.
//
// Defense-in-depth gates: proxy ROUTE_ROLES (URL) + this page-level
// canViewLedger redirect + role-scoped query in listLedgerHome (data).
// The /ledger surface is intentionally non-mutating at the action layer
// — every mutation routes through the owner's khata page (party or
// karigar) which uses the existing 21a / 21a.1 / 21b.1 actions.

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const role = session.user.role;
  if (!canViewLedger(role)) redirect("/dashboard");

  // Phase 21c.1.1 — deep-link entry point. Dashboard category boxes
  // navigate to /ledger?tab=<slug>; the client pre-selects that tab on
  // mount. Invalid / missing slug → "all" (the unified-list default).
  // Scoped roles only ever see one tab anyway (their box) → the param
  // is benign for them, the tab bar isn't even rendered.
  const { tab: rawTab } = await searchParams;
  const initialTab = parseLedgerTabSlug(rawTab);

  const [home, walkIns] = await Promise.all([
    listLedgerHome(role),
    listLedgerHomeWalkIns(role),
  ]);

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Ledger
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {home.owners.length === 0 && walkIns.payables.length === 0 && walkIns.receivables.length === 0
            ? "All accounts settled"
            : `${home.owners.length} ${home.owners.length === 1 ? "owner" : "owners"} · ${walkIns.payables.length + walkIns.receivables.length} walk-in${walkIns.payables.length + walkIns.receivables.length === 1 ? "" : "s"}`}
        </p>
      </header>

      <LedgerClient
        boxes={home.boxes}
        owners={home.owners}
        walkInPayables={walkIns.payables}
        walkInReceivables={walkIns.receivables}
        initialTab={initialTab}
      />
    </div>
  );
}
