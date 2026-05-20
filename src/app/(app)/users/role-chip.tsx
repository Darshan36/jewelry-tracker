// Phase 16 — small visual chip rendering a User's role.
// Mirrors the sidebar's `ROLE_DOT` palette so the same role reads as
// the same colour across the app.

import type { Role } from "@/generated/prisma";

const LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  PURCHASE_DEPT: "Purchases",
  LABOUR_MGMT: "Labour",
  CASTING_PLATING_MGMT: "Casting/Plating",
};

const DOT: Record<Role, string> = {
  ADMIN: "bg-primary",
  PURCHASE_DEPT: "bg-secondary-container",
  LABOUR_MGMT: "bg-tertiary",
  CASTING_PLATING_MGMT: "bg-secondary",
};

export function RoleChip({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-surface-container border border-outline-variant text-on-surface whitespace-nowrap">
      <span className={`size-1.5 rounded-full ${DOT[role]}`} aria-hidden />
      {LABEL[role]}
    </span>
  );
}

export function StatusChip({ active }: { active: boolean }) {
  // Phase 11.5 chip convention: tinted background + matching dot + tinted
  // border. Two states only — active/inactive — so direct hex literals
  // are fine (matches transaction-status-chip.tsx precedent).
  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-[#5e8c4f]/10 border border-[#5e8c4f]/30 text-[#5e8c4f] whitespace-nowrap">
        <span className="size-1.5 rounded-full bg-[#5e8c4f]" aria-hidden />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-[#8a8e9a]/10 border border-[#8a8e9a]/30 text-on-surface-variant whitespace-nowrap">
      <span className="size-1.5 rounded-full bg-[#8a8e9a]" aria-hidden />
      Inactive
    </span>
  );
}
