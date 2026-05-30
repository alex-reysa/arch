/**
 * Live Claude Code runner for the LLM baselines.
 *
 * Unlike the constrained `ClaudeCodeProvider` in `@arch/agents` (which disables
 * tools with `--allowed-tools ""` and runs in an isolated tmpdir), the bench
 * baselines run `claude -p` WITH file-edit tools enabled and `cwd` set to the
 * generated temp project, so Claude actually edits the project files. The
 * transport is injectable so the wiring is unit-testable without spawning.
 *
 * The `claude -p --output-format json` envelope is `{ type: "result", result,
 * total_cost_usd, session_id, modelUsage }` (same shape `@arch/agents` parses).
 */

import { spawn } from "node:child_process";

export interface ClaudeBenchRequest {
  readonly cwd: string;
  readonly prompt: string;
  /** Constraints appended to the system prompt (broad-constrained baseline). */
  readonly appendSystemPrompt?: string;
  readonly model?: string;
  /** Restrict tools (space-separated) — omit for unrestricted direct edit. */
  readonly allowedTools?: string;
  /** Default true: pass `--dangerously-skip-permissions` for unattended runs. */
  readonly skipPermissions?: boolean;
}

export interface ClaudeProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ClaudeTransport = (
  args: readonly string[],
  opts: { readonly cwd: string; readonly stdin: string },
) => Promise<ClaudeProcessResult>;

export type ClaudeBenchOutcome =
  | {
      readonly ok: true;
      readonly text: string;
      readonly raw: string;
      readonly exitCode: number;
      readonly costUsd?: number;
      readonly sessionId?: string;
      readonly model?: string;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly raw: string;
      readonly exitCode: number;
    };

export function buildBenchClaudeArgs(req: ClaudeBenchRequest): string[] {
  const args: string[] = ["-p", "--output-format", "json"];
  if (req.skipPermissions !== false) args.push("--dangerously-skip-permissions");
  if (req.model) args.push("--model", req.model);
  if (req.allowedTools) args.push("--allowed-tools", req.allowedTools);
  if (req.appendSystemPrompt) args.push("--append-system-prompt", req.appendSystemPrompt);
  return args;
}

export async function runClaude(req: ClaudeBenchRequest, transport: ClaudeTransport): Promise<ClaudeBenchOutcome> {
  const args = buildBenchClaudeArgs(req);
  const res = await transport(args, { cwd: req.cwd, stdin: req.prompt });

  if (res.code !== 0) {
    const detail = res.stderr.trim() || `claude -p exited with code ${res.code}`;
    return { ok: false, error: detail, raw: res.stdout, exitCode: res.code };
  }

  let env: Record<string, unknown>;
  try {
    env = JSON.parse(res.stdout) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "claude -p did not return JSON on stdout", raw: res.stdout, exitCode: res.code };
  }

  if (env.is_error === true || env.type !== "result" || typeof env.result !== "string") {
    const reason = String(env.result ?? env.subtype ?? "unknown");
    return { ok: false, error: `claude -p returned an error envelope: ${reason}`, raw: res.stdout, exitCode: res.code };
  }

  const modelUsage = env.modelUsage as Record<string, unknown> | undefined;
  const model = modelUsage ? Object.keys(modelUsage)[0] : undefined;
  return {
    ok: true,
    text: env.result,
    raw: res.stdout,
    exitCode: res.code,
    ...(typeof env.total_cost_usd === "number" ? { costUsd: env.total_cost_usd } : {}),
    ...(typeof env.session_id === "string" ? { sessionId: env.session_id } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}

/** Real transport: spawn the `claude` binary, prompt on stdin, capture stdio. */
export function spawnClaudeTransport(bin = "claude"): ClaudeTransport {
  return (args, opts) =>
    new Promise<ClaudeProcessResult>((resolve, reject) => {
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
