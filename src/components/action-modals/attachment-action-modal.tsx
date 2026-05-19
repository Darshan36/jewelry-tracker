"use client";

// Shared inline bill modal — opens from the Actions column on any
// transaction row. Shows the currently-attached bill (filename + view
// link) if one exists; lets the user upload a new bill or replace the
// existing one. Browser-side preview via <AttachmentPreview> renders the
// selected file BEFORE the user clicks Upload — gives them a chance
// to confirm the right file before the R2 round-trip.
//
// Attachment attachment is tracked via the Attachment row's discriminator
// (`attachedToType` + `attachedToId`). For Sales / Purchases the
// discriminator is the only link (no `attachmentId` FK on the entity row);
// for Casting / Plating the entry row also carries a `attachmentId @unique`
// FK that gets set/cleared via attach/detach actions. The modal
// dispatches by entityType to handle both shapes.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Upload } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { AttachmentPreview } from "@/components/attachment-preview";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
  type AttachedToType,
} from "@/app/(app)/attachments/schema";
import {
  confirmUpload,
  getAttachmentForEntity,
  getAttachmentViewUrl,
  prepareUpload,
  softDeleteAttachment,
} from "@/app/(app)/attachments/actions";

export type BillEntityType = "sale" | "purchase" | "casting" | "plating";

// Phase 10.5: the modal is entity-agnostic. The bill-preparation
// chain — `getAttachmentForEntity` (discriminator lookup), `softDeleteAttachment`,
// `prepareUpload`, the browser-side R2 PUT, and `confirmUpload` — is
// the same for every entity type, so those calls stay internal.
//
// For Casting/Plating, the entry row carries a `attachmentId @unique` FK
// that must be CLEARED before the old bill can be soft-deleted (to
// avoid tripping the unique constraint during the replace transient
// state) and SET after the new bill confirms. Sales/Purchases don't
// have that FK — the discriminator-only link is set at prepare time
// and picked up by the next `getAttachmentForEntity` call.
//
// `onAttach` / `onDetach` are the entity-specific FK actions; absent
// for Sales/Purchases, present for Casting/Plating. The modal calls
// them iff they're supplied — no internal `switch (entityType)`.
type Props = {
  entityType: BillEntityType;
  entityId: string;
  open: boolean;
  onClose: () => void;
  /** Sets the entity's `attachmentId` FK after a new bill is confirmed. Casting/Plating only. */
  onAttach?: (entityId: string, attachmentId: string) => Promise<{ ok: boolean }>;
  /** Clears the entity's `attachmentId` FK before a soft-delete + new upload. Casting/Plating only. */
  onDetach?: (entityId: string) => Promise<{ ok: boolean }>;
};

function attachedToTypeFor(entityType: BillEntityType): AttachedToType {
  switch (entityType) {
    case "sale":
      return "SALE";
    case "purchase":
      return "PURCHASE";
    case "casting":
      return "CASTING_ENTRY";
    case "plating":
      return "PLATING_ENTRY";
  }
}

function isAllowedMime(t: string): t is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(t);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

type ExistingBill = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
};

export function AttachmentActionModal({
  entityType,
  entityId,
  open,
  onClose,
  onAttach,
  onDetach,
}: Props) {
  const router = useRouter();
  const [existing, setExisting] = useState<ExistingBill | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "preparing" | "uploading" | "confirming" | "attaching"
  >("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch the existing bill when the modal opens. Re-fetch on every
  // open so stale state from a previous session doesn't leak.
  useEffect(() => {
    if (!open) return;
    setLoadingExisting(true);
    setPickedFile(null);
    setPickerError(null);
    setUploadError(null);
    setUploadStatus("idle");
    void (async () => {
      const res = await getAttachmentForEntity(
        attachedToTypeFor(entityType),
        entityId,
      );
      if (res.ok) setExisting(res.bill);
      setLoadingExisting(false);
    })();
  }, [open, entityType, entityId]);

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPickerError(null);
    setUploadError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setPickedFile(null);
      return;
    }
    if (!isAllowedMime(file.type)) {
      setPickedFile(null);
      setPickerError(
        `Unsupported file type "${file.type || "unknown"}". Allowed: PDF, JPEG, PNG, WebP.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setPickedFile(null);
      setPickerError(
        `File too large (${formatBytes(file.size)}). Max ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setPickedFile(file);
  };

  const handleUpload = async () => {
    if (!pickedFile) return;
    setUploadError(null);

    try {
      // If replacing an existing bill, detach + soft-delete the old one
      // first so the entity's attachmentId FK (Casting/Plating) is cleared
      // before we attempt to attach the new one. For Sales/Purchases
      // there's no FK to clear (no onDetach prop supplied); soft-delete
      // alone is enough — the discriminator lookup picks up the new bill.
      if (existing) {
        if (onDetach) await onDetach(entityId);
        await softDeleteAttachment({ attachmentId: existing.id });
      }

      setUploadStatus("preparing");
      const prep = await prepareUpload({
        originalFilename: pickedFile.name,
        mimeType: pickedFile.type as AllowedMimeType,
        sizeBytes: pickedFile.size,
        attachedToType: attachedToTypeFor(entityType),
        attachedToId: entityId,
      });
      if (!prep.ok) {
        const first = Object.values(prep.errors).flat().find(Boolean);
        throw new Error(first ?? "Bill preparation failed");
      }

      setUploadStatus("uploading");
      await putToR2(prep.presignedUrl, pickedFile);

      setUploadStatus("confirming");
      const conf = await confirmUpload({ attachmentId: prep.attachmentId });
      if (!conf.ok) {
        const first = Object.values(conf.errors).flat().find(Boolean);
        throw new Error(first ?? "Bill confirmation failed");
      }

      // For entities with a attachmentId FK (Casting/Plating — they pass an
      // onAttach prop), set the new bill's id on the entry row.
      // Sales/Purchases skip this — the discriminator-only link is
      // already established by prepareUpload's attachedToId arg.
      if (onAttach) {
        setUploadStatus("attaching");
        await onAttach(entityId, prep.attachmentId);
      }

      setUploadStatus("idle");
      onClose();
      router.refresh();
    } catch (err) {
      setUploadStatus("idle");
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Please retry.",
      );
    }
  };

  const handleViewExisting = async () => {
    if (!existing) return;
    const res = await getAttachmentViewUrl(existing.id);
    if (res.ok) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    }
  };

  const handleReplaceClick = () => {
    // Clears the file input + lets the user pick a fresh file. We DON'T
    // soft-delete the existing bill here — that only happens at upload
    // time so the user can back out of "Replace" without losing the
    // currently-attached bill.
    if (fileInputRef.current) fileInputRef.current.value = "";
    setPickedFile(null);
    setPickerError(null);
    // Treat "Replace" as "scroll past the existing block to the picker."
    // The picker is always rendered; we only need to clear local state.
  };

  const busy = uploadStatus !== "idle";
  const busyLabel =
    uploadStatus === "preparing"
      ? "Preparing"
      : uploadStatus === "uploading"
        ? "Uploading"
        : uploadStatus === "confirming"
          ? "Confirming"
          : uploadStatus === "attaching"
            ? "Attaching"
            : "Saving";

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[600px] md:p-6"
        className="bg-surface-container border-outline-variant p-6 gap-0"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {existing ? "Replace bill" : "Upload bill"}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-5">
          {loadingExisting && (
            <p className="text-sm text-on-surface-variant">Loading…</p>
          )}

          {!loadingExisting && existing && !pickedFile && (
            <div className="border border-outline-variant bg-surface-container-low p-4 space-y-3">
              <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
                Current bill
              </p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-on-surface truncate">
                    {existing.originalFilename}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    {existing.mimeType} · {formatBytes(existing.sizeBytes)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleViewExisting}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider font-display bg-surface-container-high text-on-surface hover:bg-surface-container-highest border border-outline-variant transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  View
                </button>
              </div>
              <button
                type="button"
                onClick={handleReplaceClick}
                className="text-xs uppercase tracking-wider text-secondary hover:text-secondary-container transition-colors"
              >
                Replace with a new file ↓
              </button>
            </div>
          )}

          <div className="space-y-3">
            <p className="font-display text-xs uppercase tracking-wider text-on-surface-variant">
              {existing ? "New file" : "Select a file"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_MIME_TYPES.join(",")}
              onChange={onPickFile}
              disabled={busy}
              className="text-sm text-on-surface file:mr-3 file:py-2 file:px-4 file:border-0 file:bg-surface-container-high file:text-on-surface file:font-display file:uppercase file:tracking-wider file:text-xs hover:file:bg-surface-container-highest"
            />
            {pickerError && (
              <p className="text-xs text-error">{pickerError}</p>
            )}
            <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">
              <Upload className="inline size-3 mr-1" />
              Max {formatBytes(MAX_FILE_SIZE_BYTES)}. PDF, JPEG, PNG, WebP.
            </p>
          </div>

          {pickedFile && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-on-surface truncate">
                  Preview: {pickedFile.name}
                </span>
                <span className="text-xs text-on-surface-variant">
                  {formatBytes(pickedFile.size)}
                </span>
              </div>
              <AttachmentPreview file={pickedFile} />
            </div>
          )}

          {uploadError && (
            <div className="border-l-2 border-error bg-surface-container-high text-error px-3 py-2 text-sm">
              {uploadError}
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] md:min-h-0 px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!pickedFile || busy}
            className="min-w-[140px] min-h-[44px] md:min-h-0 md:h-10 px-4 bg-primary text-on-primary font-display text-sm font-medium uppercase tracking-wider hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>{busyLabel}…</span>
              </>
            ) : (
              "Upload"
            )}
          </button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function putToR2(presignedUrl: string, file: File): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl, true);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 PUT failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}
