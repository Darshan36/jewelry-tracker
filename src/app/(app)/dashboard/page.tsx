import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency, todayIsoIST } from "@/lib/format";
import {
  listPayables,
  listReceivables,
  listWalkInPayables,
  listWalkInReceivables,
  type PartyPayableRollup,
  type PartyReceivableRollup,
  type WalkInPayable,
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

// Row shape used by TopThreeList. `href` is per-row because walk-in
// rows have no party id to embed (they link to the list page itself,
// where the row is rendered as a walk-in).
type TopThreeRow = {
  key: string;
  name: string;
  outstanding: number;
  href: string;
  walkIn?: boolean;
};

// Top-3 list under a summary card. Each row links to the per-party
// detail page (for party rollups) or the list page (for walk-ins,
// which carry no party id).
function TopThreeList({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: TopThreeRow[];
  emptyText: string;
}) {
  return (
    <div className="p-6 bg-surface-container border border-outline-variant">
      <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-3">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-on-surface-variant">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 3).map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2">
              <Link
                href={r.href}
                className="flex-1 text-sm text-on-surface hover:underline truncate flex items-center gap-1.5"
              >
                <span className="truncate">{r.name}</span>
                {r.walkIn && (
                  <span
                    title="Walk-in — no party record"
                    className="shrink-0 inline-flex items-center px-1 py-0.5 text-[9px] uppercase tracking-wider bg-tertiary/10 text-tertiary border border-tertiary/30"
                  >
                    Walk-in
                  </span>
                )}
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

// Bucket walk-in payable outstandings by kind. Used for per-source
// card totals and counts.
function walkInTotalsByKind(rows: WalkInPayable[]): {
  PURCHASE: number;
  CASTING: number;
  PLATING: number;
} {
  const out = { PURCHASE: 0, CASTING: 0, PLATING: 0 };
  for (const r of rows) out[r.kind] += r.outstanding;
  return out;
}

// Card hint like "2 suppliers · 1 walk-in" (or just "2 suppliers"
// when there are none). Keeps the per-source counts honest about
// how much of the total comes from walk-ins.
function hintWithWalkIns(
  partyCount: number,
  walkInCount: number,
  singular: string,
): string {
  const plural = `${singular}s`;
  const base = `${partyCount} ${partyCount === 1 ? singular : plural}`;
  if (walkInCount === 0) return base;
  return `${base} · ${walkInCount} walk-in${walkInCount === 1 ? "" : "s"}`;
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
    walkInPayables,
    receivables,
    walkInReceivables,
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
    listWalkInPayables("all"),
    listReceivables(),
    listWalkInReceivables(),
    getLabourSummary(),
  ]);

  // Per-source payables breakdown — party-rollup amount PLUS walk-in
  // amount per source. The walk-in totals were the missing piece that
  // caused the dashboard to read lower than the live "Purchases (this
  // month)" card and the /payables list (which was already updated to
  // include walk-ins). After this, the dashboard payables figures and
  // the /payables list show the same totals.
  const walkInByKind = walkInTotalsByKind(walkInPayables);
  const purchaseTotal =
    payables.reduce((s, p) => s + p.purchaseOutstanding, 0) +
    walkInByKind.PURCHASE;
  const castingTotal =
    payables.reduce((s, p) => s + p.castingOutstanding, 0) +
    walkInByKind.CASTING;
  const platingTotal =
    payables.reduce((s, p) => s + p.platingOutstanding, 0) +
    walkInByKind.PLATING;
  const walkInReceivablesTotal = walkInReceivables.reduce(
    (s, r) => s + r.outstanding,
    0,
  );
  const totalReceivables =
    receivables.reduce((s, r) => s + r.totalOutstanding, 0) +
    walkInReceivablesTotal;

  // Project top-N rows for one source, drawn from BOTH party rollups
  // AND walk-in transactions for that source. Walk-in entries link to
  // /payables (no party id available); party rollups link to the
  // per-party detail page as before.
  const projectBySource = (
    key: "purchase" | "casting" | "plating",
  ): TopThreeRow[] => {
    const partyRows: TopThreeRow[] = payables
      .map((p: PartyPayableRollup) => ({
        key: `party-${p.party.id}`,
        name: p.party.name,
        outstanding:
          key === "purchase"
            ? p.purchaseOutstanding
            : key === "casting"
              ? p.castingOutstanding
              : p.platingOutstanding,
        href: `/payables/${p.party.id}`,
      }))
      .filter((r) => r.outstanding > 0);

    const upperKind = key.toUpperCase() as WalkInPayable["kind"];
    const walkInRows: TopThreeRow[] = walkInPayables
      .filter((w) => w.kind === upperKind)
      .map((w) => ({
        key: `walkin-${w.id}`,
        name: w.partyName || "(unnamed)",
        outstanding: w.outstanding,
        href: "/payables",
        walkIn: true,
      }));

    return [...partyRows, ...walkInRows].sort(
      (a, b) => b.outstanding - a.outstanding,
    );
  };

  const supplierTop = projectBySource("purchase");
  const castingTop = projectBySource("casting");
  const platingTop = projectBySource("plating");

  // Per-source walk-in counts for the card hints — surfaced inline so
  // the user can tell at a glance how much of each total comes from
  // unlinked rows.
  const purchaseWalkInCount = walkInPayables.filter(
    (w) => w.kind === "PURCHASE",
  ).length;
  const castingWalkInCount = walkInPayables.filter(
    (w) => w.kind === "CASTING",
  ).length;
  const platingWalkInCount = walkInPayables.filter(
    (w) => w.kind === "PLATING",
  ).length;

  // Top-N receivables — mirror the payables projection.
  const receivableTop: TopThreeRow[] = [
    ...receivables.map((r: PartyReceivableRollup) => ({
      key: `party-${r.party.id}`,
      name: r.party.name,
      outstanding: r.totalOutstanding,
      href: `/receivables/${r.party.id}`,
    })),
    ...walkInReceivables.map((r) => ({
      key: `walkin-${r.id}`,
      name: r.partyName || "(unnamed)",
      outstanding: r.outstanding,
      href: "/receivables",
      walkIn: true,
    })),
  ].sort((a, b) => b.outstanding - a.outstanding);

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
          hint={hintWithWalkIns(
            supplierTop.length - purchaseWalkInCount,
            purchaseWalkInCount,
            "supplier",
          )}
        />
        <Card
          label="Casting Payables"
          value={formatCurrency(castingTotal)}
          hint={hintWithWalkIns(
            castingTop.length - castingWalkInCount,
            castingWalkInCount,
            "vendor",
          )}
        />
        <Card
          label="Plating Payables"
          value={formatCurrency(platingTotal)}
          hint={hintWithWalkIns(
            platingTop.length - platingWalkInCount,
            platingWalkInCount,
            "vendor",
          )}
        />
        <Card
          label="Total Receivables"
          value={formatCurrency(totalReceivables)}
          hint={hintWithWalkIns(
            receivables.length,
            walkInReceivables.length,
            "customer",
          )}
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
          rows={supplierTop}
          emptyText="No outstanding supplier payables."
        />
        <TopThreeList
          title="Top casting vendors you owe"
          rows={castingTop}
          emptyText="No outstanding casting payables."
        />
        <TopThreeList
          title="Top plating vendors you owe"
          rows={platingTop}
          emptyText="No outstanding plating payables."
        />
        <TopThreeList
          title="Top customers who owe you"
          rows={receivableTop}
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

  const [supplierCount, purchasesAgg, payables, walkInPayables] =
    await Promise.all([
      prisma.party.count({ where: { isSupplier: true, deletedAt: null } }),
      prisma.purchase.aggregate({
        where: { deletedAt: null, date: monthRange },
        _count: { _all: true },
        _sum: { total: true },
      }),
      listPayables("purchase"),
      listWalkInPayables("purchase"),
    ]);

  const walkInTotal = walkInPayables.reduce((s, w) => s + w.outstanding, 0);
  const totalPayables =
    payables.reduce((s, p) => s + p.totalOutstanding, 0) + walkInTotal;

  const supplierTop: TopThreeRow[] = [
    ...payables.map((p) => ({
      key: `party-${p.party.id}`,
      name: p.party.name,
      outstanding: p.totalOutstanding,
      href: `/payables/${p.party.id}`,
    })),
    ...walkInPayables.map((w) => ({
      key: `walkin-${w.id}`,
      name: w.partyName || "(unnamed)",
      outstanding: w.outstanding,
      href: "/payables",
      walkIn: true,
    })),
  ].sort((a, b) => b.outstanding - a.outstanding);

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
          hint={hintWithWalkIns(
            payables.length,
            walkInPayables.length,
            "supplier",
          )}
        />
      </div>

      <TopThreeList
        title="Top suppliers you owe"
        rows={supplierTop}
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

  const [castingAgg, platingAgg, vendorCount, payables, walkInPayables] =
    await Promise.all([
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
      listWalkInPayables("casting_plating"),
    ]);

  const walkInTotal = walkInPayables.reduce((s, w) => s + w.outstanding, 0);
  const totalPayables =
    payables.reduce((s, p) => s + p.totalOutstanding, 0) + walkInTotal;

  const vendorTop: TopThreeRow[] = [
    ...payables.map((p) => ({
      key: `party-${p.party.id}`,
      name: p.party.name,
      outstanding: p.totalOutstanding,
      href: `/payables/${p.party.id}`,
    })),
    ...walkInPayables.map((w) => ({
      key: `walkin-${w.id}`,
      name: w.partyName || "(unnamed)",
      outstanding: w.outstanding,
      href: "/payables",
      walkIn: true,
    })),
  ].sort((a, b) => b.outstanding - a.outstanding);

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
          hint={hintWithWalkIns(
            payables.length,
            walkInPayables.length,
            "vendor",
          )}
        />
        <Card label="Vendors" value={String(vendorCount)} />
      </div>

      <TopThreeList
        title="Top vendors you owe"
        rows={vendorTop}
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
