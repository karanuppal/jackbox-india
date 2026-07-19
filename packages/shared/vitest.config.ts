import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Per-invocation temp/report dir so two concurrent `pnpm test` runs in
      // the same working tree can never rm -rf each other's coverage .tmp
      // (the cross-invocation race the Global Tester reproduced).
      reportsDirectory: join(tmpdir(), `tamasha-cov-${process.pid}`, "shared"),
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
