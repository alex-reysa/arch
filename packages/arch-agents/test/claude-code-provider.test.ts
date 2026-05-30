import { describe, expect, it } from "vitest";
import type { SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  AgentTaskError,
  ClaudeCodeProvider,
  buildClaudeArgs,
  parseClaudeEnvelope,
  buildAgentTaskSpec,
  type AgentIrFragment,
  type AgentTaskSpec,
  type ClaudeRunner,
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
    intentSummary: "regenerate the Post model",
    ...overrides,
  });
}

const VALID_REPLY = JSON.stringify({
  patches: [{ kind: "rewrite_whole_file", path: "src/models/Post.ts", content: "// model:Post\n" }],
  notes: "ok",
});

// A real `claude -p --output-format json` envelope (captured shape).
const REAL_ENVELOPE = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: VALID_REPLY,
  session_id: "abc-123",
  total_cost_usd: 0.0123,
  modelUsage: { "claude-opus-4-8[1m]": { inputTokens: 10, outputTokens: 5 } },
});

describe("ClaudeCodeProvider", () => {
  it("turns a valid `claude -p` reply into output that passes the orchestrator boundary", async () => {
    const runner: ClaudeRunner = async () => ({ text: VALID_REPLY, sessionId: "s1", costUsd: 0.01 });
    const provider = new ClaudeCodeProvider({ runner, model: "claude-opus-4-8" });
    const result = await new AgentOrchestrator({ provider }).runTask(spec());
    expect(result.record.outcome).toBe("ok");
    expect(result.record.provider_id).toBe("claude-code");
    expect(result.record.model_id).toBe("claude-opus-4-8");
    expect(result.output.patches).toHaveLength(1);
    expect(result.output.patches[0]!.path).toBe("src/models/Post.ts");
    expect(result.output.notes ?? "").toContain("claude-code");
  });

  it("runs the model in an isolated cwd, not the project directory", async () => {
    let seenCwd = "";
    const runner: ClaudeRunner = async (req) => {
      seenCwd = req.cwd;
      return { text: VALID_REPLY };
    };
    await new AgentOrchestrator({ provider: new ClaudeCodeProvider({ runner }) }).runTask(spec());
    expect(seenCwd).toBeTruthy();
    expect(seenCwd).not.toBe(process.cwd());
  });

  it("cannot widen its own permissions: a malicious out-of-allowlist reply is rejected by the orchestrator", async () => {
    const malicious = JSON.stringify({
      patches: [{ kind: "rewrite_whole_file", path: "node_modules/evil.ts", content: "pwn" }],
    });
    const runner: ClaudeRunner = async () => ({ text: malicious });
    const provider = new ClaudeCodeProvider({ runner });
    await expect(new AgentOrchestrator({ provider }).runTask(spec())).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("cannot escape the repo root", async () => {
    const escape = JSON.stringify({
      patches: [{ kind: "rewrite_whole_file", path: "../../etc/passwd", content: "x" }],
    });
    const runner: ClaudeRunner = async () => ({ text: escape });
    await expect(
      new AgentOrchestrator({ provider: new ClaudeCodeProvider({ runner }) }).runTask(spec()),
    ).rejects.toBeInstanceOf(AgentTaskError);
  });

  it("records a provider_error (not a crash) when the model returns unparseable text", async () => {
    const runner: ClaudeRunner = async () => ({ text: "I cannot help with that." });
    const s = spec({ budget: { max_wall_clock_seconds: 5, max_attempts: 2 } });
    try {
      await new AgentOrchestrator({ provider: new ClaudeCodeProvider({ runner }) }).runTask(s);
      throw new Error("expected rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(AgentTaskError);
      expect((e as AgentTaskError).record.outcome).toBe("provider_error");
    }
  });
});

describe("claude -p invocation shape", () => {
  it("builds constrained CLI args: print mode, json output, tools disabled, system prompt", () => {
    const args = buildClaudeArgs({ model: "claude-opus-4-8" }, { system: "SYS", user: "USR", cwd: "/tmp/x" });
    expect(args).toContain("-p");
    expect(args.join(" ")).toContain("--output-format json");
    // tools are disabled (empty allowlist) so the model can only produce text.
    expect(args.join(" ")).toContain("--allowed-tools");
    expect(args).toContain("--model");
    expect(args).toContain("claude-opus-4-8");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("SYS");
    // The user prompt is delivered on stdin, never as an argv entry.
    expect(args).not.toContain("USR");
  });

  it("omits --model when none is configured", () => {
    const args = buildClaudeArgs({}, { system: "SYS", user: "USR", cwd: "/tmp/x" });
    expect(args).not.toContain("--model");
  });
});

describe("parseClaudeEnvelope", () => {
  it("extracts the result text, cost, and session from a real json envelope", () => {
    const out = parseClaudeEnvelope(REAL_ENVELOPE);
    expect(out.text).toBe(VALID_REPLY);
    expect(out.costUsd).toBeCloseTo(0.0123);
    expect(out.sessionId).toBe("abc-123");
    expect(out.model).toBe("claude-opus-4-8[1m]");
  });

  it("throws on an error envelope", () => {
    const errEnv = JSON.stringify({ type: "result", is_error: true, result: "boom" });
    expect(() => parseClaudeEnvelope(errEnv)).toThrow();
  });
});
