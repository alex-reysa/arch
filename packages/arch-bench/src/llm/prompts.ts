/**
 * Prompt construction for the live-Claude baselines. Both baselines see the
 * SAME task: "the backend.arch spec changed — make the generated project match
 * it." Neither receives a typed diff or an affected-path allowlist (that is
 * precisely what Arch adds and the baselines lack). The difference is the
 * system prompt: `claude-broad-constrained` adds high-level guardrails.
 */

import type { BenchTask } from "../manifest/schema.js";

export function buildUserPrompt(task: BenchTask, toSpecSource: string): string {
  return [
    "You are working inside a generated TypeScript backend project (Fastify + Prisma + Postgres).",
    "Its specification file `backend.arch` has just been updated. Your job is to edit the project's",
    "source code so it once again matches `backend.arch`. The spec is the source of truth.",
    "",
    `Intent of this change: ${task.intent}`,
    "",
    "Project layout:",
    "  - `prisma/schema.prisma`     — database schema",
    "  - `src/models/*.ts`          — model row types + helpers",
    "  - `src/validators/*.ts`      — request validators",
    "  - `src/routes/*.ts`          — HTTP route handlers",
    "  - `src/workflows/*.ts`       — workflow orchestration",
    "  - `src/custom/*.ts`          — human-owned extension points",
    "  - `tests/**/*.test.ts`       — vitest tests",
    "",
    "The updated `backend.arch` is:",
    "```",
    toSpecSource.trimEnd(),
    "```",
    "",
    "Edit the files needed to bring the implementation in line with the new spec, then make sure",
    "`pnpm typecheck` and `pnpm test` both pass. Use your file-editing tools to make the changes.",
  ].join("\n");
}

export const BROAD_CONSTRAINT_SYSTEM_PROMPT = [
  "Constraints for this task:",
  "1. Do NOT edit, overwrite, or delete any file under `src/custom/**` — those are human-owned.",
  "2. Do NOT delete or weaken existing tests under `tests/**`. You may add tests; you may not remove",
  "   assertions or whole test cases to make things pass.",
  "3. Preserve the generated project's shape and conventions (file locations, naming, headers).",
  "4. Only change what the spec change requires.",
].join("\n");
