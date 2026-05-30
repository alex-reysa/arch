import { defineConfig } from "vitest/config";

/**
 * Root vitest config. Per-package configs override or extend this.
 * `passWithNoTests` lets packages without test files exit 0 cleanly so the
 * monorepo test command can succeed end-to-end during foundation work.
 */
export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.arch/**"],
  },
});
