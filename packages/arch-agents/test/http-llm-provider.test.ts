import { describe, expect, it } from "vitest";
import type { SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  AgentTaskError,
  HttpLlmProvider,
  buildAgentTaskSpec,
  providerFromEnv,
  type AgentIrFragment,
  type AgentTaskSpec,
  type LlmTransport,
} from "../src/index.js";

const IR_FRAGMENT: AgentIrFragment = {
  fragment_hash: "sha256:frag",
  entity_ids: ["model:Post"],
  body: { id: "model:Post", kind: "model", name: "Post" },
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

function spec(overrides: Partial<Parameters<typeof buildAgentTaskSpec>[0]> = {}): AgentTaskSpec {
  return buildAgentTaskSpec({
    role: "schema",
    action: action(),
    diffs: [],
    irFragment: IR_FRAGMENT,
    allowedPaths: ["src/models/Post.ts"],
    forbiddenPaths: ["node_modules/**", ".git/**", "src/custom/**"],
    intentSummary: "add Post.visibility",
    ...overrides,
  });
}

describe("HttpLlmProvider", () => {
  it("parses a model's JSON output and passes the apply/agent boundary through the orchestrator", async () => {
    const transport: LlmTransport = async () =>
      JSON.stringify({
        patches: [{ kind: "rewrite_whole_file", path: "src/models/Post.ts", content: "// model:Post\n" }],
        satisfied_criteria: [],
        notes: "done",
      });
    const provider = new HttpLlmProvider({ model: "test-model-1", transport });
    const result = await new AgentOrchestrator({ provider }).runTask(spec());
    expect(result.record.outcome).toBe("ok");
    expect(result.record.provider_id).toBe("http-llm");
    expect(result.record.model_id).toBe("test-model-1");
    expect(result.output.patches).toHaveLength(1);
    expect(result.output.patches[0]!.path).toBe("src/models/Post.ts");
  });

  it("tolerates a model that wraps its JSON in a markdown code fence", async () => {
    const transport: LlmTransport = async () =>
      "Here is the patch:\n```json\n" +
      JSON.stringify({
        patches: [{ kind: "rewrite_whole_file", path: "src/models/Post.ts", content: "// model:Post\n" }],
        satisfied_criteria: [],
      }) +
      "\n```\n";
    const provider = new HttpLlmProvider({ model: "m", transport });
    const result = await new AgentOrchestrator({ provider }).runTask(spec());
    expect(result.record.outcome).toBe("ok");
  });

  it("cannot widen its own permissions: an out-of-allowlist path is rejected by the orchestrator", async () => {
    const transport: LlmTransport = async () =>
      JSON.stringify({
        patches: [{ kind: "rewrite_whole_file", path: "node_modules/evil.ts", content: "pwn" }],
        satisfied_criteria: [],
      });
    const provider = new HttpLlmProvider({ model: "m", transport });
    await expect(new AgentOrchestrator({ provider }).runTask(spec())).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("cannot modify a human-owned (write_scope=none) artifact even with a plausible patch", async () => {
    const transport: LlmTransport = async () =>
      JSON.stringify({
        patches: [{ kind: "rewrite_whole_file", path: "src/models/Post.ts", content: "// model:Post\n" }],
        satisfied_criteria: [],
      });
    const provider = new HttpLlmProvider({ model: "m", transport });
    const humanSpec = spec({
      action: {
        ...action(),
        ownership: {
          ownership_id: "own.human",
          ownership_kind: "human_file",
          write_scope: "none",
          owner: "human",
        },
      },
    });
    await expect(new AgentOrchestrator({ provider }).runTask(humanSpec)).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("records a provider_error (not a crash) when the model returns unparseable output", async () => {
    let calls = 0;
    const transport: LlmTransport = async () => {
      calls++;
      return "I cannot help with that.";
    };
    const provider = new HttpLlmProvider({ model: "m", transport });
    const s = spec({ budget: { max_wall_clock_seconds: 5, max_attempts: 2 } });
    try {
      await new AgentOrchestrator({ provider }).runTask(s);
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(AgentTaskError);
      expect((e as AgentTaskError).record.outcome).toBe("provider_error");
    }
    expect(calls).toBe(2);
  });

  it("is disabled by default: run() refuses without an API key and no injected transport", async () => {
    const provider = new HttpLlmProvider({ model: "m" });
    expect(provider.enabled).toBe(false);
    await expect(provider.run(spec())).rejects.toThrow(/disabled|ARCH_LLM_API_KEY/i);
  });

  it("is enabled when an API key is configured", () => {
    const provider = new HttpLlmProvider({ model: "m", apiKey: "sk-test-key" });
    expect(provider.enabled).toBe(true);
  });
});

describe("providerFromEnv", () => {
  it("returns the deterministic provider when no LLM env is configured", () => {
    const p = providerFromEnv({});
    expect(p.id).toBe("deterministic");
  });

  it("returns an enabled HttpLlmProvider when ARCH_LLM_API_KEY is set", () => {
    const p = providerFromEnv({ ARCH_LLM_API_KEY: "sk-x", ARCH_LLM_MODEL: "claude-test" });
    expect(p.id).toBe("http-llm");
    expect(p.model_id).toBe("claude-test");
    expect(p.enabled).toBe(true);
  });
});
