import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The HTTP tests open real sockets and run a ~1.5s crash-robustness probe.
    // Single worker keeps the coverage flush deterministic within one run.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/main.ts"], // process bootstrap; exercised by deploy smoke
      // Per-invocation temp/report dir (see shared config) — immune to a
      // second concurrent `pnpm test` in the same tree.
      reportsDirectory: join(tmpdir(), `tamasha-cov-${process.pid}`, "server"),
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
