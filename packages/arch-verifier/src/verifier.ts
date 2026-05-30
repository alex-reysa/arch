import { randomUUID } from "node:crypto";
import { TYPECHECK, TESTS, PRISMA_VALIDATE } from "./commands.js";
import { runCommand } from "./command-runner.js";
import type { VerificationRunResult, VerificationStepResult } from "./result.js";

export interface VerifierOptions {
  readonly projectRoot: string;
  readonly steps?: readonly ("typecheck" | "tests" | "prisma-validate")[];
}

export async function verify(options: VerifierOptions): Promise<VerificationRunResult> {
  const steps = options.steps ?? ["typecheck", "tests"];
  const results: VerificationStepResult[] = [];
  for (const step of steps) {
    const cmd =
      step === "typecheck" ? TYPECHECK : step === "tests" ? TESTS : PRISMA_VALIDATE;
    const result = await runCommand(cmd, options.projectRoot);
    results.push(result);
    if (!result.passed) break;
  }
  const passed = results.length > 0 && results.every((r) => r.passed);
  const failed = results.find((r) => !r.passed);
  return passed
    ? { run_id: randomUUID(), passed: true, steps: results }
    : {
        run_id: randomUUID(),
        passed: false,
        steps: results,
        failure_reason: failed?.name ?? "unknown",
      };
}
