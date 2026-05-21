import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canViewReceivables } from "@/lib/role-access";
import {
  listReceivables,
  listWalkInReceivables,
} from "@/lib/outstanding-balances";

import { ReceivablesTable } from "./receivables-table";

// /receivables — ADMIN-only. Outstanding sales surfaced from two
// sources (same shape as /payables):
//   1. Party rollups (listReceivables) — one row per customer Party.
//   2. Walk-in rows (listWalkInReceivables) — one row per sale with
//      partyId IS NULL (no-phone walk-in sale). "Receive" opens the
//      per-sale PaymentActionModal.

export default async function ReceivablesPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  if (!canViewReceivables(session.user.role)) redirect("/dashboard");

  const [rollups, walkIns] = await Promise.all([
    listReceivables(),
    listWalkInReceivables(),
  ]);

  const totalRows = rollups.length + walkIns.length;

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Receivables
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {totalRows}{" "}
          {totalRows === 1 ? "outstanding receivable" : "outstanding receivables"}
          {walkIns.length > 0 && (
            <>
              {" "}· {walkIns.length} walk-in{walkIns.length === 1 ? "" : "s"}
            </>
          )}
        </p>
      </header>

      <ReceivablesTable rollups={rollups} walkIns={walkIns} />
    </div>
  );
}
