/**
 * Executable migration data-preservation checks.
 *
 * Contract (per `ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md`): a task's `dbCheck`
 * is a `tsx`-runnable script invoked as `tsx db-check.ts <projectDir>` with
 * `DATABASE_URL`/`ARCH_BENCH_DATABASE_URL` in the environment. The script must
 * emit a single structured result line on stdout:
 *
 *   ARCH_DBCHECK_RESULT {"status":"passed","dataPreserved":true,"reason":"..."}
 *
 * The runner records the parsed status on the result row. Validation/paper-mode
 * scoring fails a migration task unless `status === "passed"`.
 */

import type { MigrationCheckStatus } from "../report/results.js";
import { runCommand } from "./command.js";

export interface DbCheckResult {
  readonly status: MigrationCheckStatus;
  readonly dataPreserved?: boolean;
  readonly reason?: string;
}

const SENTINEL = "ARCH_DBCHECK_RESULT";
const VALID_STATUSES: ReadonlySet<string> = new Set([
  "passed",
  "failed",
  "skipped",
  "not_applicable",
]);

/** The Postgres URL a db-check should use, preferring the bench-specific var. */
export function resolveDatabaseUrl(env: Record<string, string | undefined>): string | undefined {
  return env["ARCH_BENCH_DATABASE_URL"] ?? env["DATABASE_URL"] ?? undefined;
}

/** Parse a db-check subprocess's stdout/exit code into a structured result. */
export function parseDbCheckResult(stdout: string, exitCode: number): DbCheckResult {
  let payload: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith(SENTINEL)) payload = trimmed.slice(SENTINEL.length).trim();
  }

  if (payload === undefined) {
    return exitCode === 0
      ? { status: "skipped", reason: "db-check produced no structured result" }
      : { status: "failed", reason: `db-check exited ${exitCode} without a result` };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(payload);
  } catch {
    return { status: "failed", reason: "db-check emitted an unparseable result line" };
  }

  const record = (obj ?? {}) as Record<string, unknown>;
  const rawStatus = record["status"];
  if (typeof rawStatus !== "string" || !VALID_STATUSES.has(rawStatus)) {
    return { status: "failed", reason: `db-check reported an unknown status: ${String(rawStatus)}` };
  }

  return {
    status: rawStatus as MigrationCheckStatus,
    ...(typeof record["dataPreserved"] === "boolean"
      ? { dataPreserved: record["dataPreserved"] as boolean }
      : {}),
    ...(typeof record["reason"] === "string" ? { reason: record["reason"] as string } : {}),
  };
}

export interface RunDbCheckOptions {
  /** Absolute path to the db-check script. */
  readonly scriptPath: string;
  /** Generated project workspace the migration was applied to. */
  readonly projectDir: string;
  readonly env: Record<string, string | undefined>;
  /**
   * Explicit DB URL override. The hermetic workspace env intentionally does not
   * inherit the bench process's DB vars, so the orchestrator threads the URL
   * (read from `process.env` in `main.ts`) through here. Falls back to the
   * workspace env for direct callers/tests.
   */
  readonly databaseUrl?: string;
  readonly timeoutMs?: number;
}

/**
 * Execute a db-check against a real Postgres. Returns `skipped` (without
 * spawning) when no database URL is configured, so smoke runs never require a
 * database.
 */
export async function runDbCheck(opts: RunDbCheckOptions): Promise<DbCheckResult> {
  const url = opts.databaseUrl ?? resolveDatabaseUrl(opts.env);
  if (!url) {
    return { status: "skipped", reason: "no DATABASE_URL/ARCH_BENCH_DATABASE_URL configured" };
  }
  const env: NodeJS.ProcessEnv = { ...opts.env, DATABASE_URL: url, ARCH_BENCH_DATABASE_URL: url };
  const res = await runCommand("pnpm", ["exec", "tsx", opts.scriptPath, opts.projectDir], {
    cwd: opts.projectDir,
    env,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  return parseDbCheckResult(res.stdout, res.code);
}
