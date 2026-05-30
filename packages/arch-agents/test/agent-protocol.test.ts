import { describe, expect, it } from "vitest";
import type { SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  AgentTaskError,
  DeterministicProvider,
  buildAgentTaskSpec,
  validateAgentTaskOutput,
  type AgentIrFragment,
  type AgentProvider,
  type AgentTaskOutput,
  type AgentTaskSpec,
} from "../src/index.js";

const IR_FRAGMENT: AgentIrFragment = {
  fragment_hash: "sha256:frag",
  entity_ids: ["model:Post"],
  body: { id: "model:Post", kind: "model", name: "Post" },
};

function modelAction(overrides: Partial<SyncPlanActionV1> = {}): SyncPlanActionV1 {
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
    ...overrides,
  };
}

function spec(overrides: Partial<Parameters<typeof buildAgentTaskSpec>[0]> = {}): AgentTaskSpec {
  return buildAgentTaskSpec({
    role: "schema",
    action: modelAction(),
    diffs: [],
    irFragment: IR_FRAGMENT,
    allowedPaths: ["src/models/Post.ts", "src/validators/Post.ts"],
    forbiddenPaths: ["node_modules/**", ".git/**", "src/custom/**"],
    intentSummary: "add Post.visibility",
    ...overrides,
  });
}

/** A provider that returns whatever output the test hands it (for negatives). */
class CannedProvider implements AgentProvider {
  readonly id = "canned";
  constructor(private readonly make: (s: AgentTaskSpec) => AgentTaskOutput) {}
  async run(s: AgentTaskSpec): Promise<AgentTaskOutput> {
    return this.make(s);
  }
}

describe("M13 agent task protocol", () => {
  it("deterministic provider satisfies one planned generated-file task", async () => {
    const orch = new AgentOrchestrator({ provider: new DeterministicProvider() });
    const result = await orch.runTask(spec());
    expect(result.record.outcome).toBe("ok");
    expect(result.output.patches).toHaveLength(1);
    expect(result.output.patches[0]!.path).toBe("src/models/Post.ts");
    expect(result.output.patches[0]!.kind).toBe("rewrite_whole_file");
  });

  it("independently verifies a string_present acceptance criterion against patch content", async () => {
    const orch = new AgentOrchestrator({ provider: new DeterministicProvider() });
    const result = await orch.runTask(
      spec({
        acceptanceCriteria: [
          {
            id: "c1",
            description: "patch references the model entity",
            check: { kind: "string_present", path: "src/models/Post.ts", substring: "model:Post" },
          },
        ],
      }),
    );
    expect(result.record.outcome).toBe("ok");
  });

  it("rejects a patch that writes outside the allowlist", async () => {
    const provider = new CannedProvider((s) => ({
      schema_version: "arch.agent.output.v1",
      task_id: s.task_id,
      action_id: s.action_id,
      artifact_id: s.artifact_id,
      patches: [{ kind: "rewrite_whole_file", path: "src/runtime/db.ts", content: "x" }],
      satisfied_criteria: [],
    }));
    await expect(new AgentOrchestrator({ provider }).runTask(spec())).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("rejects a patch that escapes the repo root", async () => {
    const provider = new CannedProvider((s) => ({
      schema_version: "arch.agent.output.v1",
      task_id: s.task_id,
      action_id: s.action_id,
      artifact_id: s.artifact_id,
      patches: [{ kind: "rewrite_whole_file", path: "../../etc/passwd", content: "x" }],
      satisfied_criteria: [],
    }));
    const v = validateAgentTaskOutput(spec(), await provider.run(spec()));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/escapes repo root/);
  });

  it("rejects a patch targeting a forbidden path (human-owned src/custom)", async () => {
    const provider = new CannedProvider((s) => ({
      schema_version: "arch.agent.output.v1",
      task_id: s.task_id,
      action_id: s.action_id,
      artifact_id: s.artifact_id,
      patches: [{ kind: "rewrite_whole_file", path: "src/custom/handler.ts", content: "x" }],
      satisfied_criteria: [],
    }));
    const v = validateAgentTaskOutput(spec(), await provider.run(spec()));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/forbidden glob/);
  });

  it("rejects writing a human-owned (write_scope=none) artifact", async () => {
    const humanSpec = spec({
      action: modelAction({
        ownership: {
          ownership_id: "own.custom",
          ownership_kind: "human_file",
          write_scope: "none",
          owner: "human",
        },
      }),
    });
    const out = await new DeterministicProvider().run(humanSpec);
    const v = validateAgentTaskOutput(humanSpec, out);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/write_scope=none forbids/);
  });

  it("rejects a whole-file op on a stub_only artifact", async () => {
    const stubSpec = spec({
      action: modelAction({
        kind: "rewrite_whole_file",
        ownership: {
          ownership_id: "own.stub",
          ownership_kind: "extension_point",
          write_scope: "stub_only",
          owner: "arch",
        },
      }),
    });
    const out = await new DeterministicProvider().run(stubSpec);
    const v = validateAgentTaskOutput(stubSpec, out);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/stub_only/);
  });

  it("rejects a region patch missing its marker id", async () => {
    const regionSpec = spec({
      action: modelAction({
        kind: "patch_generated_region",
        ownership: {
          ownership_id: "own.region",
          ownership_kind: "generated_region",
          write_scope: "generated_region",
          owner: "arch",
        },
      }),
    });
    const provider = new CannedProvider((s) => ({
      schema_version: "arch.agent.output.v1",
      task_id: s.task_id,
      action_id: s.action_id,
      artifact_id: s.artifact_id,
      patches: [{ kind: "patch_generated_region", path: "src/models/Post.ts", region_marker_id: "", content: "x" }],
      satisfied_criteria: [],
    }));
    const v = validateAgentTaskOutput(regionSpec, await provider.run(regionSpec));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/region_marker_id/);
  });

  it("stops after max_attempts when the provider keeps producing invalid output", async () => {
    let calls = 0;
    const provider = new CannedProvider((s) => {
      calls++;
      return {
        schema_version: "arch.agent.output.v1",
        task_id: s.task_id,
        action_id: s.action_id,
        artifact_id: s.artifact_id,
        patches: [{ kind: "rewrite_whole_file", path: "node_modules/evil.ts", content: "x" }],
        satisfied_criteria: [],
      };
    });
    const budgetSpec = spec({ budget: { max_wall_clock_seconds: 5, max_attempts: 3 } });
    await expect(new AgentOrchestrator({ provider }).runTask(budgetSpec)).rejects.toBeInstanceOf(AgentTaskError);
    expect(calls).toBe(3);
  });

  it("fails the task when a content acceptance criterion is not met", async () => {
    const provider = new CannedProvider((s) => ({
      schema_version: "arch.agent.output.v1",
      task_id: s.task_id,
      action_id: s.action_id,
      artifact_id: s.artifact_id,
      patches: [{ kind: "rewrite_whole_file", path: "src/models/Post.ts", content: "// nothing useful" }],
      satisfied_criteria: ["c1"], // the agent CLAIMS it — orchestrator must not trust it
    }));
    const critSpec = spec({
      acceptanceCriteria: [
        { id: "c1", description: "must mention entity", check: { kind: "string_present", path: "src/models/Post.ts", substring: "model:Post" } },
      ],
    });
    await expect(new AgentOrchestrator({ provider }).runTask(critSpec)).rejects.toThrowError(/criteria_failed|c1/);
  });
});
