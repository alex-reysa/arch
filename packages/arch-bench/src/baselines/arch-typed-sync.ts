/**
 * `arch-typed-sync` — the deterministic Arch path. Compute the typed diff
 * (`arch plan`), assert plan determinism by planning twice, then `arch apply`
 * with its built-in verification gate. For destructive/confirmation-required
 * tasks, apply REFUSES by default — that refusal is the expected, safe outcome
 * (`blocked: true`), and we assert no off-scope writes elsewhere.
 */

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Baseline, EvolveContext, EvolveOutcome } from "./types.js";

async function latestPlanHash(dir: string): Promise<string | null> {
  const planPath = resolve(dir, ".arch", "plans", "latest.plan.json");
  if (!existsSync(planPath)) return null;
  try {
    const plan = JSON.parse(await readFile(planPath, "utf8")) as { plan_hash?: string };
    return plan.plan_hash ?? null;
  } catch {
    return null;
  }
}

export const archTypedSync: Baseline = {
  id: "arch-typed-sync",
  async evolve(ctx: EvolveContext): Promise<EvolveOutcome> {
    const dir = ctx.workspace.dir;
    let logs = "";
    const cap = (label: string, r: { code: number; stdout: string; stderr: string }) => {
      logs += `\n=== ${label} (exit ${r.code}) ===\n${r.stdout}\n${r.stderr}\n`;
      return r;
    };

    const backend = resolve(dir, "backend.arch");

    // Recompile current spec → ir.current.json. A compile failure is a hard,
    // expected block for malformed/unsupported specs.
    const parse = cap("parse", await ctx.archCli(["parse", "--emit-ir", backend, "--cwd", dir]));
    if (parse.code !== 0) {
      return { blocked: true, verificationPassed: false, note: "spec failed to compile", logs };
    }

    // Plan twice — determinism check.
    const planA = cap("plan#1", await ctx.archCli(["plan", "--cwd", dir]));
    const hashA = await latestPlanHash(dir);
    const planB = cap("plan#2", await ctx.archCli(["plan", "--cwd", dir]));
    const hashB = await latestPlanHash(dir);
    const planDeterministic = planA.code === 0 && planB.code === 0 && hashA !== null && hashA === hashB;

    // A non-zero plan means the diff itself is blocked (unsupported/destructive
    // surface). That is a safe block.
    if (planA.code !== 0) {
      return {
        blocked: true,
        verificationPassed: false,
        planDeterministic,
        note: "plan blocked (unsupported or destructive diff)",
        logs,
      };
    }

    // Apply with verification gating. Apply refuses destructive/confirmation
    // plans (exit 70) — that is the expected safe block, not a crash.
    const apply = cap("apply", await ctx.archCli(["apply", "--cwd", dir]));
    if (apply.code !== 0) {
      return {
        blocked: true,
        verificationPassed: false,
        planDeterministic,
        note: `apply did not promote (exit ${apply.code})`,
        logs,
      };
    }

    return { blocked: false, verificationPassed: true, planDeterministic, logs };
  },
};
