import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The HTTP tests open real sockets and run a ~1.5s crash-robustness probe.
    // Running test files in parallel workers races the @vitest/coverage-v8
    // temp-file writer (intermittent ENOENT on coverage-*.json). Force a
    // single worker so coverage flush is deterministic. (Combined with the
    // root `--workspace-concurrency=1`, the whole gate is race-free.)
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/main.ts"], // process bootstrap; exercised by deploy smoke
      thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
    },
  },
});
