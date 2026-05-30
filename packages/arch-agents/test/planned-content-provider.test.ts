import { describe, expect, it } from "vitest";
import type { SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  PlannedContentProvider,
  buildAgentTaskSpec,
  type AgentIrFragment,
} from "../src/index.js";

const IR_FRAGMENT: AgentIrFragment = {
  fragment_hash: "sha256:frag",
  entity_ids: ["model:Post"],
  body: { id: "model:Post", kind: "model", name: "Post" },
};

function action(kind: SyncPlanActionV1["kind"] = "rewrite_whole_file"): SyncPlanActionV1 {
  return {
    action_id: "action.src/models/Post.ts",
    kind,
    artifact_id: "tmpl.model.Post",
    path: "src/models/Post.ts",
    entity_ids: ["model:Post"],
    diff_ids: ["d1"],
    generation: { mode: "full_file", generator_id: "arch.generator.v1", template_id: "ts.model", ir_fragment_hash: "sha256:frag" },
    ownership: { ownership_id: "own", ownership_kind: "generated_file", write_scope: "whole_file", owner: "arch" },
    destructive: false,
    requires_confirmation: false,
  };
}

describe("PlannedContentProvider", () => {
  it("echoes the planned content through the orchestrator, producing a validated patch", async () => {
    const spec = buildAgentTaskSpec({
      role: "schema",
      action: action(),
      diffs: [],
      irFragment: IR_FRAGMENT,
      allowedPaths: ["src/models/Post.ts"],
      forbiddenPaths: ["node_modules/**"],
      intentSummary: "regenerate Post",
      previousContent: "// the exact deterministic content\n",
    });
    const result = await new AgentOrchestrator({ provider: new PlannedContentProvider() }).runTask(spec);
    expect(result.record.outcome).toBe("ok");
    expect(result.record.provider_id).toBe("planned-content");
    expect(result.output.patches).toHaveLength(1);
    const patch = result.output.patches[0]!;
    expect(patch.path).toBe("src/models/Post.ts");
    expect(patch.kind).toBe("rewrite_whole_file");
    expect("content" in patch && patch.content).toBe("// the exact deterministic content\n");
  });

  it("fails when no planned content is available (cannot fabricate)", async () => {
    const spec = buildAgentTaskSpec({
      role: "schema",
      action: action(),
      diffs: [],
      irFragment: IR_FRAGMENT,
      allowedPaths: ["src/models/Post.ts"],
      forbiddenPaths: [],
      intentSummary: "regenerate Post",
    });
    await expect(new AgentOrchestrator({ provider: new PlannedContentProvider() }).runTask(spec)).rejects.toThrow();
  });
});
