"use client";

// Phase 11 — ResponsiveDialog wrapper.
//
// Renders a Dialog on md+ (existing desktop behaviour, centred floating
// panel) and a Sheet on mobile (full-width bottom sheet that takes up
// the screen). Both use the same Radix Dialog primitive under the hood
// — only the positioning and sizing differ — so animations, focus
// trapping, click-outside-to-close, and Escape-to-close all work the
// same on both.
//
// Usage: replace `Dialog` + `DialogContent` in existing detail/action
// modals. The component spreads className onto the inner content so
// callers can still override width/height/padding at desktop sizes.
//
// Behaviour matrix:
//   - md and above: <DialogContent> centred at top:50% left:50%, max-width
//     follows the caller's `desktopClassName` (defaults to max-w-[600px]).
//   - below md: <SheetContent side="bottom"> full-width, max 95vh tall,
//     internal vertical scroll for overflowing content.
//
// The hide/show switch is CSS-only via Tailwind responsive prefixes —
// only ONE of the two trees actually mounts at any viewport, controlled
// by the existing `open` prop. We render both shells gated by class so
// the same `open` controls both; only the visible one matters.
//
// Cleaner alternative considered: useMediaQuery hook + conditional
// render. Rejected: would cause an unmount/remount when the user
// resizes across the breakpoint, and the SSR/CSR initial value would
// mismatch causing hydration flicker. The CSS-gated dual-render avoids
// both problems.

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type ResponsiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
}: ResponsiveDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

type ResponsiveDialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  /** Class names applied at md+ only (desktop centred dialog). */
  desktopClassName?: string;
  /** Class names applied below md (mobile bottom sheet). */
  mobileClassName?: string;
  showCloseButton?: boolean;
};

export const ResponsiveDialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  ResponsiveDialogContentProps
>(
  (
    {
      className,
      desktopClassName,
      mobileClassName,
      children,
      showCloseButton = true,
      ...props
    },
    ref,
  ) => (
    <DialogPrimitive.Portal>
      {/* Single overlay covers both modes. */}
      <DialogPrimitive.Overlay
        data-slot="responsive-dialog-overlay"
        className="fixed inset-0 z-50 bg-black/60 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Content
        ref={ref}
        data-slot="responsive-dialog-content"
        className={cn(
          // Mobile (default — below md): full-width bottom sheet.
          "fixed inset-x-0 bottom-0 z-50 max-h-[95dvh] overflow-y-auto bg-surface-container border-t border-outline-variant text-on-surface outline-none data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          mobileClassName,
          // Desktop (md and above): centred floating dialog. Reset the
          // mobile inset/bottom + apply the standard centred-panel
          // transforms. border-t becomes border (all sides) on desktop.
          "md:inset-x-auto md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-[600px] md:max-h-[90vh] md:border md:data-open:slide-in-from-bottom-0 md:data-closed:slide-out-to-bottom-0 md:data-open:zoom-in-95 md:data-closed:zoom-out-95",
          desktopClassName,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="responsive-dialog-close"
            aria-label="Close"
            className="absolute top-3 right-3 inline-flex items-center justify-center h-11 w-11 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors md:h-8 md:w-8"
          >
            <XIcon className="size-5 md:size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
ResponsiveDialogContent.displayName = "ResponsiveDialogContent";

export const ResponsiveDialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="responsive-dialog-title"
    className={cn(
      "text-lg font-semibold tracking-tight text-on-surface",
      className,
    )}
    {...props}
  />
));
ResponsiveDialogTitle.displayName = "ResponsiveDialogTitle";

export const ResponsiveDialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="responsive-dialog-description"
    className={cn("text-sm text-on-surface-variant", className)}
    {...props}
  />
));
ResponsiveDialogDescription.displayName = "ResponsiveDialogDescription";

export function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="responsive-dialog-header"
      className={cn("flex flex-col gap-1.5 mb-6 pr-12", className)}
      {...props}
    />
  );
}

export function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="responsive-dialog-footer"
      className={cn(
        "flex flex-col-reverse md:flex-row gap-2 md:justify-end mt-6 pt-4 border-t border-outline-variant",
        className,
      )}
      {...props}
    />
  );
}
