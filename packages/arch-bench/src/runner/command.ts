/**
 * Thin subprocess wrapper. Captures stdout/stderr/exit-code/duration and
 * (optionally) feeds stdin. Never throws on a non-zero exit — callers decide
 * what a failure means, because some bench steps EXPECT a non-zero exit
 * (e.g. `arch check` reporting drift, `arch apply` refusing a destructive plan).
 */

import { spawn } from "node:child_process";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface RunCommandOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly timeoutMs?: number;
  /** Mirror child stdio to the parent (useful when debugging integration runs). */
  readonly inherit?: boolean;
}

export function runCommand(
  command: string,
  args: readonly string[],
  opts: RunCommandOptions,
): Promise<CommandResult> {
  const start = nowMs();
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, durationMs: nowMs() - start });
    };
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        stderr += `\n[bench] command timed out after ${opts.timeoutMs}ms\n`;
        finish(124);
      }, opts.timeoutMs);
    }
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
      if (opts.inherit) process.stdout.write(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
      if (opts.inherit) process.stderr.write(c);
    });
    child.on("error", (err) => {
      stderr += `\n[bench] spawn error: ${err instanceof Error ? err.message : String(err)}\n`;
      if (timer) clearTimeout(timer);
      finish(127);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      finish(code ?? -1);
    });
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

function nowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}
