/**
 * Independent oracle execution. After a baseline applies its changes, the
 * benchmark-authored oracle tests are copied into `tests/oracles/<task-id>/`
 * and run in isolation. Oracles assert BEHAVIOR (default values, enum
 * validation, guarantee behavior, human-owned preservation) — not generated
 * structure — so they hold every baseline to the same external bar.
 */

import { copyFile, mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { runCommand } from "./command.js";
import type { Workspace } from "./workspace.js";

export interface OracleResult {
  /** True if every oracle passed (vacuously true when a task has no oracles). */
  readonly passed: boolean;
  readonly count: number;
  readonly logs: string;
}

export interface RunOraclesOptions {
  readonly ws: Workspace;
  readonly taskId: string;
  /** Absolute paths to oracle `.test.ts` files. */
  readonly oracleFiles: readonly string[];
  readonly timeoutMs?: number;
}

export async function runOracles(opts: RunOraclesOptions): Promise<OracleResult> {
  if (opts.oracleFiles.length === 0) return { passed: true, count: 0, logs: "(no oracles)" };

  const destDir = resolve(opts.ws.dir, "tests", "oracles", opts.taskId);
  await mkdir(destDir, { recursive: true });
  for (const file of opts.oracleFiles) {
    await copyFile(file, resolve(destDir, basename(file)));
  }

  // Run only the oracle directory so an oracle failure is attributable to the
  // oracle, not to unrelated generated tests.
  const relDir = `tests/oracles/${opts.taskId}`;
  const r = await runCommand("pnpm", ["exec", "vitest", "run", relDir], {
    cwd: opts.ws.dir,
    env: opts.ws.env,
    timeoutMs: opts.timeoutMs ?? 120_000,
  });

  return {
    passed: r.code === 0,
    count: opts.oracleFiles.length,
    logs: `=== oracles (exit ${r.code}) ===\n${r.stdout}\n${r.stderr}\n`,
  };
}
