import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, todayIsoIST } from "@/lib/format";
import {
  listPayables,
  listReceivables,
  type PartyPayableRollup,
  type PartyReceivableRollup,
} from "@/lib/outstanding-balances";
import {
  countPieceEntriesForIstDay,
  getLabourSummary,
} from "@/lib/labour-balances";

// Role-aware dashboard. Each branch fetches only the data its cards need.
// Phase 17b: every non-LABOUR_MGMT branch gets payables (and ADMIN also
// gets receivables) cards + top-3 party lists.

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

// Top-3 list under a summary card. Each row links to /payables/<id>
// or /receivables/<id> for the detail page where the user can pay.
function TopThreeList({
  title,
  rollups,
  basePath,
  emptyText,
}: {
  title: string;
  rollups: { id: string; name: string; outstanding: number }[];
  basePath: "/payables" | "/receivables";
  emptyText: string;
}) {
  return (
    <div className="p-6 bg-surface-container border border-outline-variant">
      <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-3">
        {title}
      </p>
      {rollups.length === 0 ? (
        <p className="text-sm text-on-surface-variant">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {rollups.slice(0, 3).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <Link
                href={`${basePath}/${r.id}`}
                className="flex-1 text-sm text-on-surface hover:underline truncate"
              >
                {r.name}
              </Link>
              <span className="tabular-nums font-mono text-sm text-on-surface">
                {formatCurrency(r.outstanding)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- per-role dashboards ----------

async function AdminDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [
    customerCount,
    supplierCount,
    salesAgg,
    purchasesAgg,
    billsReady,
    payables,
    receivables,
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
    listPayables("all"),
    listReceivables(),
    getLabourSummary(),
  ]);

  // Per-source payables breakdown. `listPayables("all")` already returns
  // every rollup with per-source amounts attached, so splitting is free
  // — no extra queries. Each top-3 list re-sorts by the per-source
  // amount because the rollup array is sorted by combined total.
  const purchaseTotal = payables.reduce((s, p) => s + p.purchaseOutstanding, 0);
  const castingTotal = payables.reduce((s, p) => s + p.castingOutstanding, 0);
  const platingTotal = payables.reduce((s, p) => s + p.platingOutstanding, 0);
  const totalReceivables = receivables.reduce((s, r) => s + r.totalOutstanding, 0);

  const projectBySource = (key: "purchase" | "casting" | "plating") =>
    payables
      .map((p: PartyPayableRollup) => ({
        id: p.party.id,
        name: p.party.name,
        outstanding:
          key === "purchase"
            ? p.purchaseOutstanding
            : key === "casting"
              ? p.castingOutstanding
              : p.platingOutstanding,
      }))
      .filter((r) => r.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding);

  const supplierTop = projectBySource("purchase");
  const castingTop = projectBySource("casting");
  const platingTop = projectBySource("plating");

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Admin overview" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <Card label="Customers" value={String(customerCount)} />
        <Card label="Suppliers" value={String(supplierCount)} />
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
        <Card
          label="Purchase Payables"
          value={formatCurrency(purchaseTotal)}
          hint={`${supplierTop.length} ${supplierTop.length === 1 ? "supplier" : "suppliers"}`}
        />
        <Card
          label="Casting Payables"
          value={formatCurrency(castingTotal)}
          hint={`${castingTop.length} ${castingTop.length === 1 ? "vendor" : "vendors"}`}
        />
        <Card
          label="Plating Payables"
          value={formatCurrency(platingTotal)}
          hint={`${platingTop.length} ${platingTop.length === 1 ? "vendor" : "vendors"}`}
        />
        <Card
          label="Total Receivables"
          value={formatCurrency(totalReceivables)}
          hint={`${receivables.length} customers`}
        />
        <Card
          label="Bills stored"
          value={String(billsReady)}
          hint="Active receipts in R2"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <TopThreeList
          title="Top suppliers you owe"
          rollups={supplierTop}
          basePath="/payables"
          emptyText="No outstanding supplier payables."
        />
        <TopThreeList
          title="Top casting vendors you owe"
          rollups={castingTop}
          basePath="/payables"
          emptyText="No outstanding casting payables."
        />
        <TopThreeList
          title="Top plating vendors you owe"
          rollups={platingTop}
          basePath="/payables"
          emptyText="No outstanding plating payables."
        />
        <TopThreeList
          title="Top customers who owe you"
          rollups={receivables.map((r: PartyReceivableRollup) => ({
            id: r.party.id,
            name: r.party.name,
            outstanding: r.totalOutstanding,
          }))}
          basePath="/receivables"
          emptyText="No outstanding receivables."
        />
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

  const [supplierCount, purchasesAgg, payables] = await Promise.all([
    prisma.party.count({ where: { isSupplier: true, deletedAt: null } }),
    prisma.purchase.aggregate({
      where: { deletedAt: null, date: monthRange },
      _count: { _all: true },
      _sum: { total: true },
    }),
    listPayables("purchase"),
  ]);

  const totalPayables = payables.reduce((s, p) => s + p.totalOutstanding, 0);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Purchases overview" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card label="Suppliers" value={String(supplierCount)} />
        <Card
          label="Purchases (this month)"
          value={formatCurrency(Number(purchasesAgg._sum.total ?? 0n))}
          hint={`${purchasesAgg._count._all} transactions`}
        />
        <Card
          label="Purchase Payables"
          value={formatCurrency(totalPayables)}
          hint={`${payables.length} suppliers`}
        />
      </div>

      <TopThreeList
        title="Top suppliers you owe"
        rollups={payables.map((p) => ({
          id: p.party.id,
          name: p.party.name,
          outstanding: p.totalOutstanding,
        }))}
        basePath="/payables"
        emptyText="No outstanding supplier payables."
      />
    </div>
  );
}

async function LabourDashboard({ name }: { name: string }) {
  const [fixed, labour, salaryAgg, labourSummary, todayCount] = await Promise.all([
    prisma.employee.count({ where: { deletedAt: null, type: "FIXED" } }),
    prisma.employee.count({ where: { deletedAt: null, type: "LABOUR" } }),
    prisma.employee.aggregate({
      where: { deletedAt: null, type: "FIXED" },
      _sum: { monthlySalary: true },
    }),
    getLabourSummary(),
    countPieceEntriesForIstDay(todayIsoIST()),
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

      <LabourSection summary={labourSummary} todayCount={todayCount} />
    </div>
  );
}

async function CastingPlatingDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [castingAgg, platingAgg, vendorCount, payables] = await Promise.all([
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
    listPayables("casting_plating"),
  ]);

  const totalPayables = payables.reduce((s, p) => s + p.totalOutstanding, 0);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Casting & Plating" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
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
        <Card
          label="Casting/Plating Payables"
          value={formatCurrency(totalPayables)}
          hint={`${payables.length} vendors`}
        />
        <Card label="Vendors" value={String(vendorCount)} />
      </div>

      <TopThreeList
        title="Top vendors you owe"
        rollups={payables.map((p) => ({
          id: p.party.id,
          name: p.party.name,
          outstanding: p.totalOutstanding,
        }))}
        basePath="/payables"
        emptyText="No outstanding vendor payables."
      />
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
