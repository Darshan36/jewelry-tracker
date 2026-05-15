// Inline chip showing an Employee's type (FIXED / LABOUR).
//
// Shape mirrors the sidebar's role chip: small uppercase label with a
// leading colored dot. FIXED → gold (primary), LABOUR → electric blue
// (secondary).

import type { EmployeeType } from "@/generated/prisma";

type Props = {
  type: EmployeeType;
};

export function TypeChip({ type }: Props) {
  const isFixed = type === "FIXED";
  const dotColor = isFixed ? "bg-primary" : "bg-secondary";
  const label = isFixed ? "Fixed" : "Labour";
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-surface-container border border-outline-variant text-on-surface-variant">
      <span className={`size-1.5 rounded-full ${dotColor}`} aria-hidden />
      {label}
    </span>
  );
}
