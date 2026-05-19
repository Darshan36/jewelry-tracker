import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/format";

// Role-aware dashboard. Each branch fetches only the data its cards need.
// Full Recharts dashboards are deferred to Phase 7 — these cards are minimal
// landing-page summaries so every role has somewhere to land after sign-in.

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

// ---------- per-role dashboards ----------

async function AdminDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [customerCount, supplierCount, salesAgg, purchasesAgg, billsReady] =
    await Promise.all([
      prisma.customer.count({ where: { deletedAt: null } }),
      prisma.supplier.count({ where: { deletedAt: null } }),
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
    ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Admin overview" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
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
          label="Bills stored"
          value={String(billsReady)}
          hint="Active receipts in R2"
        />
      </div>
    </div>
  );
}

async function PurchaseDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [supplierCount, purchasesAgg, owedToSuppliers] = await Promise.all([
    prisma.supplier.count({ where: { deletedAt: null } }),
    prisma.purchase.aggregate({
      where: { deletedAt: null, date: monthRange },
      _count: { _all: true },
      _sum: { total: true },
    }),
    sumOwedToSuppliers(),
  ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Purchases overview" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card label="Suppliers" value={String(supplierCount)} />
        <Card
          label="Purchases (this month)"
          value={formatCurrency(Number(purchasesAgg._sum.total ?? 0n))}
          hint={`${purchasesAgg._count._all} transactions`}
        />
        <Card
          label="Owed to suppliers"
          value={formatCurrency(Number(owedToSuppliers))}
          hint="Across all non-completed purchases"
        />
      </div>
    </div>
  );
}

async function LabourDashboard({ name }: { name: string }) {
  const [fixed, labour, salaryAgg] = await Promise.all([
    prisma.employee.count({ where: { deletedAt: null, type: "FIXED" } }),
    prisma.employee.count({ where: { deletedAt: null, type: "LABOUR" } }),
    prisma.employee.aggregate({
      where: { deletedAt: null, type: "FIXED" },
      _sum: { monthlySalary: true },
    }),
  ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Employees overview" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
    </div>
  );
}

async function CastingPlatingDashboard({ name }: { name: string }) {
  const monthRange = currentMonthRange();

  const [castingAgg, platingAgg, vendorCount, owed] = await Promise.all([
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
    prisma.castingPlatingVendor.count({ where: { deletedAt: null } }),
    sumOwedToCastingPlatingVendors(),
  ]);

  return (
    <div className="p-10">
      <PageHeader name={name} subtitle="Casting & Plating" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
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
          label="Total owed"
          value={formatCurrency(Number(owed))}
          hint="Across all open casting/plating entries"
        />
        <Card label="Vendors" value={String(vendorCount)} />
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

async function sumOwedToCastingPlatingVendors(): Promise<bigint> {
  const [casting, plating] = await Promise.all([
    prisma.castingEntry.findMany({
      where: { deletedAt: null },
      include: { payments: { where: { deletedAt: null } } },
    }),
    prisma.platingEntry.findMany({
      where: { deletedAt: null },
      include: { payments: { where: { deletedAt: null } } },
    }),
  ]);

  let owed = 0n;
  for (const e of casting) {
    const netPaid = e.payments.reduce(
      (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
      0n,
    );
    const remaining = e.total - netPaid;
    if (remaining > 0n) owed += remaining;
  }
  for (const e of plating) {
    const netPaid = e.payments.reduce(
      (sum, p) => (p.type === "PAYMENT" ? sum + p.amount : sum - p.amount),
      0n,
    );
    const remaining = e.total - netPaid;
    if (remaining > 0n) owed += remaining;
  }
  return owed;
}

async function sumOwedToSuppliers(): Promise<bigint> {
  const purchases = await prisma.purchase.findMany({
    where: { deletedAt: null },
    include: {
      payments: { where: { deletedAt: null } },
      returns: { where: { deletedAt: null } },
    },
  });

  let owed = 0n;
  for (const p of purchases) {
    const netPaid = p.payments.reduce(
      (sum, pay) => (pay.type === "PAYMENT" ? sum + pay.amount : sum - pay.amount),
      0n,
    );
    const returnTotal = p.returns.reduce((sum, r) => sum + r.refundAmount, 0n);
    const effectiveTotal = p.total - returnTotal;
    const remaining = effectiveTotal - netPaid;
    if (remaining > 0n) owed += remaining;
  }
  return owed;
}

