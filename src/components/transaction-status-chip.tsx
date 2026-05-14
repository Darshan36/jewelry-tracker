// Transaction status chip — shared between Sales and Purchases.
//
// Small uppercase label with a leading colored dot:
//   - pending     → amber (primary)
//   - partial     → blue (secondary)
//   - completed   → muted blue (secondary-container) — pending green token
//   - refund_due  → red dot + red label text (text-error) — distinct from
//     the three blue-ish states so the "money still in motion" state is
//     unmistakable at a glance.

import type { TransactionStatus } from "@/lib/transaction-status";

type Props = { status: TransactionStatus };

const STATUS_META: Record<
  TransactionStatus,
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

export function TransactionStatusChip({ status }: Props) {
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
