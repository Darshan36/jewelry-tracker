import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  canViewPayables,
  effectivePayableScope,
} from "@/lib/role-access";
import {
  listPayables,
  listWalkInPayables,
} from "@/lib/outstanding-balances";

import { PayablesTable } from "./payables-table";

// /payables — role-scoped list of outstanding payables.
// ADMIN sees all (purchase + casting + plating combined).
// PURCHASE_DEPT sees only purchase payables.
// CASTING_PLATING_MGMT sees only casting + plating payables.
// LABOUR_MGMT is redirected to /dashboard (no access at any scope).
//
// Two row sources are merged into the page:
//   1. Party rollups (listPayables) — one row per master Party,
//      with their full ledger balance (raw signed; negative = credit).
//      "Pay" opens the PartyLedgerPaymentModal (single party-level
//      payment; no per-bill allocation). Phase 21a — was bulk-allocation
//      via PartyPaymentModal in 17b.
//   2. Walk-in rows (listWalkInPayables) — one row per transaction
//      whose `partyId IS NULL` (typically created from a /new form
//      with no phone). Each row is a single transaction; "Pay" opens
//      the per-entity PaymentActionModal (no party to allocate across).
//      Walk-ins remain on the *Payment rails through 21a; they migrate
//      to the ledger in 21c.

export default async function PayablesPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const scope = effectivePayableScope(session.user.role);
  if (scope === null || !canViewPayables(session.user.role, scope)) {
    redirect("/dashboard");
  }

  const [rollups, walkIns] = await Promise.all([
    listPayables(scope),
    listWalkInPayables(scope),
  ]);

  const totalRows = rollups.length + walkIns.length;

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Payables
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {totalRows}{" "}
          {totalRows === 1 ? "outstanding payable" : "outstanding payables"}
          {walkIns.length > 0 && (
            <>
              {" "}· {walkIns.length} walk-in{walkIns.length === 1 ? "" : "s"}
            </>
          )}
        </p>
      </header>

      <PayablesTable rollups={rollups} walkIns={walkIns} scope={scope} />
    </div>
  );
}
