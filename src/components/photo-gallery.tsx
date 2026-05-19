"use client";

// Multi-photo gallery — Phase 12a.
//
// Self-loading: fetches its own photo list via getPhotosForEntity on mount
// and after any add/delete. Reuses the Phase 8 R2 prepare/confirm flow per
// file. For each picked file the chain is:
//   prepareUpload(PURCHASE_PHOTO, entityId) → presigned PUT to R2 →
//   confirmUpload(attachmentId).
// Failures on individual files don't halt the batch — the others still
// upload; failures are surfaced in an inline error banner.
//
// View mode: read-only thumbnail grid. Click → open PhotoLightbox.
// Edit mode: same grid + per-thumb X delete + "+ Add Photo" tile.
//
// Mobile-first: 2-column grid on mobile, 3-column on md+. Aspect-square
// thumbnails so the grid stays uniform regardless of source aspect.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import {
  PHOTO_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type PhotoMimeType,
} from "@/app/(app)/attachments/schema";
import {
  confirmUpload,
  getAttachmentViewUrl,
  getPhotosForEntity,
  prepareUpload,
  softDeleteAttachment,
  type PhotoForClient,
} from "@/app/(app)/attachments/actions";

import { PhotoLightbox } from "./photo-lightbox";

export type PhotoGalleryMode = "view" | "edit";

type Props = {
  mode: PhotoGalleryMode;
  entityType: "PURCHASE_PHOTO" | "SALE_PHOTO";
  entityId: string;
  /** Optional initial photo list — skips the first network round-trip. */
  initialPhotos?: PhotoForClient[];
};

function isPhotoMime(t: string): t is PhotoMimeType {
  return (PHOTO_MIME_TYPES as readonly string[]).includes(t);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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

export function PhotoGallery({
  mode,
  entityType,
  entityId,
  initialPhotos,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoForClient[]>(initialPhotos ?? []);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const res = await getPhotosForEntity(entityType, entityId);
    if (res.ok) setPhotos(res.photos);
  }, [entityType, entityId]);

  // Initial load if no initialPhotos prop was passed.
  useEffect(() => {
    if (initialPhotos !== undefined) return;
    void reload();
  }, [initialPhotos, reload]);

  // Lazy-load thumb URLs whenever the photo set changes. Each entry is a
  // 1-hour signed URL.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        photos.map(async (p) => {
          const res = await getAttachmentViewUrl(p.id);
          return [p.id, res.ok ? res.url : ""] as const;
        }),
      );
      if (cancelled) return;
      const map: Record<string, string> = {};
      for (const [id, url] of entries) {
        if (url) map[id] = url;
      }
      setThumbUrls(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;

    setError(null);
    setBusy(true);

    const failures: string[] = [];

    for (const file of files) {
      if (!isPhotoMime(file.type)) {
        failures.push(
          `${file.name}: unsupported type "${file.type || "unknown"}"`,
        );
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        failures.push(
          `${file.name}: too large (${formatBytes(file.size)} > ${formatBytes(
            MAX_FILE_SIZE_BYTES,
          )})`,
        );
        continue;
      }
      try {
        const prep = await prepareUpload({
          originalFilename: file.name,
          mimeType: file.type as PhotoMimeType,
          sizeBytes: file.size,
          attachedToType: entityType,
          attachedToId: entityId,
        });
        if (!prep.ok) {
          const first = Object.values(prep.errors).flat().find(Boolean);
          throw new Error(first ?? "Prepare failed");
        }
        await putToR2(prep.presignedUrl, file);
        const conf = await confirmUpload({ attachmentId: prep.attachmentId });
        if (!conf.ok) {
          const first = Object.values(conf.errors).flat().find(Boolean);
          throw new Error(first ?? "Confirm failed");
        }
      } catch (err) {
        failures.push(
          `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    setBusy(false);
    if (failures.length > 0) {
      setError(`Some uploads failed: ${failures.join("; ")}`);
    }
    await reload();
  };

  const onDelete = async (photoId: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await softDeleteAttachment({ attachmentId: photoId });
      if (!res.ok) {
        const first = Object.values(res.errors).flat().find(Boolean);
        throw new Error(first ?? "Delete failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const empty = photos.length === 0;
  const editing = mode === "edit";

  if (!editing && empty) return null;

  return (
    <div data-testid="photo-gallery" data-mode={mode}>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {photos.map((photo, idx) => (
          <PhotoTile
            key={photo.id}
            photo={photo}
            thumbUrl={thumbUrls[photo.id] ?? null}
            editing={editing}
            busy={busy}
            onClick={() => setLightboxIndex(idx)}
            onDelete={() => onDelete(photo.id)}
          />
        ))}

        {editing && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="Add photo"
            data-testid="photo-add-tile"
            className="aspect-square border border-dashed border-outline-variant bg-surface-container-low hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex flex-col items-center justify-center gap-1 text-on-surface-variant"
          >
            {busy ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <>
                <Plus className="size-6" />
                <span className="text-xs uppercase tracking-wider">
                  Add photo
                </span>
              </>
            )}
          </button>
        )}
      </div>

      {editing && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={PHOTO_MIME_TYPES.join(",")}
          onChange={onPickFiles}
          className="sr-only"
          aria-hidden
        />
      )}

      {error && (
        <p className="mt-2 text-xs text-error" role="alert">
          {error}
        </p>
      )}

      {editing && (
        <p className="mt-2 text-[10px] text-on-surface-variant uppercase tracking-wider">
          Max {formatBytes(MAX_FILE_SIZE_BYTES)} per photo. JPEG, PNG, WebP.
        </p>
      )}

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          initialIndex={lightboxIndex}
          open={lightboxIndex !== null}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

function PhotoTile({
  photo,
  thumbUrl,
  editing,
  busy,
  onClick,
  onDelete,
}: {
  photo: PhotoForClient;
  thumbUrl: string | null;
  editing: boolean;
  busy: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="relative aspect-square bg-surface-container-highest border border-outline-variant overflow-hidden group"
      data-testid={`photo-tile-${photo.id}`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`View ${photo.originalFilename}`}
        className="absolute inset-0 w-full h-full"
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={photo.originalFilename}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-on-surface-variant" />
          </div>
        )}
      </button>
      {editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={busy}
          aria-label={`Delete ${photo.originalFilename}`}
          className="absolute top-1 right-1 h-7 w-7 flex items-center justify-center bg-surface-container/90 text-on-surface hover:bg-error hover:text-on-error border border-outline-variant disabled:opacity-50 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
