"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload, Eye, Trash2 } from "lucide-react";

import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
} from "@/app/(app)/bills/schema";
import {
  prepareUpload,
  confirmUpload,
  softDeleteBill,
  getBillViewUrl,
} from "@/app/(app)/bills/actions";

type BillRow = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: "PENDING" | "READY" | "FAILED";
  uploadedAt: string;
};

type UploadState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | { kind: "uploading"; percent: number }
  | { kind: "confirming" }
  | { kind: "error"; message: string };

function isAllowedMime(t: string): t is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(t);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function BillsTestClient({ bills }: { bills: BillRow[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setState({ kind: "idle" });
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setSelected(null);
      return;
    }
    if (!isAllowedMime(file.type)) {
      setSelected(null);
      setState({
        kind: "error",
        message: `Unsupported file type "${file.type || "unknown"}". Allowed: PDF, JPEG, PNG, WebP.`,
      });
      // Clear input so the user can pick again
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSelected(null);
      setState({
        kind: "error",
        message: `File too large (${formatBytes(file.size)}). Max ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelected(file);
  };

  const onUpload = async () => {
    if (!selected) return;

    // Step 1: prepare
    setState({ kind: "preparing" });
    const prep = await prepareUpload({
      originalFilename: selected.name,
      mimeType: selected.type as AllowedMimeType,
      sizeBytes: selected.size,
      attachedToType: null,
      attachedToId: null,
    });

    if (!prep.ok) {
      const first = Object.values(prep.errors).flat().find(Boolean);
      setState({ kind: "error", message: first ?? "Upload preparation failed." });
      return;
    }

    // Step 2: PUT to R2 directly. Use XHR so we can report progress.
    setState({ kind: "uploading", percent: 0 });
    try {
      await putToR2(prep.presignedUrl, selected, (p) =>
        setState({ kind: "uploading", percent: p }),
      );
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload to R2 failed.",
      });
      return;
    }

    // Step 3: confirm
    setState({ kind: "confirming" });
    const conf = await confirmUpload({ billId: prep.billId });
    if (!conf.ok) {
      const first = Object.values(conf.errors).flat().find(Boolean);
      setState({ kind: "error", message: first ?? "Confirmation failed." });
      return;
    }

    setState({ kind: "idle" });
    setSelected(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    router.refresh();
  };

  const onView = async (billId: string) => {
    const res = await getBillViewUrl(billId);
    if (!res.ok) {
      setState({ kind: "error", message: res.error });
      return;
    }
    window.open(res.url, "_blank", "noopener,noreferrer");
  };

  const onDelete = async (billId: string) => {
    if (!confirm("Delete this bill? This cannot be undone.")) return;
    const res = await softDeleteBill({ billId });
    if (!res.ok) {
      const first = Object.values(res.errors).flat().find(Boolean);
      setState({ kind: "error", message: first ?? "Delete failed." });
      return;
    }
    router.refresh();
  };

  const busy =
    state.kind === "preparing" ||
    state.kind === "uploading" ||
    state.kind === "confirming";

  return (
    <div className="space-y-10">
      <section className="bg-surface-container border border-outline-variant p-6 space-y-4">
        <h2 className="font-display text-sm uppercase tracking-wider text-on-surface-variant">
          Upload a bill
        </h2>

        <div className="flex items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            onChange={onPickFile}
            disabled={busy}
            className="text-sm text-on-surface file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-surface-container-high file:text-on-surface file:font-display file:uppercase file:tracking-wider file:text-xs hover:file:bg-surface-container-highest"
          />
          <button
            type="button"
            onClick={onUpload}
            disabled={!selected || busy}
            className="min-w-[140px] h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>{state.kind === "preparing" ? "Preparing" : state.kind === "uploading" ? `${state.percent}%` : "Confirming"}</span>
              </>
            ) : (
              <>
                <Upload className="size-4" />
                <span>Upload</span>
              </>
            )}
          </button>
        </div>

        {selected && state.kind === "idle" && (
          <p className="text-xs text-on-surface-variant">
            {selected.name} · {formatBytes(selected.size)} · {selected.type}
          </p>
        )}

        {state.kind === "error" && (
          <div className="border-l-2 border-error bg-surface-container-high text-error px-4 py-3 text-sm">
            {state.message}
          </div>
        )}

        <p className="text-xs text-on-surface-variant">
          Max {formatBytes(MAX_FILE_SIZE_BYTES)}. PDF, JPEG, PNG, WebP only.
        </p>
      </section>

      <section>
        <h2 className="font-display text-sm uppercase tracking-wider text-on-surface-variant mb-4">
          Uploaded bills ({bills.length})
        </h2>
        {bills.length === 0 ? (
          <div className="bg-surface-container-low border border-outline-variant p-8 text-center text-on-surface-variant">
            No bills yet. Upload a file above to get started.
          </div>
        ) : (
          <div className="border border-outline-variant">
            <table className="w-full text-sm">
              <thead className="bg-surface-container-high">
                <tr>
                  <Th>Filename</Th>
                  <Th>Type</Th>
                  <Th>Size</Th>
                  <Th>Status</Th>
                  <Th>Uploaded</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b, i) => (
                  <tr
                    key={b.id}
                    className={i % 2 === 0 ? "bg-surface-container-low" : "bg-surface-container"}
                  >
                    <Td className="font-mono text-xs">{b.originalFilename}</Td>
                    <Td className="font-mono text-xs">{b.mimeType}</Td>
                    <Td className="font-mono text-xs">{formatBytes(b.sizeBytes)}</Td>
                    <Td>
                      <StatusChip status={b.status} />
                    </Td>
                    <Td className="font-mono text-xs text-on-surface-variant">
                      {new Date(b.uploadedAt).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onView(b.id)}
                          disabled={b.status !== "READY"}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-on-surface hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          aria-label={`View ${b.originalFilename}`}
                        >
                          <Eye className="size-3" />
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(b.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-error hover:bg-surface-container-high transition-colors"
                          aria-label={`Delete ${b.originalFilename}`}
                        >
                          <Trash2 className="size-3" />
                          Delete
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left font-display text-xs uppercase tracking-wider text-on-surface-variant px-4 py-3 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

const STATUS_DOT: Record<BillRow["status"], string> = {
  PENDING: "bg-secondary",
  READY: "bg-primary",
  FAILED: "bg-error",
};

function StatusChip({ status }: { status: BillRow["status"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-display uppercase tracking-wider bg-surface-container border border-outline-variant text-on-surface whitespace-nowrap">
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {status.toLowerCase()}
    </span>
  );
}

// PUT the file to R2 via XHR so we get upload-progress events. fetch() does
// not expose progress for the request body, only the response body.
function putToR2(
  presignedUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl, true);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 PUT failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}
