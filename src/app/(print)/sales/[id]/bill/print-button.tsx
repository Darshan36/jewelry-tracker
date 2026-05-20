"use client";

// Phase 20 — print trigger button for the bill page.
//
// Lives in its own file so the parent page can stay a server component
// (which is required to await prisma queries). The button is the only
// interactive element on the bill — clicking calls window.print() which
// opens the browser's print dialog. Users can pick paper or save-as-PDF
// from there.
//
// Hidden in the printed output via the `print:hidden` Tailwind variant
// so the page is a clean invoice when actually printed.

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex items-center gap-2 h-10 px-4 border border-black text-sm font-semibold hover:bg-black hover:text-white transition-colors"
      data-testid="print-button"
    >
      <Printer className="size-4" />
      Print
    </button>
  );
}
