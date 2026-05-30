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
  },
});
