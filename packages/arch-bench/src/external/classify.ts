/**
 * Classify an external evolution's end-state into an {@link ExternalOutcome}
 * and (for failures) produce the required structured failure analysis.
 *
 * Classification is PURE: it maps already-collected run signals to an outcome.
 * Precedence is deliberate and documented — the most severe gate wins so a
 * single record never hides a human-code violation behind a softer label:
 *
 *   1. human_code_violation     (hard gate: protected code was touched)
 *   2. migration_check_failed   (a real dbCheck reported failed)
 *   3. blocked_*                (Arch refused — supported reason vs capability gap)
 *   4. failed_verification      (project does not type/test-check)
 *   5. failed_oracle            (behavioral oracle failed)
 *   6. excessive_churn          (off-scope blast radius over threshold)
 *   7. passed
 */

import type { MigrationCheckStatus } from "../report/results.js";
import {
  isUnsupportedCapability,
  type ExternalFailureAnalysis,
  type ExternalOutcome,
  type FailurePriority,
  type UnsupportedDiffType,
  type UnsupportedReason,
} from "./schema.js";

/** Default off-scope file count above which a passing change is "excessive churn". */
export const DEFAULT_EXCESSIVE_CHURN_THRESHOLD = 5;

export interface ExternalSignals {
  /** Arch refused to apply the change. */
  readonly blocked: boolean;
  readonly verificationPassed: boolean;
  readonly oraclePassed: boolean;
  readonly humanOwnedViolations: number;
  readonly offScopeFilesTouched: number;
  /** Migration data-preservation check outcome (migration evolutions only). */
  readonly migrationCheckStatus?: MigrationCheckStatus;
  /**
   * Set when Arch blocked because of a capability it does not implement (vs a
   * correct refusal of a destructive change). Distinguishes
   * `blocked_unsupported_capability` from `blocked_supported_reason`.
   */
  readonly unsupportedDiffType?: UnsupportedDiffType;
  /** Override the off-scope churn threshold. */
  readonly excessiveChurnThreshold?: number;
}

/**
 * Coarse failure-class grouping for an outcome, for report aggregation
 * (distinct from the fine-grained {@link ExternalOutcome}).
 */
export function failureClassOf(outcome: ExternalOutcome): string {
  switch (outcome) {
    case "passed":
      return "pass";
    case "blocked_supported_reason":
      return "blocked";
    case "blocked_unsupported_capability":
      return "unsupported";
    case "failed_verification":
      return "verification";
    case "failed_oracle":
      return "oracle";
    case "human_code_violation":
      return "human_code";
    case "migration_check_failed":
      return "migration";
    case "excessive_churn":
      return "churn";
    default:
      return "unknown";
  }
}

export function classifyExternalOutcome(s: ExternalSignals): ExternalOutcome {
  const threshold = s.excessiveChurnThreshold ?? DEFAULT_EXCESSIVE_CHURN_THRESHOLD;
  if (s.humanOwnedViolations > 0) return "human_code_violation";
  if (s.migrationCheckStatus === "failed") return "migration_check_failed";
  if (s.blocked) {
    return s.unsupportedDiffType ? "blocked_unsupported_capability" : "blocked_supported_reason";
  }
  if (!s.verificationPassed) return "failed_verification";
  if (!s.oraclePassed) return "failed_oracle";
  if (s.offScopeFilesTouched > threshold) return "excessive_churn";
  return "passed";
}

const FAILURE_PRIORITY: Partial<Record<ExternalOutcome, FailurePriority>> = {
  human_code_violation: "high",
  migration_check_failed: "high",
  blocked_unsupported_capability: "high",
  failed_verification: "medium",
  failed_oracle: "medium",
  excessive_churn: "low",
  blocked_supported_reason: "low",
};

const DEFAULT_REASON: Record<ExternalOutcome, string> = {
  passed: "Arch applied the evolution and it verified.",
  blocked_supported_reason: "Arch correctly refused the change (e.g. destructive without confirmation).",
  blocked_unsupported_capability: "Arch blocked the change because it requires a capability Arch does not implement.",
  failed_verification: "The generated project did not pass typecheck/tests after the evolution.",
  failed_oracle: "An independent behavioral oracle failed after the evolution.",
  human_code_violation: "The evolution modified human-owned files (src/custom/**) it must never touch.",
  migration_check_failed: "The migration dbCheck reported the change would not preserve existing data.",
  excessive_churn: "The evolution touched far more off-scope files than the change required.",
};

export interface FailureAnalysisInput {
  readonly task: string;
  readonly outcome: ExternalOutcome;
  readonly unsupportedReason?: UnsupportedReason;
  /** Override the default reason text. */
  readonly reason?: string;
  readonly suggestedNextSteps?: readonly string[];
  /** Whether Arch should grow to support this. Defaults to true for capability gaps. */
  readonly shouldArchSupportThis?: boolean;
  readonly priority?: FailurePriority;
}

/**
 * Build the failure-analysis record for a failed external task. Returns
 * `undefined` for `passed` (nothing to analyze).
 */
export function buildFailureAnalysis(input: FailureAnalysisInput): ExternalFailureAnalysis | undefined {
  if (input.outcome === "passed") return undefined;
  const unsupportedDiff = input.unsupportedReason?.code;
  const reason =
    input.reason ??
    (input.unsupportedReason
      ? `${DEFAULT_REASON[input.outcome]} ${input.unsupportedReason.summary}`
      : DEFAULT_REASON[input.outcome]);
  const shouldArchSupportThis =
    input.shouldArchSupportThis ?? isUnsupportedCapability(input.outcome);
  const priority = input.priority ?? FAILURE_PRIORITY[input.outcome] ?? "medium";
  return {
    task: input.task,
    outcome: input.outcome,
    ...(unsupportedDiff !== undefined ? { unsupportedDiff } : {}),
    reason,
    suggestedNextSteps: [...(input.suggestedNextSteps ?? [])],
    shouldArchSupportThis,
    priority,
  };
}
