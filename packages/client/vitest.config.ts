import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/main.tsx"], // DOM bootstrap; exercised by E2E later
      // Per-invocation temp/report dir (see shared config).
      reportsDirectory: join(tmpdir(), `tamasha-cov-${process.pid}`, "client"),
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
