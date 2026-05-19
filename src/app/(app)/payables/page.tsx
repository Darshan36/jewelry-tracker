import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  canViewPayables,
  effectivePayableScope,
} from "@/lib/role-access";
import { listPayables } from "@/lib/outstanding-balances";

import { PayablesTable } from "./payables-table";

// /payables — role-scoped list of parties with outstanding payables.
// ADMIN sees all (purchase + casting + plating combined).
// PURCHASE_DEPT sees only purchase payables.
// CASTING_PLATING_MGMT sees only casting + plating payables.
// LABOUR_MGMT is redirected to /dashboard (no access at any scope).

export default async function PayablesPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const scope = effectivePayableScope(session.user.role);
  if (scope === null || !canViewPayables(session.user.role, scope)) {
    redirect("/dashboard");
  }

  const rollups = await listPayables(scope);

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Payables
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {rollups.length} {rollups.length === 1 ? "party" : "parties"} with outstanding balances
        </p>
      </header>

      <PayablesTable rollups={rollups} scope={scope} />
    </div>
  );
}
