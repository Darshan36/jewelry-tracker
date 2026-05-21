"use client";

// Phase 20 polish — bill toolbar with one-click PDF download.
//
// Two actions:
//   - Print           → window.print()  (browser dialog → paper)
//   - Save as PDF     → html2canvas-pro rasterizes the bill body to
//                       a canvas, jsPDF wraps it as an A4 PDF and
//                       triggers a true file download. No dialog.
//                       The visual layout matches what's on screen.
//
// We use html2canvas-pro (NOT plain html2canvas) because Tailwind v4
// emits `color-mix(in oklab, …)` in computed styles — both directly
// (e.g. the universal `* { outline-color: color-mix(in oklab, …) }`
// rule in globals.css) and indirectly (any `color/opacity` slash
// class). The original html2canvas v1.x parses computed colors
// manually and throws "Attempting to parse an unsupported color
// function 'oklab'" the moment it walks one of those values.
// html2canvas-pro adds oklab/oklch parsing, so the entire class of
// "modern color function" failures is gone.
//
// jsPDF is invoked directly rather than via the html2pdf.js wrapper
// because that wrapper bundles a fixed (broken) html2canvas v1.x
// internally — we can't swap it out.
//
// The "Save as PDF" path captures only the element matching
// `targetId` (the bill body — shop header + items + totals + notes +
// footer). The toolbar itself is excluded so the downloaded PDF
// doesn't show the buttons.
//
// Trade-offs vs. server-generated PDF (puppeteer/chromium): client
// generation is simpler (no infra), produces a raster PDF (text is
// not searchable/selectable but the visual fidelity is identical).
// Server-side generation remains the upgrade path if searchable
// text or programmatic batch-export ever matters — see KNOWN_GAPS.

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";

// html2canvas-pro and jspdf are imported lazily inside the click
// handler so they only load in the browser. Both are heavy bundles
// (~200 KB combined) and there is no reason to ship them on the
// initial route payload.

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
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });

      // A4 portrait = 210mm × 297mm. Margins match the @page rule
      // in (print)/layout.tsx (14mm all sides) so print and PDF
      // outputs visually align.
      const pdf = new jsPDF({
        unit: "mm",
        format: "a4",
        orientation: "portrait",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2;
      const contentHeight = pageHeight - margin * 2;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;
      const imgData = canvas.toDataURL("image/jpeg", 0.98);

      if (imgHeight <= contentHeight) {
        // Single page — common case for short receipts.
        pdf.addImage(
          imgData,
          "JPEG",
          margin,
          margin,
          contentWidth,
          imgHeight,
        );
      } else {
        // Multi-page — draw the same full-height image but offset
        // upward each page; jsPDF clips to the page bounds so each
        // page renders the correct vertical slice.
        let heightLeft = imgHeight;
        let yPos = margin;
        pdf.addImage(
          imgData,
          "JPEG",
          margin,
          yPos,
          contentWidth,
          imgHeight,
        );
        heightLeft -= contentHeight;
        while (heightLeft > 0) {
          yPos = margin - (imgHeight - heightLeft);
          pdf.addPage();
          pdf.addImage(
            imgData,
            "JPEG",
            margin,
            yPos,
            contentWidth,
            imgHeight,
          );
          heightLeft -= contentHeight;
        }
      }

      pdf.save(`${filename}.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="print:hidden flex items-center justify-end gap-2 mb-8 pb-4 border-b border-[#00000033]">
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
