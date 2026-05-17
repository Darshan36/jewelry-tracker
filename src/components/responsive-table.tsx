"use client";

// Phase 11 — ResponsiveTable wrapper.
//
// Renders the desktop TanStack Table on md+ and a list of mobile cards
// below md. Uses `useIsMobile` to conditionally render exactly ONE
// branch — keeps jsdom tests on the desktop branch by default (so
// existing `getByText` queries on row data don't double-match), and
// avoids hydration mismatch by defaulting to desktop on SSR.
//
// Trade-off vs CSS-only dual-render: a flash of desktop content on
// initial mobile page-load while React hydrates and the hook fires.
// The flash is brief (one paint cycle) and only visible on mobile, on
// the very first navigation to a page; subsequent client navigations
// don't re-mount the layout.
//
// Usage: each entity's *-table.tsx wraps its existing table body in
// <ResponsiveTable> and provides a `mobileCards` slot — a list of
// JSX nodes, one per row.

import * as React from "react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/use-is-mobile";

type ResponsiveTableProps = {
  /** Desktop table content — usually the <table> + sticky <thead> + <tbody>. */
  desktopTable: React.ReactNode;
  /** Mobile card content — list of cards stacked vertically. */
  mobileCards: React.ReactNode;
  className?: string;
};

export function ResponsiveTable({
  desktopTable,
  mobileCards,
  className,
}: ResponsiveTableProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div
        data-testid="responsive-table-mobile"
        className={cn("space-y-3", className)}
      >
        {mobileCards}
      </div>
    );
  }

  return (
    <div data-testid="responsive-table-desktop" className={className}>
      {desktopTable}
    </div>
  );
}

// ---------- Shared mobile-card primitives ----------

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  clickable?: boolean;
};

export const MobileCard = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, clickable, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="mobile-card"
      className={cn(
        "bg-surface-container-low border border-outline-variant p-4 space-y-3",
        clickable &&
          "cursor-pointer hover:bg-surface-container active:bg-surface-container-high transition-colors",
        className,
      )}
      {...props}
    />
  ),
);
MobileCard.displayName = "MobileCard";

/** Header row inside a card — primary identifier + meta (status chip etc.) */
export function MobileCardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="mobile-card-header"
      className={cn("flex items-start justify-between gap-2", className)}
      {...props}
    />
  );
}

/** Primary identifier line (party name etc.) — bold, truncates. */
export function MobileCardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="mobile-card-title"
      className={cn(
        "text-on-surface text-base font-medium tracking-tight min-w-0 break-words",
        className,
      )}
      {...props}
    />
  );
}

/** Action button row at the bottom of the card. Stops click propagation. */
export function MobileCardActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="mobile-card-actions"
      className={cn(
        "flex flex-wrap items-center gap-2 pt-3 border-t border-outline-variant/40",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.(e);
      }}
      {...props}
    />
  );
}
