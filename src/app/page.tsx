export default function Home() {
  return (
    <main className="min-h-screen p-10 bg-surface text-on-surface">
      <h1 className="font-display text-[32px] font-semibold tracking-tight mb-2">
        Shree Creation
      </h1>
      <p className="text-on-surface-variant text-sm tracking-wider uppercase mb-8">
        Jewelry Manufacturing Management
      </p>

      {/* Color swatches */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-surface-container p-6 border border-outline-variant">
          <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-2">
            Surface container
          </p>
          <p className="text-sm">#171f33</p>
        </div>
        <div className="bg-primary text-on-primary p-6">
          <p className="text-xs uppercase tracking-wider mb-2">Primary</p>
          <p className="text-sm">#f2ca50</p>
        </div>
        <div className="bg-secondary-container text-on-secondary-container p-6">
          <p className="text-xs uppercase tracking-wider mb-2">
            Secondary container
          </p>
          <p className="text-sm">#0566d9</p>
        </div>
      </div>

      {/* Typography sample */}
      <div className="space-y-2 p-6 border border-outline-variant bg-surface-container-low">
        <p className="font-display text-2xl font-semibold">
          Headline medium — Geist 24px/600
        </p>
        <p className="font-display text-lg font-semibold">
          Headline small — Geist 18px/600
        </p>
        <p className="text-base">Body large — Inter 16px/400</p>
        <p className="text-sm text-on-surface-variant">
          Body medium — Inter 14px/400
        </p>
        <p className="font-display text-xs uppercase tracking-wider">
          Label — Geist 12px/500
        </p>
      </div>
    </main>
  );
}
