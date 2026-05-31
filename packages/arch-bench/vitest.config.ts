import { defineConfig } from "vitest/config";

/**
 * @arch/bench unit + integration tests.
 *
 * Unit tests live in `test/` and run fast (pure logic: manifest validation,
 * metric collectors, summary generation, fake-LLM runner). Integration tests
 * live in `test-integration/` — they drive the real CLI through temp
 * workspaces (install + verify), so they are slow and gated by env flags.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    include: [
      "test/**/*.{test,spec}.ts",
      "test-integration/**/*.{test,spec}.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.arch/**"],
    testTimeout: 20_000,
    // Run test FILES one at a time. The gated `test-integration/**` suites each
    // spawn real `pnpm install`s + the real Arch CLI in temp workspaces; running
    // several files concurrently contends for pnpm/disk and makes a generated
    // project's verify flake (observed: a clean apply reported failed_verification
    // only under concurrency). Unit files are tiny, so serializing is cheap.
    fileParallelism: false,
  },
});
