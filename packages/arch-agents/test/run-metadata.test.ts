import { describe, expect, it } from "vitest";
import type { SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  AgentTaskError,
  buildAgentTaskSpec,
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
    allowedPaths: ["src/models/Post.ts"],
    forbiddenPaths: ["node_modules/**", ".git/**", "src/custom/**"],
    intentSummary: "add Post.visibility",
    ...overrides,
  });
}

function validOutput(s: AgentTaskSpec): AgentTaskOutput {
  return {
    schema_version: "arch.agent.output.v1",
    task_id: s.task_id,
    action_id: s.action_id,
    artifact_id: s.artifact_id,
    patches: [{ kind: "rewrite_whole_file", path: s.action.path, content: "// model:Post\n" }],
    satisfied_criteria: [],
  };
}

/** A provider that declares a model id, mimicking a real LLM-backed adapter. */
class MockLlmProvider implements AgentProvider {
  readonly id = "mock-llm";
  readonly model_id = "mock-model-2026";
  readonly enabled = true;
  constructor(private readonly make: (s: AgentTaskSpec) => AgentTaskOutput) {}
  async run(s: AgentTaskSpec): Promise<AgentTaskOutput> {
    return this.make(s);
  }
}

describe("agent run metadata", () => {
  it("records provider id, model id, task hash, ir fragment hash, and validation result on success", async () => {
    const provider = new MockLlmProvider(validOutput);
    const s = spec();
    const result = await new AgentOrchestrator({ provider }).runTask(s);
    const r = result.record;
    expect(r.provider_id).toBe("mock-llm");
    expect(r.model_id).toBe("mock-model-2026");
    expect(r.task_id).toBe(s.task_id);
    expect(r.action_id).toBe(s.action_id);
    expect(r.artifact_id).toBe(s.artifact_id);
    expect(r.ir_fragment_hash).toBe("sha256:frag");
    expect(r.task_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.attempts).toBe(1);
    expect(r.outcome).toBe("ok");
    expect(r.output_validation.ok).toBe(true);
    expect(r.output_validation.errors).toEqual([]);
  });

  it("computes a stable task hash for the same spec across runs", async () => {
    const provider = new MockLlmProvider(validOutput);
    const s = spec();
    const a = await new AgentOrchestrator({ provider }).runTask(s);
    const b = await new AgentOrchestrator({ provider }).runTask(s);
    expect(a.record.task_hash).toBe(b.record.task_hash);
  });

  it("falls back to a model id of 'none' when the provider declares no model", async () => {
    const provider: AgentProvider = {
      id: "no-model",
      enabled: true,
      run: async (s) => validOutput(s),
    };
    const result = await new AgentOrchestrator({ provider }).runTask(spec());
    expect(result.record.model_id).toBe("none");
  });

  it("preserves metadata and structured validation on the error record when output is rejected", async () => {
    const provider = new MockLlmProvider((s) => ({
      schema_version: "arch.agent.output.v1",
      task_id: s.task_id,
      action_id: s.action_id,
      artifact_id: s.artifact_id,
      patches: [{ kind: "rewrite_whole_file", path: "node_modules/evil.ts", content: "x" }],
      satisfied_criteria: [],
    }));
    await expect(new AgentOrchestrator({ provider }).runTask(spec())).rejects.toBeInstanceOf(AgentTaskError);
    try {
      await new AgentOrchestrator({ provider }).runTask(spec());
    } catch (e) {
      const r = (e as AgentTaskError).record;
      expect(r.model_id).toBe("mock-model-2026");
      expect(r.task_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.ir_fragment_hash).toBe("sha256:frag");
      expect(r.outcome).toBe("validation_failed");
      expect(r.output_validation.ok).toBe(false);
      expect(r.output_validation.errors.length).toBeGreaterThan(0);
    }
  });

  it("treats a provider that throws as a failed attempt, not a crash", async () => {
    let calls = 0;
    const provider: AgentProvider = {
      id: "flaky-llm",
      model_id: "m",
      enabled: true,
      run: async () => {
        calls++;
        throw new Error("model timeout");
      },
    };
    const s = spec({ budget: { max_wall_clock_seconds: 5, max_attempts: 2 } });
    await expect(new AgentOrchestrator({ provider }).runTask(s)).rejects.toBeInstanceOf(AgentTaskError);
    expect(calls).toBe(2);
  });
});
