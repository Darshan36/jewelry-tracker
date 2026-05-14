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
  },
  resolve: {
    alias: {
      // Mirror tsconfig.json's `@/*` alias so test imports resolve the
      // same way production code does.
      "@": resolve(__dirname, "./src"),
    },
  },
});
