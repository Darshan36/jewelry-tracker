"use client";

// Minimal Tabs primitive (Phase 19). Built on Radix Tabs.
// Design tokens follow the project's "techno-artisanal" rules:
// sharp 0px corners, 1px border-bottom on the trigger row,
// inactive triggers muted, active trigger primary + bottom-border.

import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    data-slot="tabs-list"
    className={cn(
      "flex items-stretch gap-0 border-b border-outline-variant overflow-x-auto",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    data-slot="tabs-trigger"
    className={cn(
      // Min-h-11 keeps the trigger tappable on mobile (44px touch target).
      "inline-flex items-center justify-center min-h-11 px-4 py-2 text-sm font-display uppercase tracking-wider text-on-surface-variant",
      "border-b-2 border-transparent -mb-px",
      "hover:text-on-surface hover:bg-surface-container/50 transition-colors",
      "data-[state=active]:text-on-surface data-[state=active]:border-primary",
      "focus-visible:outline-none focus-visible:bg-surface-container",
      "disabled:opacity-50 disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    data-slot="tabs-content"
    className={cn("focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
