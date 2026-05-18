// Transaction status chip — shared between Sales and Purchases.
//
// Phase 11.5 — tinted-pill scheme on light theme:
//   - pending     → neutral slate (waiting)
//   - partial     → muted amber (warning, in-progress)
//   - completed   → muted green (positive, done)
//   - refund_due  → slate-blue (info — money still in motion)
//
// Each chip uses a tinted background + matching dot + matching text,
// with a tinted border at low opacity. Hex values are pinned here (not
// derived from semantic tokens) so the chip's tinted-pill semantics
// stay legible regardless of future surface remaps.

import type { TransactionStatus } from "@/lib/transaction-status";

type Props = { status: TransactionStatus };

const STATUS_META: Record<
  TransactionStatus,
  { label: string; className: string; dot: string }
> = {
  pending: {
    label: "Pending",
    className:
      "bg-[#8a8e9a]/10 text-[#525868] border-[#8a8e9a]/30",
    dot: "bg-[#8a8e9a]",
  },
  partial: {
    label: "Partial",
    className:
      "bg-[#c9844a]/10 text-[#c9844a] border-[#c9844a]/30",
    dot: "bg-[#c9844a]",
  },
  completed: {
    label: "Completed",
    className:
      "bg-[#5e8c4f]/10 text-[#5e8c4f] border-[#5e8c4f]/30",
    dot: "bg-[#5e8c4f]",
  },
  refund_due: {
    label: "Refund due",
    className:
      "bg-[#5a7ba6]/10 text-[#5a7ba6] border-[#5a7ba6]/30",
    dot: "bg-[#5a7ba6]",
  },
};

export function TransactionStatusChip({ status }: Props) {
  const { label, className, dot } = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider border ${className}`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
