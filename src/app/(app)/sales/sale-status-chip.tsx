// Sale status chip — small uppercase label with a leading colored dot.
// Shared between sales-table (column cell) and sale-detail-modal (title chip).
//
// Phase 3.1 sales are always 'pending' since payments and returns don't exist
// yet, but the component handles all four statuses up front so Phase 3.2/3.3
// don't need to revisit it.

import type { SaleStatus } from "@/lib/sale-status";

type Props = { status: SaleStatus };

const STATUS_META: Record<
  SaleStatus,
  { label: string; dot: string }
> = {
  pending: { label: "Pending", dot: "bg-primary" },
  partial: { label: "Partial", dot: "bg-secondary" },
  completed: { label: "Completed", dot: "bg-secondary-container" },
  refund_due: { label: "Refund due", dot: "bg-error" },
};

export function SaleStatusChip({ status }: Props) {
  const { label, dot } = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-surface-container border border-outline-variant text-on-surface-variant">
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
