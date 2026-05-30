/**
 * Provider-neutral live coding-agent runner used by the benchmark baselines.
 * Each provider still gets provider-specific CLI arguments and output parsing,
 * but the benchmark consumes one normalized outcome shape.
 */

import { spawn } from "node:child_process";
import type { BillingMode, LlmMetadata, LlmProvider } from "../report/results.js";

export type LiveAgentProvider = LlmProvider;

export interface LiveAgentRequest {
  readonly provider: LiveAgentProvider;
  readonly cwd: string;
  readonly prompt: string;
  /** Constraints appended to the system prompt / rules for broad baselines. */
  readonly appendSystemPrompt?: string;
  readonly model?: string;
  /** Claude-only: restrict tools when needed. */
  readonly allowedTools?: string;
  /** Claude-only default true: pass `--dangerously-skip-permissions`. */
  readonly skipPermissions?: boolean;
}

export interface LiveAgentInvocation {
  readonly args: readonly string[];
  readonly stdin: string;
}

export interface LiveAgentProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type LiveAgentTransport = (
  args: readonly string[],
  opts: { readonly cwd: string; readonly stdin: string },
) => Promise<LiveAgentProcessResult>;

export type LiveAgentOutcome =
  | {
      readonly ok: true;
      readonly text: string;
      readonly raw: string;
      readonly exitCode: number;
      readonly llm: LlmMetadata;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly raw: string;
      readonly exitCode: number;
      readonly llm: LlmMetadata;
    };

export function buildLiveAgentInvocation(req: LiveAgentRequest): LiveAgentInvocation {
  if (req.provider === "claude-code") {
    const args: string[] = ["-p", "--output-format", "json"];
    if (req.skipPermissions !== false) args.push("--dangerously-skip-permissions");
    if (req.model) args.push("--model", req.model);
    if (req.allowedTools) args.push("--allowed-tools", req.allowedTools);
    if (req.appendSystemPrompt) args.push("--append-system-prompt", req.appendSystemPrompt);
    return { args, stdin: req.prompt };
  }

  if (req.provider === "grok-build") {
    const args: string[] = [
      "-p",
      req.prompt,
      "--cwd",
      req.cwd,
      "--output-format",
      "json",
      "--permission-mode",
      "bypassPermissions",
      "--always-approve",
      "--disable-web-search",
    ];
    if (req.model) args.push("--model", req.model);
    if (req.appendSystemPrompt) args.push("--rules", req.appendSystemPrompt);
    return { args, stdin: "" };
  }

  const prompt = req.appendSystemPrompt
    ? `${req.appendSystemPrompt}\n\nUser task:\n${req.prompt}`
    : req.prompt;
  const args: string[] = [
    "-p",
    "--output-format",
    "json",
    "--trust",
    "--force",
    "--sandbox",
    "disabled",
    "--workspace",
    req.cwd,
  ];
  if (req.model) args.push("--model", req.model);
  args.push(prompt);
  return { args, stdin: "" };
}

export function buildLiveAgentArgs(req: LiveAgentRequest): string[] {
  return [...buildLiveAgentInvocation(req).args];
}

export async function runLiveAgent(
  req: LiveAgentRequest,
  transport: LiveAgentTransport,
): Promise<LiveAgentOutcome> {
  const invocation = buildLiveAgentInvocation(req);
  const res = await transport(invocation.args, { cwd: req.cwd, stdin: invocation.stdin });
  const base = baseMetadata(req);

  if (res.code !== 0) {
    const detail = res.stderr.trim() || `${label(req.provider)} exited with code ${res.code}`;
    return { ok: false, error: detail, raw: res.stdout, exitCode: res.code, llm: base };
  }

  const raw = res.stdout;
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${label(req.provider)} returned empty stdout`, raw, exitCode: res.code, llm: base };
  }

  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    if (req.provider === "claude-code") {
      return {
        ok: false,
        error: "claude -p did not return JSON on stdout",
        raw,
        exitCode: res.code,
        llm: base,
      };
    }
    return { ok: true, text: trimmed, raw, exitCode: res.code, llm: base };
  }

  if (req.provider === "claude-code" && (parsed["is_error"] === true || parsed["type"] !== "result" || typeof parsed["result"] !== "string")) {
    const reason = String(parsed["result"] ?? parsed["subtype"] ?? "unknown");
    return {
      ok: false,
      error: `claude -p returned an error envelope: ${reason}`,
      raw,
      exitCode: res.code,
      llm: metadataFromEnvelope(req, parsed),
    };
  }

  const error = errorFromEnvelope(parsed);
  if (error) return { ok: false, error, raw, exitCode: res.code, llm: metadataFromEnvelope(req, parsed) };

  const text = textFromEnvelope(parsed);
  if (text === undefined) {
    return {
      ok: false,
      error: `${label(req.provider)} JSON did not include a result string`,
      raw,
      exitCode: res.code,
      llm: metadataFromEnvelope(req, parsed),
    };
  }

  return { ok: true, text, raw, exitCode: res.code, llm: metadataFromEnvelope(req, parsed) };
}

export function spawnLiveAgentTransport(bin: string): LiveAgentTransport {
  return (args, opts) =>
    new Promise<LiveAgentProcessResult>((resolve, reject) => {
      const child = spawn(bin, [...args], { cwd: opts.cwd });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      child.on("error", (err) => reject(err));
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
      child.stdin.write(opts.stdin);
      child.stdin.end();
    });
}

function baseMetadata(req: LiveAgentRequest): LlmMetadata {
  return {
    provider: req.provider,
    billingMode: defaultBillingMode(req.provider),
    ...(req.model ? { model: req.model } : {}),
  };
}

function metadataFromEnvelope(req: LiveAgentRequest, env: Record<string, unknown>): LlmMetadata {
  const costUsd = numberField(env, ["total_cost_usd", "cost_usd", "costUSD", "costUsd"]);
  const sessionId = stringField(env, ["session_id", "sessionId", "chatId", "id"]);
  const model = stringField(env, ["model", "model_id", "modelId"]) ?? modelFromUsage(env) ?? req.model;
  return {
    provider: req.provider,
    billingMode: defaultBillingMode(req.provider),
    ...(model ? { model } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

function defaultBillingMode(provider: LiveAgentProvider): BillingMode {
  return provider === "claude-code" ? "metered" : "subscription";
}

function label(provider: LiveAgentProvider): string {
  if (provider === "claude-code") return "claude -p";
  if (provider === "grok-build") return "grok -p";
  return "cursor-agent -p";
}

function errorFromEnvelope(env: Record<string, unknown>): string | undefined {
  if (env["is_error"] === true) return `agent returned an error envelope: ${String(env["result"] ?? env["subtype"] ?? "unknown")}`;
  const error = env["error"];
  if (typeof error === "string" && error.length > 0) return `agent returned an error envelope: ${error}`;
  return undefined;
}

function textFromEnvelope(env: Record<string, unknown>): string | undefined {
  for (const key of ["result", "text", "response", "message", "content", "output"]) {
    const v = env[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function stringField(env: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = env[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function numberField(env: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const v = env[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

function modelFromUsage(env: Record<string, unknown>): string | undefined {
  const usage = env["modelUsage"];
  if (!usage || typeof usage !== "object") return undefined;
  return Object.keys(usage as Record<string, unknown>)[0];
}
