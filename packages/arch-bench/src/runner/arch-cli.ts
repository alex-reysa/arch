/**
 * Drives the REAL `arch` CLI as a subprocess, exactly the way a user (and
 * `scripts/run-examples-e2e.ts`) does: `pnpm exec tsx <repo>/packages/arch-cli/
 * src/main.ts <args>`. Running against source (via tsx) avoids a build step and
 * exercises the true CLI code path, including real exit codes.
 */

import { resolve } from "node:path";
import { runCommand, type CommandResult } from "./command.js";

export interface ArchCliOptions {
  readonly repoRoot: string;
  /** Workspace env (pnpm shim PATH) merged into every invocation. */
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly inherit?: boolean;
}

export type ArchCli = (args: readonly string[]) => Promise<CommandResult>;

export function makeArchCli(opts: ArchCliOptions): ArchCli {
  const cliEntry = resolve(opts.repoRoot, "packages/arch-cli/src/main.ts");
  return (args) =>
    runCommand("pnpm", ["exec", "tsx", cliEntry, ...args], {
      cwd: opts.repoRoot,
      ...(opts.env ? { env: opts.env } : {}),
      timeoutMs: opts.timeoutMs ?? 300_000,
      ...(opts.inherit ? { inherit: true } : {}),
    });
}
