"use client";

// Split-button save control for entity form pages. Primary action
// "Save and return" navigates back to the entity list after saving;
// the dropdown chevron exposes "Save and add another" which keeps the
// user on the new-entity page for bulk-entry workflows.
//
// Form pages pass an onSubmit prop that takes the chosen mode. The
// form component's submit handler reads the mode to decide between
// router.push back to /entity vs. reset() + scroll-to-top.

import { ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export type SaveMode = "return" | "another";

type Props = {
  onSave: (mode: SaveMode) => void | Promise<void>;
  disabled?: boolean;
  saving?: boolean;
  /** Override the primary label (default: "Save and return"). */
  primaryLabel?: string;
};

export function SaveDropdown({
  onSave,
  disabled = false,
  saving = false,
  primaryLabel = "Save and return",
}: Props) {
  const [open, setOpen] = useState(false);

  const handlePrimary = () => {
    setOpen(false);
    void onSave("return");
  };
  const handleAnother = () => {
    setOpen(false);
    void onSave("another");
  };

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={handlePrimary}
        disabled={disabled || saving}
        className={cn(
          "min-w-[160px] h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2",
        )}
      >
        {saving ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            <span>Saving…</span>
          </>
        ) : (
          <span>{primaryLabel}</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || saving}
        aria-label="More save options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-10 px-2 bg-primary text-on-primary font-display text-sm hover:bg-primary/80 border-l border-on-primary/30 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
      >
        <ChevronDown className="size-4" />
      </button>

      {open && (
        <>
          {/* Click-outside catcher */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute z-50 right-0 top-full mt-1 min-w-[200px] bg-surface-container-high border border-outline-variant shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleAnother}
              className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              Save and add another
            </button>
          </div>
        </>
      )}
    </div>
  );
}
