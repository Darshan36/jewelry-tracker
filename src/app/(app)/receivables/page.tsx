import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { canViewReceivables } from "@/lib/role-access";
import { listReceivables } from "@/lib/outstanding-balances";

import { ReceivablesTable } from "./receivables-table";

// /receivables — ADMIN-only. Outstanding sales rolled up per customer.
export default async function ReceivablesPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  if (!canViewReceivables(session.user.role)) redirect("/dashboard");

  const rollups = await listReceivables();

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          Receivables
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {rollups.length} {rollups.length === 1 ? "customer" : "customers"} owe you money
        </p>
      </header>

      <ReceivablesTable rollups={rollups} />
    </div>
  );
}
