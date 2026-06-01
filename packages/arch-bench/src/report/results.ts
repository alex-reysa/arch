/**
 * Per-run result records and the run envelope written to
 * `artifacts/bench/<run-id>/results.json`.
 */

import type { BaselineId } from "../manifest/schema.js";
import type { ExternalOutcome, UnsupportedDiffType } from "../external/schema.js";

export const BENCH_RESULTS_SCHEMA_VERSION = "arch.bench.results.v1" as const;

export type DriftRecall = "not_applicable" | "detected" | "missed";
export type LlmProvider = "claude-code" | "grok-build" | "cursor-composer";
export type BillingMode = "metered" | "subscription" | "unknown";

/** Outcome of a Postgres data-preservation `dbCheck` for a migration task. */
export type MigrationCheckStatus = "passed" | "failed" | "skipped" | "not_applicable";

/**
 * Whether a guarantee-bearing task is backed by a real behavioral oracle, or
 * merely declared. Latency/guarantee tasks without a measurable load oracle are
 * `declared_but_not_behaviorally_verified` and excluded from correctness claims.
 */
export type GuaranteeVerification = "behavioral" | "declared_but_not_behaviorally_verified";

/** How a task was executed within its subject chain. */
export type TaskMode = "sequential" | "isolated";
/** What the runner does to the workspace after a failed task in sequential mode. */
export type FailurePolicy = "restore-from-spec" | "continue-contaminated";

export interface LlmMetadata {
  readonly provider: LlmProvider;
  readonly model?: string;
  readonly costUsd?: number;
  readonly sessionId?: string;
  readonly billingMode?: BillingMode;
}

/** One task × baseline × repeat outcome. Mirrors the plan's metric schema. */
export interface BenchResult {
  readonly taskId: string;
  readonly baseline: BaselineId;
  readonly repeat: number;
  readonly passed: boolean;
  readonly blocked: boolean;
  readonly durationMs: number;
  readonly filesTouched: number;
  readonly changedLoc: number;
  readonly expectedFilesTouched: number;
  readonly offScopeFilesTouched: number;
  readonly humanOwnedViolations: number;
  readonly generatedTestDeletedOrWeakened: boolean;
  readonly verificationPassed: boolean;
  readonly oraclePassed: boolean;
  readonly driftRecall: DriftRecall;
  readonly repairSucceeded?: boolean;
  readonly planDeterministic?: boolean;
  readonly migrationDataPreserved?: boolean;
  /** Postgres data-preservation check outcome for migration tasks. */
  readonly migrationCheckStatus?: MigrationCheckStatus;
  /** Human-readable reason for the migration check status (skip cause, failure). */
  readonly migrationCheckReason?: string;
  /** Whether a guarantee-bearing task is behaviorally verified or only declared. */
  readonly guaranteeVerification?: GuaranteeVerification;
  /**
   * Phase 2 external-validation fields. Present only on external-run records
   * (an externally authored evolution); absent on the internal benchmark.
   */
  readonly externalOutcome?: ExternalOutcome;
  readonly unsupportedDiffType?: UnsupportedDiffType;
  /** One-line structured reason summary for an unsupported/blocked external evolution. */
  readonly unsupportedReason?: string;
  /** Coarse failure-class grouping derived from the external outcome. */
  readonly failureClass?: string;
  /** Frozen external dataset version this record was produced against. */
  readonly externalDatasetVersion?: string;
  /** Frozen external dataset content hash this record was produced against. */
  readonly externalDatasetHash?: string;
  /** Task kind, denormalized onto the row so reports can group without the manifest. */
  readonly taskKind?: string;
  /** Run mode this record was produced under. */
  readonly taskMode?: TaskMode;
  /** Failure policy in effect for this record. */
  readonly failurePolicy?: FailurePolicy;
  /** Whether strict validation/paper scoring was in effect for this record. */
  readonly validationMode?: boolean;
  readonly llm?: LlmMetadata;
  /** Free-form notes / failure reason for the human-readable report. */
  readonly note?: string;
}

export interface RunResults {
  readonly schema_version: typeof BENCH_RESULTS_SCHEMA_VERSION;
  readonly runId: string;
  readonly createdAt: string;
  readonly suite: string;
  readonly manifestVersion: string;
  readonly results: readonly BenchResult[];
}

export interface RunMeta {
  readonly runId: string;
  readonly createdAt: string;
  readonly suite: string;
  readonly manifestVersion: string;
}

export function buildRunResults(meta: RunMeta, results: readonly BenchResult[]): RunResults {
  return {
    schema_version: BENCH_RESULTS_SCHEMA_VERSION,
    runId: meta.runId,
    createdAt: meta.createdAt,
    suite: meta.suite,
    manifestVersion: meta.manifestVersion,
    results: [...results],
  };
}
