/**
 * `full-regeneration` — compile the target spec and rewrite EVERY Arch-owned
 * artifact from the target IR, with no typed diff and no affected-artifact
 * planning. Human-owned files (`src/custom/**`, stub-only extension points)
 * are preserved (written only when absent), matching `arch apply`'s ownership
 * rule. This measures churn and off-scope writes, and — by design — has no
 * destructive-change safety gate, so it never "blocks".
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generate } from "@arch/generator";
import { compileSpec } from "../runner/compile.js";
import { verifyProject } from "../runner/verify-project.js";
import type { Baseline, EvolveContext, EvolveOutcome } from "./types.js";

export const fullRegeneration: Baseline = {
  id: "full-regeneration",
  async evolve(ctx: EvolveContext): Promise<EvolveOutcome> {
    const dir = ctx.workspace.dir;

    const compiled = compileSpec(ctx.toSpecSource, resolve(dir, "backend.arch"));
    if (!compiled.ok) {
      return {
        blocked: true,
        verificationPassed: false,
        note: `spec failed to compile: ${compiled.diagnostics.map((d) => d.message).join("; ")}`,
        logs: "",
      };
    }

    const result = generate(compiled.ir);
    let written = 0;
    let preserved = 0;
    for (const f of result.files) {
      const target = resolve(dir, f.path);
      if (f.stub_only && existsSync(target)) {
        preserved += 1;
        continue; // preserve human-owned extension points
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content, "utf8");
      written += 1;
    }

    const verify = await verifyProject(ctx.workspace);
    return {
      blocked: false,
      verificationPassed: verify.passed,
      note: `regenerated ${written} files, preserved ${preserved} stubs`,
      logs: verify.logs,
    };
  },
};
