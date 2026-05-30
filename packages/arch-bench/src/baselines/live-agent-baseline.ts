/**
 * Shared implementation for live CLI coding-agent baselines.
 *
 * The baseline lets the provider edit the generated temp project, then the
 * harness verifies the project and scores churn/oracles.
 */

import { runLiveAgent, type LiveAgentProvider } from "../llm/agent-runner.js";
import { buildUserPrompt } from "../llm/prompts.js";
import { verifyProject } from "../runner/verify-project.js";
import type { BaselineId } from "../manifest/schema.js";
import type { Baseline, EvolveContext, EvolveOutcome } from "./types.js";

export interface LiveAgentBaselineConfig {
  readonly id: BaselineId;
  readonly provider: LiveAgentProvider;
  readonly appendSystemPrompt?: string;
}

export function makeLiveAgentBaseline(config: LiveAgentBaselineConfig): Baseline {
  return {
    id: config.id,
    async evolve(ctx: EvolveContext): Promise<EvolveOutcome> {
      const transport = ctx.liveTransports?.[config.provider] ?? legacyClaudeTransport(config.provider, ctx);
      if (!transport) {
        return {
          blocked: false,
          verificationPassed: false,
          llm: { provider: config.provider, billingMode: config.provider === "claude-code" ? "metered" : "subscription" },
          note: `live baseline skipped: no ${config.provider} transport (set ARCH_BENCH_LIVE=1)`,
          logs: "",
        };
      }

      const prompt = buildUserPrompt(ctx.task, ctx.toSpecSource);
      const model = ctx.liveModels?.[config.provider] ?? (config.provider === "claude-code" ? ctx.liveModel : undefined);
      const outcome = await runLiveAgent(
        {
          provider: config.provider,
          cwd: ctx.workspace.dir,
          prompt,
          ...(config.appendSystemPrompt ? { appendSystemPrompt: config.appendSystemPrompt } : {}),
          ...(model ? { model } : {}),
        },
        transport,
      );

      let logs = `=== ${config.provider} (${config.id}) ===\nok=${outcome.ok} exit=${outcome.exitCode}\n`;
      logs += outcome.ok ? outcome.text : `error: ${outcome.error}`;
      logs += `\n--- raw ---\n${outcome.raw}\n`;

      if (!outcome.ok) {
        return {
          blocked: false,
          verificationPassed: false,
          llm: outcome.llm,
          note: `${config.provider} run failed: ${outcome.error}`,
          logs,
        };
      }

      const verify = await verifyProject(ctx.workspace);
      logs += verify.logs;
      return { blocked: false, verificationPassed: verify.passed, llm: outcome.llm, logs };
    },
  };
}

function legacyClaudeTransport(provider: LiveAgentProvider, ctx: EvolveContext) {
  return provider === "claude-code" ? ctx.claudeTransport : undefined;
}
