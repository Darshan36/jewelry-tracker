"use client";

// Browser-side file preview for bill uploads. Images render via <img>,
// PDFs via <embed>. Uses URL.createObjectURL so no server round-trip;
// the preview is purely local until the user clicks Upload.
//
// Cleanup via URL.revokeObjectURL on unmount or file change — keeps the
// blob URL pool from leaking across many uploads.

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

type Props = {
  file: File;
  className?: string;
};

export function BillPreview({ file, className = "" }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!objectUrl) return null;

  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";

  return (
    <div
      className={`border border-outline-variant bg-surface-container-low ${className}`}
      data-testid="bill-preview"
    >
      {isImage && (
        <img
          src={objectUrl}
          alt={`Preview of ${file.name}`}
          className="w-full max-h-[400px] object-contain bg-black"
        />
      )}
      {isPdf && (
        <embed
          src={objectUrl}
          type="application/pdf"
          className="w-full h-[400px]"
          aria-label={`Preview of ${file.name}`}
        />
      )}
      {!isImage && !isPdf && (
        <div className="p-6 flex items-center gap-3 text-on-surface-variant">
          <FileText className="size-6 shrink-0" />
          <span className="text-sm">No preview available for this file type.</span>
        </div>
      )}
    </div>
  );
}
