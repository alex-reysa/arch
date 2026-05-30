/**
 * Baseline contract. A baseline performs ONE evolution step on a workspace
 * that is already at the task's from-state (the orchestrator bootstraps v00 and
 * replays prior tasks). The orchestrator owns snapshotting, churn, oracle
 * execution, and BenchResult assembly; a baseline only reports the
 * step-specific signals below.
 */

import type { BaselineId } from "../manifest/schema.js";
import type { BenchTask } from "../manifest/schema.js";
import type { LoadedManifest } from "../manifest/load.js";
import type { ArchCli } from "../runner/arch-cli.js";
import type { Workspace } from "../runner/workspace.js";
import type { ClaudeTransport } from "../llm/claude-runner.js";

export interface EvolveContext {
  readonly task: BenchTask;
  readonly loaded: LoadedManifest;
  readonly workspace: Workspace;
  readonly archCli: ArchCli;
  /** Target spec source — already written to `backend.arch` by the orchestrator. */
  readonly toSpecSource: string;
  /** Present only for live baselines; the orchestrator injects the transport. */
  readonly claudeTransport?: ClaudeTransport;
  readonly liveModel?: string;
  readonly log: (msg: string) => void;
}

export interface EvolveOutcome {
  /** The baseline refused to apply the change (expected for destructive tasks). */
  readonly blocked: boolean;
  /** Did the project verify (typecheck + tests) after the step. */
  readonly verificationPassed: boolean;
  readonly planDeterministic?: boolean;
  readonly llm?: { readonly provider: "claude-code"; readonly costUsd?: number; readonly sessionId?: string };
  readonly note?: string;
  /** Captured stdout/stderr for the run artifact. */
  readonly logs: string;
}

export interface Baseline {
  readonly id: BaselineId;
  evolve(ctx: EvolveContext): Promise<EvolveOutcome>;
}
