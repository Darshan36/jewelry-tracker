import { auth } from "@/lib/auth";

// Dashboard placeholder. Real summary cards land in Phase 7
// (receivables / payables / today's flow + monthly line graphs).
// For Phase 1.6 it exists to give the (app) layout a child route.

export default async function DashboardPage() {
  const session = await auth();

  return (
    <div className="p-10">
      <header className="mb-10 pb-6 border-b border-outline-variant">
        <h1 className="text-3xl font-semibold tracking-tight mb-1">
          Dashboard
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Welcome back, {session?.user?.name}
        </p>
      </header>

      <div className="grid grid-cols-4 gap-3">
        {["Receivables", "Payables", "Today's Sales", "Today's Purchases"].map(
          (label) => (
            <div
              key={label}
              className="p-6 bg-surface-container border border-outline-variant"
            >
              <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-2">
                {label}
              </p>
              <p className="font-display text-2xl font-semibold">—</p>
              <p className="text-xs text-on-surface-variant mt-1">
                Coming in Phase 7
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
