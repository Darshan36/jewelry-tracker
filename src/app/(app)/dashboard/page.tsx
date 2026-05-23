import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, todayIsoIST } from "@/lib/format";
import { listLedgerHome } from "@/lib/ledger-home";
import {
  countPieceEntriesForIstDay,
  getLabourSummary,
} from "@/lib/labour-balances";

import { LedgerBoxesGrid } from "./ledger-boxes-grid";

// Phase 21c.1 — Role-aware dashboard, consolidated.
//
// REMOVED: per-source payables cards + top-3 party lists + receivables
// card + top-3 receivable list. These duplicated /ledger and the
// dashboard/ledger drift bug class was real (it's the bug class that
// motivated the whole 21a → 21c arc). Source-of-truth is now ONE
// place: /ledger reads from listLedgerHome, dashboard reads from the
// SAME helper and renders ONE roll-up card.
//
// KEPT: tx-counts + monthly aggregates + bills-stored + labour section.
// These are "what happened this period" facts, not duplicated balance
// state — they pair with /ledger's "what's open right now" view.

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");

  const { name, role } = session.user;

  switch (role) {
    case "ADMIN":
      return <AdminDashboard name={name} />;
    case "PURCHASE_DEPT":
      return <PurchaseDashboard name={name} />;
    case "LABOUR_MGMT":
      return <LabourDashboard name={name} />;
    case "CASTING_PLATING_MGMT":
      return <CastingPlatingDashboard name={name} />;
    default: {
      const _exhaustive: never = role;
      return <UnknownRoleDashboard name={name} role={_exhaustive} />;
    }
  }
}

// ---------- shared layout primitives ----------

function PageHeader({ name, subtitle }: { name: string; subtitle: string }) {
  return (
    <header className="mb-10 pb-6 border-b border-outline-variant">
      <h1 className="text-3xl font-semibold tracking-tight mb-1">Dashboard</h1>
      <p className="text-on-surface-variant text-xs uppercase tracking-widest">
        Welcome back, {name} · {subtitle}
      </p>
    </header>
  );
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="p-6 bg-surface-container border border-outline-variant">
      <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-2">
        {label}
      </p>
      <p className="font-display text-2xl font-semibold">{value}</p>
      {hint && <p className="text-xs text-on-surface-variant mt-1">{hint}</p>}
    </div>
  );
}

// Phase 21c.1.1 — per-category clickable dashboard boxes.
// Implementation extracted to `./ledger-boxes-grid.tsx` so it's
// unit-testable. See the file header for the DRIFT-PROOF SAME-SOURCE
// invariant — both this dashboard render site and the /ledger render
// site read the same `home.boxes` from one `listLedgerHome(role)` call.

// ---------- per-role dashboards ----------

async function AdminDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [
    customerCount,
    supplierCount,
    salesAgg,
    purchasesAgg,
    billsReady,
    home,
    labour,
  ] = await Promise.all([
    prisma.party.count({ where: { isCustomer: true, deletedAt: null } }),
    prisma.party.count({ where: { isSupplier: true, deletedAt: null } }),
    prisma.sale.aggregate({
      where: { deletedAt: null, date: monthRange },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.purchase.aggregate({
      where: { deletedAt: null, date: monthRange },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.attachment.count({ where: { deletedAt: null, status: "READY" } }),
    listLedgerHome("ADMIN"),
    getLabourSummary(),
  ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Admin overview" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
        <Card label="Customers" value={String(customerCount)} />
        <Card label="Suppliers" value={String(supplierCount)} />
        <Card
          label="Bills stored"
          value={String(billsReady)}
          hint="Active receipts in R2"
        />
        <Card
          label="Sales (this month)"
          value={formatCurrency(Number(salesAgg._sum.total ?? 0n))}
          hint={`${salesAgg._count._all} transactions`}
        />
        <Card
          label="Purchases (this month)"
          value={formatCurrency(Number(purchasesAgg._sum.total ?? 0n))}
          hint={`${purchasesAgg._count._all} transactions`}
        />
      </div>

      {/* Phase 21c.1.1 — per-category ledger boxes, drift-proof same source */}
      <h2 className="font-display text-sm uppercase tracking-widest text-on-surface-variant mb-3">
        Ledger
      </h2>
      <div
        data-testid="dashboard-ledger-boxes"
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-6"
      >
        <LedgerBoxesGrid boxes={home.boxes} />
      </div>

      <LabourSection summary={labour} />
    </div>
  );
}

// Phase 18 — shared labour section for ADMIN and LABOUR_MGMT dashboards.
async function LabourSection({
  summary,
  todayCount,
}: {
  summary: Awaited<ReturnType<typeof getLabourSummary>>;
  todayCount?: number;
}) {
  return (
    <div data-testid="dashboard-labour-section">
      <h2 className="font-display text-sm uppercase tracking-widest text-on-surface-variant mb-3">
        Labour
      </h2>
      <div
        className={`grid grid-cols-1 md:grid-cols-2 ${todayCount !== undefined ? "xl:grid-cols-3" : ""} gap-3`}
      >
        <Link href="/labour" className="block">
          <Card
            label="Salaries due this month"
            value={String(summary.missingSalaryCount)}
            hint={
              summary.missingSalaryCount === 0
                ? "All fixed staff paid"
                : `${formatCurrency(summary.missingSalaryTotal)} pending`
            }
          />
        </Link>
        <Link href="/labour" className="block">
          <Card
            label="Outstanding wages"
            value={formatCurrency(summary.outstandingWagesTotal)}
            hint={
              summary.outstandingWagesCount === 0
                ? "No unpaid pieces"
                : `${summary.outstandingWagesCount} ${
                    summary.outstandingWagesCount === 1 ? "worker" : "workers"
                  }`
            }
          />
        </Link>
        {todayCount !== undefined && (
          <Link href="/labour" className="block">
            <Card
              label="Pieces entered today"
              value={String(todayCount)}
              hint="Daily piece entries"
            />
          </Link>
        )}
      </div>
    </div>
  );
}

async function PurchaseDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [supplierCount, purchasesAgg, home] = await Promise.all([
    prisma.party.count({ where: { isSupplier: true, deletedAt: null } }),
    prisma.purchase.aggregate({
      where: { deletedAt: null, date: monthRange },
      _count: { _all: true },
      _sum: { total: true },
    }),
    listLedgerHome("PURCHASE_DEPT"),
  ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Purchases overview" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Card label="Suppliers" value={String(supplierCount)} />
        <Card
          label="Purchases (this month)"
          value={formatCurrency(Number(purchasesAgg._sum.total ?? 0n))}
          hint={`${purchasesAgg._count._all} transactions`}
        />
      </div>

      <h2 className="font-display text-sm uppercase tracking-widest text-on-surface-variant mb-3">
        Ledger
      </h2>
      <div
        data-testid="dashboard-ledger-boxes"
        className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4"
      >
        <LedgerBoxesGrid boxes={home.boxes} />
      </div>
    </div>
  );
}

async function LabourDashboard({ name }: { name: string }) {
  const [fixed, labour, salaryAgg, labourSummary, todayCount, home] = await Promise.all([
    prisma.employee.count({ where: { deletedAt: null, type: "FIXED" } }),
    prisma.employee.count({ where: { deletedAt: null, type: "LABOUR" } }),
    prisma.employee.aggregate({
      where: { deletedAt: null, type: "FIXED" },
      _sum: { monthlySalary: true },
    }),
    getLabourSummary(),
    countPieceEntriesForIstDay(todayIsoIST()),
    listLedgerHome("LABOUR_MGMT"),
  ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Employees overview" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Card
          label="Employees"
          value={`${fixed + labour}`}
          hint={`${fixed} fixed · ${labour} labour`}
        />
        <Card
          label="Monthly salary (fixed)"
          value={formatCurrency(Number(salaryAgg._sum.monthlySalary ?? 0n))}
          hint="Sum of fixed-salary commitments"
        />
      </div>

      <h2 className="font-display text-sm uppercase tracking-widest text-on-surface-variant mb-3">
        Ledger
      </h2>
      <div
        data-testid="dashboard-ledger-boxes"
        className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6"
      >
        <LedgerBoxesGrid boxes={home.boxes} />
      </div>

      <LabourSection summary={labourSummary} todayCount={todayCount} />
    </div>
  );
}

async function CastingPlatingDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [castingAgg, platingAgg, vendorCount, home] = await Promise.all([
    prisma.castingEntry.aggregate({
      where: { deletedAt: null, date: monthRange },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.platingEntry.aggregate({
      where: { deletedAt: null, date: monthRange },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.party.count({
      where: {
        OR: [{ isCastingVendor: true }, { isPlatingVendor: true }],
        deletedAt: null,
      },
    }),
    listLedgerHome("CASTING_PLATING_MGMT"),
  ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Casting & Plating" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
        <Card
          label="Casting (this month)"
          value={formatCurrency(Number(castingAgg._sum.total ?? 0n))}
          hint={`${castingAgg._count._all} entries`}
        />
        <Card
          label="Plating (this month)"
          value={formatCurrency(Number(platingAgg._sum.total ?? 0n))}
          hint={`${platingAgg._count._all} entries`}
        />
        <Card label="Vendors" value={String(vendorCount)} />
      </div>

      <h2 className="font-display text-sm uppercase tracking-widest text-on-surface-variant mb-3">
        Ledger
      </h2>
      <div
        data-testid="dashboard-ledger-boxes"
        className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4"
      >
        <LedgerBoxesGrid boxes={home.boxes} />
      </div>
    </div>
  );
}

function UnknownRoleDashboard({ name, role }: { name: string; role: never }) {
  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Unrecognised role" />
      <div className="grid grid-cols-1 gap-3">
        <Card
          label="No dashboard configured"
          value={String(role)}
          hint="Contact an administrator."
        />
      </div>
    </div>
  );
}

// ---------- helpers ----------

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { gte: start, lt: end };
}
