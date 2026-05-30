import { spawn } from "node:child_process";
import type { VerificationCommand } from "./commands.js";
import type { VerificationStepResult } from "./result.js";

export async function runCommand(cmd: VerificationCommand, cwd: string): Promise<VerificationStepResult> {
  const start = Date.now();
  const child = spawn(cmd.bin, [...cmd.args], {
    cwd: cmd.cwd ?? cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? -1));
  });

  return {
    name: cmd.name,
    passed: exitCode === 0,
    durationMs: Date.now() - start,
    stdout,
    stderr,
  };
}
