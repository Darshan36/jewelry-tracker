// Party role chips (Phase 17b — deferred from Phase 17a).
//
// Renders one chip per active role flag on a Party. Multi-role parties
// show multiple chips; a single-role party shows one. Used in master-
// data detail modals (Customer / Supplier / Vendor) to make a Party's
// multi-role membership visible at a glance.
//
// Visual: matches the techno-artisanal LIGHT palette (Phase 11.5) —
// sharp corners, tinted backgrounds with dot indicators per role.
// Distinct from the four transaction-status colors so role-chip and
// status-chip don't visually clash on the same modal.

type PartyForChips = {
  isCustomer: boolean;
  isSupplier: boolean;
  isCastingVendor: boolean;
  isPlatingVendor: boolean;
};

type ChipSpec = {
  key: keyof PartyForChips;
  label: string;
  // Tailwind utility classes for the dot + tinted background. Stays in
  //-the-known-palette family rather than introducing new hex values.
  dot: string;
  bg: string;
  text: string;
  border: string;
};

const ROLE_CHIPS: ChipSpec[] = [
  {
    key: "isCustomer",
    label: "Customer",
    dot: "bg-primary",
    bg: "bg-primary/10",
    text: "text-primary",
    border: "border-primary/30",
  },
  {
    key: "isSupplier",
    label: "Supplier",
    dot: "bg-secondary",
    bg: "bg-secondary/10",
    text: "text-secondary",
    border: "border-secondary/30",
  },
  {
    key: "isCastingVendor",
    label: "Casting Vendor",
    dot: "bg-tertiary",
    bg: "bg-tertiary/10",
    text: "text-tertiary",
    border: "border-tertiary/30",
  },
  {
    key: "isPlatingVendor",
    label: "Plating Vendor",
    dot: "bg-tertiary",
    bg: "bg-tertiary/10",
    text: "text-tertiary",
    border: "border-tertiary/30",
  },
];

export function PartyRoleChips({
  party,
  className,
}: {
  party: PartyForChips;
  className?: string;
}) {
  const active = ROLE_CHIPS.filter((c) => party[c.key]);
  if (active.length === 0) return null;

  return (
    <div
      data-testid="party-role-chips"
      className={`flex flex-wrap gap-1.5 ${className ?? ""}`}
    >
      {active.map((c) => (
        <span
          key={c.key}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider border ${c.bg} ${c.text} ${c.border}`}
        >
          <span
            className={`size-1.5 rounded-full ${c.dot}`}
            aria-hidden
          />
          {c.label}
        </span>
      ))}
    </div>
  );
}
