// Sale status chip — small uppercase label with a leading colored dot.
// Shared between sales-table (column cell) and sale-detail-modal (title chip).
//
// Phase 3.3: all four statuses now live.
//   - pending     → amber (primary)
//   - partial     → blue (secondary)
//   - completed   → muted blue (secondary-container) — pending green token
//   - refund_due  → red dot + red label text (text-error) — distinct from
//     the three blue-ish states so the customer-owes-customer state is
//     unmistakable at a glance.

import type { SaleStatus } from "@/lib/sale-status";

type Props = { status: SaleStatus };

const STATUS_META: Record<
  SaleStatus,
  { label: string; dot: string; text: string }
> = {
  pending: {
    label: "Pending",
    dot: "bg-primary",
    text: "text-on-surface-variant",
  },
  partial: {
    label: "Partial",
    dot: "bg-secondary",
    text: "text-on-surface-variant",
  },
  completed: {
    label: "Completed",
    dot: "bg-secondary-container",
    text: "text-on-surface-variant",
  },
  refund_due: {
    label: "Refund due",
    dot: "bg-error",
    text: "text-error",
  },
};

export function SaleStatusChip({ status }: Props) {
  const { label, dot, text } = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-surface-container border border-outline-variant ${text}`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
