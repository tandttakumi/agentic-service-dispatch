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
      include: [
        "src/lib/domain/**/*.ts",
        "src/lib/webmcp/fake-adapter.ts",
        "src/lib/webmcp/tool-registry.ts",
      ],
      exclude: ["src/lib/domain/types.ts"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 85,
        lines: 80,
      },
    },
  },
});

