import { spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Successful install result. `passed` is `true` and `exitCode` is `0`.
 */
export interface InstallOkResult {
  readonly passed: true;
  readonly exitCode: 0;
  readonly durationMs: number;
  readonly stderr: string;
}

/**
 * Failed install result. `passed` is `false`, `exitCode` is the child's
 * non-zero exit code (or `-1` if the child failed to start), and
 * `failure_reason` is the documented `"install"` literal so callers can
 * propagate it onto a `VerificationRunResult`.
 */
export interface InstallFailureResult {
  readonly passed: false;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly stderr: string;
  readonly failure_reason: "install";
}

/**
 * Discriminated union returned by `runInstall`. Narrow on `passed` (or on
 * the presence of `failure_reason`) to distinguish ok from install failure.
 */
export type InstallResult = InstallOkResult | InstallFailureResult;

/** Minimal `spawn` shape used by `runInstall` — kept structural so tests can
 * substitute a stub without dragging in the full `child_process` types. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ReturnType<typeof nodeSpawn>;

export interface RunInstallOptions {
  /** Absolute path to the generated project that should be installed. */
  readonly projectRoot: string;
  /**
   * Stream sink for the child's stdout/stderr. Defaults to `process.stderr`
   * so the parent process sees install progress on its own stderr. Tests
   * may inject a no-op writer to keep test output clean.
   */
  readonly stderrSink?: { write(chunk: string | Uint8Array): boolean };
  /** Optional `spawn` injection seam; defaults to `node:child_process#spawn`. */
  readonly spawn?: SpawnFn;
}

/**
 * Run `pnpm install` (or `pnpm install --frozen-lockfile=false` when the
 * project has no `pnpm-lock.yaml`) inside `projectRoot`.
 *
 * The implementation mirrors the existing `runCommand` plumbing — `spawn` a
 * child with piped stdio, capture stderr, time the run — and additionally
 * forwards the child's stdout and stderr to the parent process's stderr so
 * long-running install output is not swallowed. `command-runner.ts` itself
 * is intentionally untouched.
 *
 * On success returns `{ passed: true, exitCode: 0, ... }`. On failure
 * returns `{ passed: false, exitCode, failure_reason: "install", ... }` so
 * the verifier can lift `failure_reason` directly onto its run result.
 */
export async function runInstall(options: RunInstallOptions): Promise<InstallResult> {
  const { projectRoot } = options;
  const sink = options.stderrSink ?? process.stderr;
  const spawnFn: SpawnFn = options.spawn ?? nodeSpawn;

  const hasLockfile = existsSync(resolve(projectRoot, "pnpm-lock.yaml"));
  const args: readonly string[] = hasLockfile
    ? ["install"]
    : ["install", "--frozen-lockfile=false"];

  const start = Date.now();
  const child = spawnFn("pnpm", args, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    sink.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    sink.write(chunk);
  });

  const exitCode: number = await new Promise<number>((resolvePromise) => {
    child.on("error", (err: Error) => {
      stderr += `${err.message}\n`;
      sink.write(`${err.message}\n`);
      resolvePromise(-1);
    });
    child.on("exit", (code) => resolvePromise(code ?? -1));
  });

  const durationMs = Date.now() - start;
  if (exitCode === 0) {
    return { passed: true, exitCode: 0, durationMs, stderr };
  }
  return {
    passed: false,
    exitCode,
    durationMs,
    stderr,
    failure_reason: "install",
  };
}
