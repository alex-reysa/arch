/**
 * Pure pass/fail judgment for one task × baseline run. The criterion depends on
 * the task's expected outcome and (for drift) the baseline's capabilities, so
 * it is centralized here and unit-tested. The richer per-signal metrics
 * (driftRecall, off-scope churn, cost, …) are reported alongside `passed`.
 */

import type { BaselineId, ExpectedOutcome, TaskKind } from "../manifest/schema.js";
import type { DriftRecall, MigrationCheckStatus } from "../report/results.js";

export interface TaskSignals {
  readonly blocked: boolean;
  readonly verificationPassed: boolean;
  readonly oraclePassed: boolean;
  readonly humanOwnedViolations: number;
  readonly generatedTestDeletedOrWeakened: boolean;
  readonly offScopeFilesTouched: number;
  readonly driftRecall: DriftRecall;
  readonly repairSucceeded?: boolean;
  /** Migration data-preservation check outcome (migration tasks only). */
  readonly migrationCheckStatus?: MigrationCheckStatus;
}

/** Scoring options. `strict` is set in validation/paper runs. */
export interface ScoreOptions {
  readonly strict?: boolean;
}

function noCollateralHarm(s: TaskSignals): boolean {
  return s.humanOwnedViolations === 0 && !s.generatedTestDeletedOrWeakened;
}

export function scorePassed(
  kind: TaskKind,
  expectedOutcome: ExpectedOutcome,
  baseline: BaselineId,
  s: TaskSignals,
  opts: ScoreOptions = {},
): boolean {
  switch (expectedOutcome) {
    case "apply_passes": {
      const applied = !s.blocked && s.verificationPassed && s.oraclePassed && noCollateralHarm(s);
      // In validation/paper mode, a migration-preservation claim is only valid
      // if a real Postgres dbCheck actually ran and preserved the data.
      if (opts.strict && kind === "migration_data_preservation") {
        return applied && s.migrationCheckStatus === "passed";
      }
      return applied;
    }

    case "apply_blocks":
      // The change is destructive/unsafe: a correct baseline refuses it and
      // leaves the project untouched (no off-scope scribbles, no human harm).
      return s.blocked && noCollateralHarm(s) && s.offScopeFilesTouched === 0;

    case "drift_detected":
      if (!noCollateralHarm(s)) return false;
      if (baseline === "arch-typed-sync") {
        return s.driftRecall === "detected" && s.repairSucceeded === true;
      }
      // Baselines without a drift detector "pass" only by ending at a verifying
      // project (a blind full restore counts; a broken one does not).
      return s.verificationPassed;

    default:
      return false;
  }
}
