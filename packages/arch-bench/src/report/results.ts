/**
 * Per-run result records and the run envelope written to
 * `artifacts/bench/<run-id>/results.json`.
 */

import type { BaselineId } from "../manifest/schema.js";

export const BENCH_RESULTS_SCHEMA_VERSION = "arch.bench.results.v1" as const;

export type DriftRecall = "not_applicable" | "detected" | "missed";
export type LlmProvider = "claude-code" | "grok-build" | "cursor-composer";
export type BillingMode = "metered" | "subscription" | "unknown";

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
