import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { auth } from "@/lib/auth";
import { canViewLedger } from "@/lib/role-access";
import { prisma } from "@/lib/prisma";
import { listEmployeeLedger } from "@/lib/ledger";

import { KarigarLedgerDetail } from "./karigar-ledger-detail";

// Phase 21c.1 — Per-karigar khata view inside /ledger.
//
// Completes Phase 21b's deferred view layer. Mirrors the party khata
// shape but for the employee owner. Reuses:
//   - `listEmployeeLedger` (Phase 21b — added explicitly for 21c)
//   - `KarigarLedgerEntryModal` (Phase 21b.1 — MANUAL_PAYMENT advances /
//     payments / adjustments)
//   - `EmployeePaymentModal` (Phase 18, paymentType=WAGE — settlement
//     against work done)
//   - `softDeleteKarigarLedgerEntry` (Phase 21b.1)
//
// Access:
//   - ADMIN + LABOUR_MGMT: full karigar khata.
//   - PURCHASE_DEPT / CASTING_PLATING_MGMT: redirect to /ledger
//     (karigar is not in their box scope).

type Props = {
  params: Promise<{ employeeId: string }>;
};

export default async function KarigarLedgerPage({ params }: Props) {
  const { employeeId } = await params;
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const role = session.user.role;
  if (!canViewLedger(role)) redirect("/dashboard");
  if (role !== "ADMIN" && role !== "LABOUR_MGMT") {
    redirect("/ledger");
  }

  // Fetch employee + ledger entries in parallel.
  const [employee, entries] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        type: true,
      },
    }),
    listEmployeeLedger(employeeId),
  ]);

  if (!employee) notFound();
  // FIXED employees stay on the SALARY rail (Phase 21b scope) — they
  // don't have a karigar khata. Defensive redirect.
  if (employee.type !== "LABOUR") redirect("/ledger");

  // listEmployeeLedger pre-computes the running balance on each entry —
  // the last entry's runningBalance IS the current signed balance
  // (raw, paise as Number). Zero entries → zero balance.
  const balance =
    entries.length === 0
      ? 0
      : entries[entries.length - 1].runningBalance;

  return (
    <div className="p-4 md:p-10">
      <header className="mb-6 pb-4 md:mb-10 md:pb-6 border-b border-outline-variant">
        <Link
          href="/ledger"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors mb-3"
        >
          <ArrowLeft className="size-3.5" />
          Back to ledger
        </Link>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight mb-1">
          {employee.name}
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          {employee.phone ?? "No phone"} · Karigar
        </p>
      </header>

      <KarigarLedgerDetail
        employee={{
          id: employee.id,
          name: employee.name,
        }}
        balance={balance}
        entries={entries}
      />
    </div>
  );
}
