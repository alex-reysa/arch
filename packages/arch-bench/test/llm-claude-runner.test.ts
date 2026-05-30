import { describe, it, expect } from "vitest";
import {
  buildBenchClaudeArgs,
  runClaude,
  type ClaudeTransport,
  type ClaudeProcessResult,
} from "../src/llm/claude-runner.js";

function envelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "I added the field and updated the model.",
    session_id: "sess-9",
    total_cost_usd: 0.0345,
    modelUsage: { "claude-opus-4-8": { inputTokens: 100, outputTokens: 40 } },
    ...over,
  });
}

function transportReturning(res: Partial<ClaudeProcessResult>): {
  transport: ClaudeTransport;
  calls: { args: readonly string[]; cwd: string; stdin: string }[];
} {
  const calls: { args: readonly string[]; cwd: string; stdin: string }[] = [];
  const transport: ClaudeTransport = async (args, opts) => {
    calls.push({ args, cwd: opts.cwd, stdin: opts.stdin });
    return { code: 0, stdout: "", stderr: "", ...res };
  };
  return { transport, calls };
}

describe("buildBenchClaudeArgs", () => {
  it("uses print mode + json output and skips permissions by default", () => {
    const args = buildBenchClaudeArgs({ cwd: "/tmp/x", prompt: "do it" });
    expect(args).toContain("-p");
    expect(args.join(" ")).toContain("--output-format json");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("includes the model and append-system-prompt when provided", () => {
    const args = buildBenchClaudeArgs({
      cwd: "/tmp/x",
      prompt: "do it",
      model: "claude-opus-4-8",
      appendSystemPrompt: "Do not edit src/custom/**",
    });
    const i = args.indexOf("--model");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("claude-opus-4-8");
    const j = args.indexOf("--append-system-prompt");
    expect(j).toBeGreaterThanOrEqual(0);
    expect(args[j + 1]).toBe("Do not edit src/custom/**");
  });

  it("restricts tools only when allowedTools is set", () => {
    expect(buildBenchClaudeArgs({ cwd: "/x", prompt: "p" })).not.toContain("--allowed-tools");
    const args = buildBenchClaudeArgs({ cwd: "/x", prompt: "p", allowedTools: "Edit Write Read" });
    const k = args.indexOf("--allowed-tools");
    expect(args[k + 1]).toBe("Edit Write Read");
  });
});

describe("runClaude", () => {
  it("passes the prompt on stdin and runs in the requested cwd", async () => {
    const { transport, calls } = transportReturning({ code: 0, stdout: envelope() });
    await runClaude({ cwd: "/tmp/proj", prompt: "add a priority field" }, transport);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe("/tmp/proj");
    expect(calls[0]?.stdin).toBe("add a priority field");
  });

  it("records cost and session metadata from a successful envelope", async () => {
    const { transport } = transportReturning({ code: 0, stdout: envelope() });
    const out = await runClaude({ cwd: "/tmp/proj", prompt: "p" }, transport);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toContain("added the field");
      expect(out.costUsd).toBeCloseTo(0.0345);
      expect(out.sessionId).toBe("sess-9");
      expect(out.model).toBe("claude-opus-4-8");
    }
  });

  it("handles an error envelope without throwing", async () => {
    const { transport } = transportReturning({
      code: 0,
      stdout: envelope({ is_error: true, subtype: "error_max_turns", result: "hit the limit" }),
    });
    const out = await runClaude({ cwd: "/tmp/proj", prompt: "p" }, transport);
    expect(out.ok).toBe(false);
  });

  it("handles unparseable stdout without throwing", async () => {
    const { transport } = transportReturning({ code: 0, stdout: "not json at all" });
    const out = await runClaude({ cwd: "/tmp/proj", prompt: "p" }, transport);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.raw).toBe("not json at all");
  });

  it("handles a non-zero exit code", async () => {
    const { transport } = transportReturning({ code: 1, stdout: "", stderr: "claude crashed" });
    const out = await runClaude({ cwd: "/tmp/proj", prompt: "p" }, transport);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.exitCode).toBe(1);
      expect(out.error).toContain("claude crashed");
    }
  });
});
