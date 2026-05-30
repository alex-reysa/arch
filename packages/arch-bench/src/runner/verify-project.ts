/**
 * Verify a generated project the way a developer would: `pnpm install` (when
 * needed) → `pnpm typecheck` (`tsc --noEmit`) → `pnpm test` (`vitest run`).
 * Used by the `full-regeneration` and live-agent baselines, which do NOT go
 * through `arch apply` (whose verification gate is built in).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "./command.js";
import type { Workspace } from "./workspace.js";

export interface VerifyStep {
  readonly name: string;
  readonly code: number;
  readonly durationMs: number;
}

export interface VerifyProjectResult {
  readonly passed: boolean;
  readonly steps: readonly VerifyStep[];
  readonly logs: string;
}

export interface VerifyProjectOptions {
  readonly forceInstall?: boolean;
  readonly timeoutMs?: number;
}

export async function verifyProject(ws: Workspace, opts: VerifyProjectOptions = {}): Promise<VerifyProjectResult> {
  const steps: VerifyStep[] = [];
  let logs = "";
  const timeoutMs = opts.timeoutMs ?? 240_000;

  const needInstall = opts.forceInstall || !existsSync(resolve(ws.dir, "node_modules"));
  const plan: { name: string; args: string[] }[] = [];
  if (needInstall) plan.push({ name: "install", args: ["install"] });
  plan.push({ name: "typecheck", args: ["typecheck"] });
  plan.push({ name: "test", args: ["test"] });

  let passed = true;
  for (const step of plan) {
    const r = await runCommand("pnpm", step.args, { cwd: ws.dir, env: ws.env, timeoutMs });
    steps.push({ name: step.name, code: r.code, durationMs: r.durationMs });
    logs += `\n=== ${step.name} (exit ${r.code}) ===\n${r.stdout}\n${r.stderr}\n`;
    if (r.code !== 0) {
      passed = false;
      break; // a failed install/typecheck makes the rest meaningless
    }
  }

  return { passed, steps, logs };
}
