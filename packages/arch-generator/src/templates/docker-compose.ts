import type { CanonicalIR } from "@arch/ir";

/**
 * Emit Postgres + (optional) Redis services. The backend service itself is
 * intentionally omitted — local dev runs the app on the host so it can attach
 * a debugger, and CI builds a bespoke image instead of reusing this compose.
 */
export function renderDockerCompose(ir: CanonicalIR): string {
  const lines = [
    "version: \"3.9\"",
    "services:",
    "  postgres:",
    "    image: postgres:16-alpine",
    "    environment:",
    "      POSTGRES_USER: arch",
    "      POSTGRES_PASSWORD: arch",
    "      POSTGRES_DB: arch_app",
    "    ports:",
    "      - \"5432:5432\"",
  ];
  if (ir.target.cache === "redis") {
    lines.push(
      "  redis:",
      "    image: redis:7-alpine",
      "    ports:",
      "      - \"6379:6379\"",
    );
  }
  return lines.join("\n");
}
