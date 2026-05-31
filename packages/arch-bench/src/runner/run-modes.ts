/**
 * Run-mode policy for the benchmark orchestrator.
 *
 * - `--task-mode isolated`  : each task runs in a fresh workspace bootstrapped
 *   from its own `fromSpec`, so it never replays previous baseline failures.
 * - `--task-mode sequential`: tasks share one workspace and evolve it in order
 *   (the legacy behavior). Combined with `--failure-policy`:
 *     - `continue-contaminated`: leave a failed task's state in place (legacy).
 *     - `restore-from-spec`    : re-materialize the next task's `fromSpec`
 *       after a failure so one bad baseline doesn't cascade.
 *
 * This decision is pure so it can be unit-tested without touching the filesystem.
 */

import type { FailurePolicy, TaskMode } from "../report/results.js";

export interface TaskExecutionPlan {
  /** Create and bootstrap a brand-new workspace from this task's fromSpec. */
  readonly freshWorkspace: boolean;
  /** Re-materialize this task's fromSpec into the shared workspace first. */
  readonly restoreFromSpec: boolean;
}

export interface TaskExecutionContext {
  readonly taskMode: TaskMode;
  readonly failurePolicy: FailurePolicy;
  /** 0-based position of the task within its subject chain. */
  readonly index: number;
  /** Whether the previous task in the chain failed. */
  readonly priorTaskFailed: boolean;
}

export function planTaskExecution(ctx: TaskExecutionContext): TaskExecutionPlan {
  if (ctx.taskMode === "isolated") {
    return { freshWorkspace: true, restoreFromSpec: false };
  }
  const restoreFromSpec =
    ctx.failurePolicy === "restore-from-spec" && ctx.index > 0 && ctx.priorTaskFailed;
  return { freshWorkspace: false, restoreFromSpec };
}

export const DEFAULT_TASK_MODE: TaskMode = "sequential";
export const DEFAULT_FAILURE_POLICY: FailurePolicy = "continue-contaminated";

export function parseTaskMode(value: string | undefined): TaskMode | undefined {
  if (value === "sequential" || value === "isolated") return value;
  return undefined;
}

export function parseFailurePolicy(value: string | undefined): FailurePolicy | undefined {
  if (value === "restore-from-spec" || value === "continue-contaminated") return value;
  return undefined;
}
