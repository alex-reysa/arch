import { spawn } from "node:child_process";
import type { VerificationCommand } from "./commands.js";
import type { VerificationStepResult } from "./result.js";

/**
 * Default per-command wall-clock budget. Generous, because a real generated
 * project's `pnpm install` / `tsc` / `vitest` can legitimately take minutes;
 * the point is to bound a *hung* child, not a slow one. Override per command
 * via {@link VerificationCommand.timeoutMs}.
 */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Cap captured stdout/stderr so a noisy or looping child cannot grow the
 * parent's memory without bound. Output past the cap is dropped and a marker
 * is appended once.
 */
const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;

/**
 * Run a verification command, capturing stdout/stderr and timing it.
 *
 * Fails closed by construction:
 *  - a spawn-level failure (e.g. ENOENT on a missing binary) resolves as
 *    `{ passed: false }` with the error on stderr — it does NOT reject, so a
 *    caller that doesn't `try/catch` still records a failed step instead of
 *    crashing `arch apply` / `arch repair`;
 *  - a child that never exits is SIGKILLed after `timeoutMs` and resolves as
 *    `{ passed: false }` with a timeout note, so `verify()` can never hang.
 */
export async function runCommand(cmd: VerificationCommand, cwd: string): Promise<VerificationStepResult> {
  const start = Date.now();
  const timeoutMs = cmd.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

  const child = spawn(cmd.bin, [...cmd.args], {
    cwd: cmd.cwd ?? cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let stdoutCapped = false;
  let stderrCapped = false;
  child.stdout?.on("data", (chunk: Buffer) => {
    if (stdout.length >= MAX_CAPTURE_BYTES) {
      if (!stdoutCapped) {
        stdout += "\n[output truncated: exceeded capture limit]\n";
        stdoutCapped = true;
      }
      return;
    }
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length >= MAX_CAPTURE_BYTES) {
      if (!stderrCapped) {
        stderr += "\n[output truncated: exceeded capture limit]\n";
        stderrCapped = true;
      }
      return;
    }
    stderr += chunk.toString("utf8");
  });

  const exitCode: number = await new Promise<number>((resolve) => {
    let settled = false;
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      stderr += `\ncommand timed out after ${timeoutMs}ms\n`;
      try {
        child.kill("SIGKILL");
      } catch {
        /* child already gone */
      }
      settle(-1);
    }, timeoutMs);
    // Don't let a pending timeout keep the event loop alive on its own.
    if (typeof timer.unref === "function") timer.unref();

    child.on("error", (err: Error) => {
      stderr += `${err.message}\n`;
      settle(-1);
    });
    child.on("exit", (code) => settle(code ?? -1));
  });

  return {
    name: cmd.name,
    passed: exitCode === 0,
    durationMs: Date.now() - start,
    stdout,
    stderr,
  };
}
