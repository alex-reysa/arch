import { describe, expect, it } from "vitest";
import type { SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  AgentTaskError,
  ClaudeCodeProvider,
  buildAgentTaskSpec,
  type AgentIrFragment,
} from "../src/index.js";

/**
 * OPTIONAL live test that actually invokes `claude -p`. SKIPPED BY DEFAULT.
 *
 * Enable with:
 *   ARCH_RUN_LIVE_CLAUDE=1 pnpm --filter @arch/agents test -- test/claude-code-live.test.ts
 *
 * It proves the end-to-end constraint: a real Claude Code subprocess (tools
 * disabled, isolated cwd) receives only the AgentTaskSpec prompt and returns
 * JSON that the orchestrator either fully validates (every patch inside the
 * allowlist) or safely rejects. A live model can never widen its permissions.
 */
const LIVE = process.env.ARCH_RUN_LIVE_CLAUDE === "1";
const liveIt = LIVE ? it : it.skip;

const IR_FRAGMENT: AgentIrFragment = {
  fragment_hash: "sha256:frag",
  entity_ids: ["model:Task"],
  body: {
    id: "model:Task",
    kind: "model",
    name: "Task",
    fields: [
      { name: "id", type: "id" },
      { name: "title", type: "string" },
    ],
  },
};

function action(): SyncPlanActionV1 {
  return {
    action_id: "action.src/models/Task.ts",
    kind: "rewrite_whole_file",
    artifact_id: "tmpl.model.Task",
    path: "src/models/Task.ts",
    entity_ids: ["model:Task"],
    diff_ids: ["diff.initial.Task"],
    generation: {
      mode: "full_file",
      generator_id: "arch.generator.v1",
      template_id: "ts.model",
      ir_fragment_hash: "sha256:frag",
    },
    ownership: {
      ownership_id: "own.tmpl.model.Task",
      ownership_kind: "generated_file",
      write_scope: "whole_file",
      owner: "arch",
    },
    destructive: false,
    requires_confirmation: false,
  };
}

describe("live claude -p provider (optional)", () => {
  liveIt(
    "produces output the orchestrator either validates or safely rejects",
    async () => {
      const provider = new ClaudeCodeProvider({});
      const spec = buildAgentTaskSpec({
        role: "schema",
        action: action(),
        diffs: [],
        irFragment: IR_FRAGMENT,
        allowedPaths: ["src/models/Task.ts"],
        forbiddenPaths: ["node_modules/**", ".git/**", "src/custom/**"],
        intentSummary:
          "Emit a TypeScript file at src/models/Task.ts exporting `interface Task { id: string; title: string }`.",
      });

      try {
        const result = await new AgentOrchestrator({ provider }).runTask(spec);
        for (const patch of result.output.patches) {
          expect(patch.path).toBe("src/models/Task.ts");
        }
        expect(result.record.provider_id).toBe("claude-code");
        expect(result.record.task_hash).toMatch(/^[0-9a-f]{64}$/);
        // eslint-disable-next-line no-console
        console.log("LIVE CLAUDE RUN RECORD:", JSON.stringify(result.record), "NOTES:", result.output.notes);
      } catch (e) {
        expect(e).toBeInstanceOf(AgentTaskError);
        expect((e as AgentTaskError).record.output_validation.ok).toBe(false);
      }
    },
    120_000,
  );
});
