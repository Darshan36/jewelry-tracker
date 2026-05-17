// Phase 11.2 — viewport mocking helpers for tests.
//
// Use inside `describe('mobile viewport', ...)` blocks:
//
//   import { mockMobileViewport } from '@/test-utils/viewport'
//
//   describe('mobile viewport', () => {
//     beforeEach(() => {
//       mockMobileViewport()
//     })
//
//     it('renders mobile card view', () => {
//       render(<MyComponent />)
//       expect(screen.getByTestId('responsive-table-mobile')).toBeInTheDocument()
//     })
//   })
//
// The default vitest.setup.ts global stub returns `matches: false` so all
// existing tests stay on the desktop branch. These helpers flip the
// behaviour per-test.
//
// Important: these mock `useIsMobile()`'s branch selection only — they
// don't actually re-layout JSDOM. CSS-based responsive layout (media
// queries in stylesheets) isn't evaluated by JSDOM at all. Visual layout
// regressions require manual viewport-level verification (DevTools at
// 390x844 or real phone). See TESTING.md "Visual viewport verification
// limitations".

/**
 * Make `useIsMobile()` return `true` for the next render. Call inside a
 * `beforeEach` in a `describe('mobile viewport', …)` block.
 */
export function mockMobileViewport(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/**
 * Make `useIsMobile()` return `false` for the next render. Mostly used to
 * restore the default after a test that flipped to mobile, though
 * vitest.setup.ts already does this globally per-test via the default
 * stub.
 */
export function mockDesktopViewport(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
