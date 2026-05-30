import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["src/**/*.{test,spec}.ts", "test/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
