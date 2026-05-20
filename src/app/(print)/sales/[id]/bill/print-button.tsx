"use client";

// Phase 20 polish — bill toolbar with one-click PDF download.
//
// Two actions:
//   - Print           → window.print()  (browser dialog → paper)
//   - Save as PDF     → html2pdf().from(targetElement).save(filename)
//                       generates a real PDF and triggers a true file
//                       download. No dialog. The DOM is rasterized via
//                       html2canvas under the hood, so the visual
//                       layout matches what's on screen exactly.
//
// The "Save as PDF" path captures only the element matching
// `targetId` (the bill body — shop header + items + totals + notes +
// footer). The toolbar itself is excluded so the downloaded PDF
// doesn't show the buttons.
//
// Trade-offs vs. server-generated PDF (puppeteer/chromium): client
// generation is simpler (no infra), produces a raster PDF (text is
// not searchable/selectable but the visual fidelity is identical),
// and adds ~150 KB to the bill route's bundle. Server-side
// generation remains the upgrade path if searchable text or
// programmatic batch-export ever matters — see KNOWN_GAPS.

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import html2pdf from "html2pdf.js";

type Props = {
  /** DOM id of the element to capture into the PDF. */
  targetId: string;
  /** Filename for the downloaded PDF (without extension; `.pdf` appended). */
  filename: string;
};

export function BillToolbar({ targetId, filename }: Props) {
  const [generating, setGenerating] = useState(false);

  const triggerPrint = () => window.print();

  const triggerDownload = async () => {
    if (generating) return;
    const el = document.getElementById(targetId);
    if (!el) {
      // Defensive — should never happen if the page wires targetId
      // to the existing element id. Falling back to window.print so
      // the user always has SOME path out.
      window.print();
      return;
    }
    setGenerating(true);
    try {
      await html2pdf()
        .from(el)
        .set({
          // Margins match the @page rule in (print)/layout.tsx so
          // print and PDF outputs visually align.
          margin: [14, 14, 14, 14],
          filename: `${filename}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            logging: false,
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .save();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="print:hidden flex items-center justify-end gap-2 mb-8 pb-4 border-b border-black/20">
      <button
        type="button"
        onClick={triggerPrint}
        disabled={generating}
        className="inline-flex items-center gap-2 h-10 px-4 border border-black text-sm font-semibold hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        data-testid="print-button"
      >
        <Printer className="size-4" />
        Print
      </button>
      <button
        type="button"
        onClick={triggerDownload}
        disabled={generating}
        title="Downloads a PDF copy of this bill."
        className="inline-flex items-center gap-2 h-10 px-4 border border-black text-sm font-semibold hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        data-testid="download-pdf-button"
      >
        {generating ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Download className="size-4" />
            Save as PDF
          </>
        )}
      </button>
    </div>
  );
}

// Preserved for backward compat with any test/import that references
// the old name. Deprecated; use BillToolbar.
export const PrintButton = BillToolbar;
