import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15_000,
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/app/layout.tsx",
        "src/app/page.tsx",
        "src/lib/domain/types.ts",
        "src/lib/webmcp/types.ts",
      ],
      thresholds: {
        statements: 94,
        branches: 90,
        functions: 97,
        lines: 95,
      },
    },
  },
});
