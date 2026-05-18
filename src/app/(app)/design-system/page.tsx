// Design-system swatch reference. Not linked from the sidebar; reach via
// /design-system if you need to eyeball tokens. Survives from the Phase 1
// design verification page (originally at /). Updated Phase 11.5 to reflect
// the techno-artisanal light palette.

export default function DesignSystemPage() {
  return (
    <div className="p-10">
      <header className="mb-8">
        <h1 className="text-[32px] font-semibold tracking-tight mb-1">
          Design system
        </h1>
        <p className="text-on-surface-variant text-xs uppercase tracking-widest">
          Token swatches and typography sample
        </p>
      </header>

      {/* Color swatches */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-surface-container p-6 border border-outline-variant">
          <p className="text-xs uppercase tracking-wider text-on-surface-variant mb-2">
            Surface container
          </p>
          <p className="text-sm">#ffffff</p>
        </div>
        <div className="bg-primary text-on-primary p-6">
          <p className="text-xs uppercase tracking-wider mb-2">Primary</p>
          <p className="text-sm">#c9a14a</p>
        </div>
        <div className="bg-secondary text-on-secondary p-6">
          <p className="text-xs uppercase tracking-wider mb-2">Secondary</p>
          <p className="text-sm">#5a7ba6</p>
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
    </div>
  );
}
