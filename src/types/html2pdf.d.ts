// Phase 20 polish — TS shim for `html2pdf.js` (no bundled types).
//
// Covers only the methods we actually use in BillToolbar's download
// handler: `().from(el).set(opts).save(filename)`. Extend if more of
// the API is needed later.

declare module "html2pdf.js" {
  interface Html2PdfOpts {
    margin?: number | number[];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: {
      scale?: number;
      useCORS?: boolean;
      backgroundColor?: string | null;
      logging?: boolean;
    };
    jsPDF?: {
      unit?: "pt" | "mm" | "cm" | "in";
      format?: string | number[];
      orientation?: "portrait" | "landscape";
    };
    pagebreak?: { mode?: string | string[] };
  }

  interface Html2PdfWorker {
    from(element: HTMLElement | string): Html2PdfWorker;
    set(opts: Html2PdfOpts): Html2PdfWorker;
    save(filename?: string): Promise<void>;
    output(type?: string): Promise<unknown>;
    toPdf(): Html2PdfWorker;
  }

  function html2pdf(): Html2PdfWorker;
  export default html2pdf;
}
