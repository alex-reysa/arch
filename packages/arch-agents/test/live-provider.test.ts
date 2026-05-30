import { describe, expect, it } from "vitest";
import type { SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  AgentTaskError,
  buildAgentTaskSpec,
  providerFromEnv,
  type AgentIrFragment,
} from "../src/index.js";

/**
 * OPTIONAL live-provider integration test. It makes a REAL network call to a
 * configured LLM and is SKIPPED BY DEFAULT.
 *
 * Enable with:
 *   ARCH_RUN_LIVE_LLM=1 \
 *   ARCH_LLM_API_KEY=sk-... \
 *   ARCH_LLM_MODEL=claude-... \
 *   pnpm --filter @arch/agents test -- test/live-provider.test.ts
 *
 * Safety: the orchestrator re-validates whatever the model returns, so this
 * test asserts the boundary holds — the run either yields a fully-validated
 * patch confined to the allowlist, or is rejected with AgentTaskError. A live
 * model can never widen its own permissions.
 */
const LIVE = process.env.ARCH_RUN_LIVE_LLM === "1" && Boolean(process.env.ARCH_LLM_API_KEY);
const liveIt = LIVE ? it : it.skip;

const IR_FRAGMENT: AgentIrFragment = {
  fragment_hash: "sha256:frag",
  entity_ids: ["model:Post"],
  body: { id: "model:Post", kind: "model", name: "Post", fields: [{ name: "id", type: "uuid" }] },
};

function action(): SyncPlanActionV1 {
  return {
    action_id: "action.src/models/Post.ts",
    kind: "rewrite_whole_file",
    artifact_id: "tmpl.model.Post",
    path: "src/models/Post.ts",
    entity_ids: ["model:Post"],
    diff_ids: ["diff.model_field_added.Post.visibility"],
    generation: {
      mode: "full_file",
      generator_id: "arch.generator.v1",
      template_id: "ts.model",
      ir_fragment_hash: "sha256:frag",
    },
    ownership: {
      ownership_id: "own.tmpl.model.Post",
      ownership_kind: "generated_file",
      write_scope: "whole_file",
      owner: "arch",
    },
    destructive: false,
    requires_confirmation: false,
  };
}

describe("live LLM provider (optional, network)", () => {
  liveIt(
    "produces output the orchestrator either validates or safely rejects",
    async () => {
      const provider = providerFromEnv(process.env);
      expect(provider.id).toBe("http-llm");
      expect(provider.enabled).toBe(true);

      const spec = buildAgentTaskSpec({
        role: "schema",
        action: action(),
        diffs: [],
        irFragment: IR_FRAGMENT,
        allowedPaths: ["src/models/Post.ts"],
        forbiddenPaths: ["node_modules/**", ".git/**", "src/custom/**"],
        intentSummary: "regenerate the Post model file",
      });

      try {
        const result = await new AgentOrchestrator({ provider }).runTask(spec);
        // Accepted path: every patch is inside the allowlist.
        for (const patch of result.output.patches) {
          expect(patch.path).toBe("src/models/Post.ts");
        }
        expect(result.record.model_id).toBe(provider.model_id);
        expect(result.record.task_hash).toMatch(/^[0-9a-f]{64}$/);
      } catch (e) {
        // Rejected path: the boundary held and produced a structured record.
        expect(e).toBeInstanceOf(AgentTaskError);
        expect((e as AgentTaskError).record.output_validation.ok).toBe(false);
      }
    },
    60_000,
  );
});
