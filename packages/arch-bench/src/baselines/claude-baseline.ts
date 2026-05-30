/**
 * Shared implementation for the two live-Claude baselines:
 *  - `claude-direct-edit`       — full edit tools, no constraints, no typed diff.
 *  - `claude-broad-constrained` — same, plus a high-level constraint system
 *                                 prompt (don't touch src/custom, don't weaken
 *                                 tests, preserve shape) but still no typed diff
 *                                 and no affected-path allowlist.
 *
 * Both run `claude -p` with `cwd` = the temp project so Claude edits real files,
 * then verify the project with `pnpm typecheck` + `pnpm test`.
 */

import { runClaude } from "../llm/claude-runner.js";
import { buildUserPrompt } from "../llm/prompts.js";
import { verifyProject } from "../runner/verify-project.js";
import type { BaselineId } from "../manifest/schema.js";
import type { Baseline, EvolveContext, EvolveOutcome } from "./types.js";

export interface ClaudeBaselineConfig {
  readonly id: BaselineId;
  readonly appendSystemPrompt?: string;
}

export function makeClaudeBaseline(config: ClaudeBaselineConfig): Baseline {
  return {
    id: config.id,
    async evolve(ctx: EvolveContext): Promise<EvolveOutcome> {
      if (!ctx.claudeTransport) {
        return {
          blocked: false,
          verificationPassed: false,
          note: "live baseline skipped: no Claude transport (set ARCH_BENCH_LIVE=1)",
          logs: "",
        };
      }

      const prompt = buildUserPrompt(ctx.task, ctx.toSpecSource);
      const outcome = await runClaude(
        {
          cwd: ctx.workspace.dir,
          prompt,
          ...(config.appendSystemPrompt ? { appendSystemPrompt: config.appendSystemPrompt } : {}),
          ...(ctx.liveModel ? { model: ctx.liveModel } : {}),
        },
        ctx.claudeTransport,
      );

      let logs = `=== claude (${config.id}) ===\nok=${outcome.ok} exit=${outcome.exitCode}\n`;
      logs += outcome.ok ? outcome.text : `error: ${outcome.error}`;
      logs += `\n--- raw ---\n${outcome.raw}\n`;

      const llm: EvolveOutcome["llm"] = outcome.ok
        ? {
            provider: "claude-code",
            ...(outcome.costUsd !== undefined ? { costUsd: outcome.costUsd } : {}),
            ...(outcome.sessionId !== undefined ? { sessionId: outcome.sessionId } : {}),
          }
        : { provider: "claude-code" };

      if (!outcome.ok) {
        return { blocked: false, verificationPassed: false, llm, note: `claude run failed: ${outcome.error}`, logs };
      }

      const verify = await verifyProject(ctx.workspace);
      logs += verify.logs;
      return { blocked: false, verificationPassed: verify.passed, llm, logs };
    },
  };
}
