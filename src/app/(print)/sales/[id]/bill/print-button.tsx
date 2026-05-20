"use client";

// Phase 20 polish — bill toolbar with Print + Save-as-PDF actions.
//
// Both buttons call `window.print()` — the browser's native print
// dialog offers "Save as PDF" as a destination, so the same flow
// handles both paper and PDF output. Two visible buttons set the
// user's intent expectation:
//   - "Print"        → pick a printer in the dialog
//   - "Save as PDF"  → pick "Save as PDF" in the destination dropdown
//
// Why not generate the PDF client-side with a library (jspdf etc.)?
// See KNOWN_GAPS — server-generated PDFs are deferred because the
// current workflow (admin hands the customer a paper or PDF copy)
// is well-served by the browser's native dialog. Adding 100–200 KB
// of PDF-rendering JS for a 1-click-difference UX isn't worth it.
//
// Hidden in the printed output via the `print:hidden` Tailwind
// variant so the toolbar doesn't appear on paper/PDF.

import { Download, Printer } from "lucide-react";

export function BillToolbar() {
  const triggerPrint = () => window.print();
  return (
    <div className="print:hidden flex items-center justify-end gap-2 mb-8 pb-4 border-b border-black/20">
      <button
        type="button"
        onClick={triggerPrint}
        className="inline-flex items-center gap-2 h-10 px-4 border border-black text-sm font-semibold hover:bg-black hover:text-white transition-colors"
        data-testid="print-button"
      >
        <Printer className="size-4" />
        Print
      </button>
      <button
        type="button"
        onClick={triggerPrint}
        title="Opens the print dialog. Choose 'Save as PDF' as the destination."
        className="inline-flex items-center gap-2 h-10 px-4 border border-black text-sm font-semibold hover:bg-black hover:text-white transition-colors"
        data-testid="download-pdf-button"
      >
        <Download className="size-4" />
        Save as PDF
      </button>
    </div>
  );
}

// Preserved for backward compat with any test/import that references
// the old name. Deprecated; use BillToolbar.
export const PrintButton = BillToolbar;
