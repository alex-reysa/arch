import { describe, expect, it } from "vitest";
import {
  buildLiveAgentInvocation,
  runLiveAgent,
  spawnLiveAgentTransport,
  type LiveAgentProcessResult,
  type LiveAgentTransport,
} from "../src/llm/agent-runner.js";

function transportReturning(res: Partial<LiveAgentProcessResult>): {
  transport: LiveAgentTransport;
  calls: { args: readonly string[]; cwd: string; stdin: string }[];
} {
  const calls: { args: readonly string[]; cwd: string; stdin: string }[] = [];
  const transport: LiveAgentTransport = async (args, opts) => {
    calls.push({ args, cwd: opts.cwd, stdin: opts.stdin });
    return { code: 0, stdout: "", stderr: "", ...res };
  };
  return { transport, calls };
}

describe("buildLiveAgentInvocation", () => {
  it("builds Grok Build headless edit args", () => {
    const invocation = buildLiveAgentInvocation({
      provider: "grok-build",
      cwd: "/tmp/project",
      prompt: "add priority",
      model: "grok-build",
      appendSystemPrompt: "Do not edit src/custom/**",
    });
    expect(invocation.stdin).toBe("");
    expect(invocation.args).toEqual([
      "-p",
      "add priority",
      "--cwd",
      "/tmp/project",
      "--output-format",
      "json",
      "--permission-mode",
      "bypassPermissions",
      "--always-approve",
      "--disable-web-search",
      "--model",
      "grok-build",
      "--rules",
      "Do not edit src/custom/**",
    ]);
  });

  it("builds Cursor Composer headless edit args and embeds broad constraints in the prompt", () => {
    const invocation = buildLiveAgentInvocation({
      provider: "cursor-composer",
      cwd: "/tmp/project",
      prompt: "add priority",
      model: "composer-2.5",
      appendSystemPrompt: "Do not edit src/custom/**",
    });
    expect(invocation.stdin).toBe("");
    expect(invocation.args.slice(0, 11)).toEqual([
      "-p",
      "--output-format",
      "json",
      "--trust",
      "--force",
      "--sandbox",
      "disabled",
      "--workspace",
      "/tmp/project",
      "--model",
      "composer-2.5",
    ]);
    const prompt = invocation.args.at(-1);
    expect(prompt).toContain("Do not edit src/custom/**");
    expect(prompt).toContain("add priority");
  });
});

describe("runLiveAgent", () => {
  it("parses Grok JSON output with subscription billing metadata", async () => {
    const { transport } = transportReturning({
      code: 0,
      stdout: JSON.stringify({ result: "done", session_id: "grok-session", model: "grok-build" }),
    });
    const out = await runLiveAgent(
      { provider: "grok-build", cwd: "/tmp/project", prompt: "p", model: "grok-build" },
      transport,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toBe("done");
      expect(out.llm).toEqual({
        provider: "grok-build",
        model: "grok-build",
        sessionId: "grok-session",
        billingMode: "subscription",
      });
    }
  });

  it("accepts Composer text output when JSON is unavailable", async () => {
    const { transport } = transportReturning({ code: 0, stdout: "I updated the files." });
    const out = await runLiveAgent(
      { provider: "cursor-composer", cwd: "/tmp/project", prompt: "p", model: "composer-2.5" },
      transport,
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.text).toBe("I updated the files.");
      expect(out.llm.provider).toBe("cursor-composer");
      expect(out.llm.model).toBe("composer-2.5");
      expect(out.llm.billingMode).toBe("subscription");
    }
  });

  it("keeps Claude JSON parsing strict", async () => {
    const { transport } = transportReturning({ code: 0, stdout: "plain text" });
    const out = await runLiveAgent(
      { provider: "claude-code", cwd: "/tmp/project", prompt: "p", model: "sonnet" },
      transport,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain("did not return JSON");
  });
});

describe("spawnLiveAgentTransport", () => {
  it("fails closed when the provider process cannot spawn", async () => {
    const transport = spawnLiveAgentTransport("/definitely/not/a/live-agent");
    const res = await transport([], { cwd: process.cwd(), stdin: "" });
    expect(res.code).toBe(127);
    expect(res.stderr).toMatch(/spawn error/i);
  });

  it("times out hung provider processes", async () => {
    const transport = spawnLiveAgentTransport(process.execPath, { timeoutMs: 50 });
    const res = await transport(["-e", "setTimeout(() => {}, 10_000)"], {
      cwd: process.cwd(),
      stdin: "",
    });
    expect(res.code).toBe(124);
    expect(res.stderr).toMatch(/timed out/i);
  });
});
