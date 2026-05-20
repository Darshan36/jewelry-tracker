"use client";

// Full-screen photo viewer — Phase 12a.
//
// Uses ResponsiveDialog so the lightbox is a centered Dialog on md+ and a
// full-screen Sheet on mobile. Inside, the photo fits the viewport with
// object-contain. Arrow keys (← →) and on-screen prev/next buttons move
// between photos; Esc closes (Dialog/Sheet built-in).
//
// The presigned GET URL is re-fetched each time the index changes — the
// URL is 1-hour expiry so it's safe to keep a small per-index cache for
// the open session. Loaded URLs persist in component state for the
// lifetime of the open lightbox; closing throws them away.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import {
  getAttachmentViewUrl,
  type PhotoForClient,
} from "@/app/(app)/attachments/actions";
import { formatDate } from "@/lib/format";

type Props = {
  photos: PhotoForClient[];
  initialIndex: number;
  open: boolean;
  onClose: () => void;
};

export function PhotoLightbox({ photos, initialIndex, open, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Reset to the initialIndex whenever the lightbox is (re)opened — guards
  // against stale state if the same component is reopened on a different photo.
  useEffect(() => {
    if (open) setIndex(initialIndex);
  }, [open, initialIndex]);

  const current = photos[index] ?? null;
  const currentUrl = current ? urls[current.id] : undefined;

  // Lazy-load the URL for the current photo on index change.
  useEffect(() => {
    if (!open || !current) return;
    if (urls[current.id]) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const res = await getAttachmentViewUrl(current.id);
      if (cancelled) return;
      if (res.ok) {
        setUrls((prev) => ({ ...prev, [current.id]: res.url }));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current, urls]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i));
  }, []);
  const goNext = useCallback(() => {
    setIndex((i) => (i < photos.length - 1 ? i + 1 : i));
  }, [photos.length]);

  // Keyboard navigation. Wired only while the lightbox is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, goPrev, goNext]);

  if (!current) return null;

  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent
        desktopClassName="md:max-w-[90vw] md:max-h-[90vh] md:p-0"
        className="bg-surface-container border-outline-variant p-0 gap-0"
      >
        <div
          data-testid="photo-lightbox"
          data-photo-id={current.id}
          className="relative w-full flex flex-col"
        >
          {/* Visually-hidden title satisfies Radix's DialogContent a11y
              requirement. The visible caption strip below carries the
              filename for sighted users. */}
          <ResponsiveDialogTitle className="sr-only">
            Photo viewer
          </ResponsiveDialogTitle>
          {/* Image area — fills viewport, lets the image breathe with contain. */}
          <div className="relative bg-surface-container-highest min-h-[60vh] md:min-h-[70vh] flex items-center justify-center overflow-hidden">
            {loading && !currentUrl && (
              <Loader2 className="size-8 animate-spin text-on-surface-variant" />
            )}
            {currentUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentUrl}
                alt={current.originalFilename}
                className="max-w-full max-h-[70vh] md:max-h-[80vh] object-contain"
                draggable={false}
              />
            )}

            {/* Prev / Next overlay buttons. Hidden when there's no neighbor
                in that direction so the affordance matches state. */}
            {hasPrev && (
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center bg-surface-container/80 text-on-surface hover:bg-surface-container border border-outline-variant transition-colors"
              >
                <ChevronLeft className="size-5" />
              </button>
            )}
            {hasNext && (
              <button
                type="button"
                onClick={goNext}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center bg-surface-container/80 text-on-surface hover:bg-surface-container border border-outline-variant transition-colors"
              >
                <ChevronRight className="size-5" />
              </button>
            )}
          </div>

          {/* Caption strip — filename + date + index. */}
          <div className="px-4 py-3 border-t border-outline-variant flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-on-surface truncate">
                {current.originalFilename}
              </p>
              <p className="text-[10px] text-on-surface-variant uppercase tracking-wider tabular-nums mt-0.5">
                {formatDate(current.uploadedAt)}
              </p>
            </div>
            <p className="text-xs text-on-surface-variant tabular-nums">
              {index + 1} / {photos.length}
            </p>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
