"use client";

// Phase 11 — viewport detection hook. Returns `true` when the viewport is
// below the project's `md` breakpoint (767px and below).
//
// SSR-safe: initial render returns `false` (desktop), so the server-rendered
// HTML and the first client render agree — no hydration mismatch. After
// mount, the hook reads `window.matchMedia` and may flip to `true` on
// mobile, triggering a re-render.
//
// Tests can mock `window.matchMedia` to control which branch executes (the
// project's TESTING.md "Mobile viewport testing" section documents the
// pattern). Default mock value of `matches: false` keeps existing
// non-mobile-aware tests on the desktop branch.

import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    setIsMobile(mql.matches);
    const listener = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Safari < 14 used addListener/removeListener; modern browsers use
    // addEventListener. Detect and use whichever's available.
    if (mql.addEventListener) {
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mql as any).addListener(listener);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return () => (mql as any).removeListener(listener);
    }
  }, []);

  return isMobile;
}
