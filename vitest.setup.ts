// Auto-loaded before every test file. Wires up the jest-dom matchers
// (`toBeInTheDocument`, `toHaveTextContent`, `toBeVisible`, etc.) into
// Vitest's `expect`.
import "@testing-library/jest-dom/vitest";

// Phase 11: jsdom doesn't implement window.matchMedia. The useIsMobile
// hook (and any component that uses it transitively, like ResponsiveTable
// and ResponsiveDialog) calls matchMedia on mount. Default to a stub
// that returns `matches: false` so tests render the desktop branch by
// default. Tests that want to exercise the mobile branch override
// window.matchMedia in a beforeEach (see TESTING.md "Mobile viewport
// testing via window.matchMedia mock").
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
