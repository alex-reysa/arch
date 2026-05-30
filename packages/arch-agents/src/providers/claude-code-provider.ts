import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProvider } from "./llm-provider-interface.js";
import type { AgentTaskSpec, AgentTaskOutput } from "../agent-task.js";
import { buildAgentPrompt, parseAgentPatches, ProviderOutputError } from "./output-parsing.js";

/**
 * An `AgentProvider` backed by Claude Code (`claude -p`).
 *
 * It is constrained by exactly the same task protocol as every other provider:
 *   - it receives ONLY an `AgentTaskSpec`-shaped prompt (the canonical IR
 *     fragment + allowlist + ownership), never `.arch` source;
 *   - it must return ONLY an `AgentTaskOutput`-shaped JSON patch set;
 *   - the `AgentOrchestrator` re-validates that output before any write, so the
 *     model can never widen its allowlist, touch human-owned files, escape the
 *     repo root, or mark verification passed.
 *
 * Defense in depth on the subprocess itself:
 *   - tools are DISABLED (`--allowed-tools ""`), so `claude -p` can only emit
 *     text — it cannot use file/edit/bash tools;
 *   - it runs in an isolated throwaway temp `cwd`, so even a misbehaving run has
 *     nothing of the real project to touch;
 *   - only stdout JSON is read. All real writes happen later, through Arch's
 *     validated apply pipeline.
 *
 * `runner` is injectable so tests drive a deterministic "model" with no
 * subprocess; the default runner spawns the real `claude` binary.
 */

export interface ClaudeRunRequest {
  readonly system: string;
  readonly user: string;
  readonly model?: string;
  /** Isolated working directory for the subprocess. */
  readonly cwd: string;
}

export interface ClaudeRunResult {
  /** The assistant's raw text reply (the AgentTaskOutput JSON, possibly fenced). */
  readonly text: string;
  readonly costUsd?: number;
  readonly sessionId?: string;
  readonly model?: string;
}

export type ClaudeRunner = (req: ClaudeRunRequest) => Promise<ClaudeRunResult>;

export interface ClaudeCodeProviderConfig {
  /** Optional model override (`--model`); otherwise the CLI session default. */
  readonly model?: string;
  /** Inject to avoid spawning a subprocess (tests). */
  readonly runner?: ClaudeRunner;
  /** Override the `claude` binary path. */
  readonly bin?: string;
  readonly id?: string;
}

export class ClaudeCodeProvider implements AgentProvider {
  readonly id: string;
  readonly model_id: string;
  readonly enabled = true;
  private readonly runner: ClaudeRunner;
  private readonly model: string | undefined;

  constructor(config: ClaudeCodeProviderConfig = {}) {
    this.id = config.id ?? "claude-code";
    this.model = config.model;
    this.model_id = config.model ?? "claude-code";
    this.runner = config.runner ?? spawnClaudeRunner(config.bin);
  }

  async run(spec: AgentTaskSpec): Promise<AgentTaskOutput> {
    const prompt = buildAgentPrompt(spec);
    const cwd = await mkdtemp(join(tmpdir(), "arch-claude-"));
    try {
      const res = await this.runner({
        system: prompt.system,
        user: prompt.user,
        ...(this.model !== undefined ? { model: this.model } : {}),
        cwd,
      });
      const patches = parseAgentPatches(res.text);
      const noteParts = ["claude-code"];
      if (res.sessionId) noteParts.push(`session=${res.sessionId}`);
      if (res.costUsd != null) noteParts.push(`cost_usd=${res.costUsd}`);
      // Identity fields are stamped from the spec, never the model.
      return {
        schema_version: "arch.agent.output.v1",
        task_id: spec.task_id,
        action_id: spec.action_id,
        artifact_id: spec.artifact_id,
        patches,
        satisfied_criteria: [],
        notes: noteParts.join(" "),
      };
    } finally {
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * The constrained `claude -p` argv. Print mode + JSON output + DISABLED tools +
 * the constrained system prompt. The user prompt is delivered on stdin, never
 * as an argv entry.
 */
export function buildClaudeArgs(config: { readonly model?: string }, req: { readonly system: string }): string[] {
  const args = ["-p", "--output-format", "json", "--allowed-tools", ""];
  if (config.model) args.push("--model", config.model);
  args.push("--append-system-prompt", req.system);
  return args;
}

/** Parse a `claude -p --output-format json` envelope into a run result. */
export function parseClaudeEnvelope(stdout: string): ClaudeRunResult {
  let env: Record<string, unknown>;
  try {
    env = JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    throw new ProviderOutputError("claude -p did not return JSON on stdout");
  }
  if (env.is_error === true || env.type !== "result" || typeof env.result !== "string") {
    throw new ProviderOutputError(
      `claude -p returned an error envelope: ${String(env.result ?? env.subtype ?? "unknown")}`,
    );
  }
  const modelUsage = env.modelUsage as Record<string, unknown> | undefined;
  const model = modelUsage ? Object.keys(modelUsage)[0] : undefined;
  const result: ClaudeRunResult = {
    text: env.result,
    ...(typeof env.total_cost_usd === "number" ? { costUsd: env.total_cost_usd } : {}),
    ...(typeof env.session_id === "string" ? { sessionId: env.session_id } : {}),
    ...(model !== undefined ? { model } : {}),
  };
  return result;
}

function spawnClaudeRunner(bin = "claude"): ClaudeRunner {
  return (req) =>
    new Promise<ClaudeRunResult>((resolve, reject) => {
      const child = spawn(bin, buildClaudeArgs(req.model !== undefined ? { model: req.model } : {}, req), {
        cwd: req.cwd,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("error", (err) => {
        reject(new ProviderOutputError(`failed to spawn ${bin}: ${err.message}`));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new ProviderOutputError(`claude -p exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        try {
          resolve(parseClaudeEnvelope(stdout));
        } catch (err) {
          reject(err);
        }
      });
      child.stdin.write(req.user);
      child.stdin.end();
    });
}
