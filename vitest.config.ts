import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Exclude the generated Prisma client + Next.js build output from
    // test discovery — those dirs contain files that match *.ts but
    // aren't tests, and importing them eagerly slows the runner.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/src/generated/**",
      "**/dist/**",
    ],
    // Coverage thresholds locked to the Phase 2.3 floor minus a small
    // buffer (~5pp). `npm run test:coverage` exits non-zero if any
    // metric drops below these numbers — protects against silent
    // coverage regressions from untested feature additions. Bump the
    // numbers up after a phase that materially improves coverage.
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 65,
        branches: 60,
        functions: 60,
        statements: 65,
      },
    },
  },
  resolve: {
    alias: {
      // Mirror tsconfig.json's `@/*` alias so test imports resolve the
      // same way production code does.
      "@": resolve(__dirname, "./src"),
    },
  },
});
