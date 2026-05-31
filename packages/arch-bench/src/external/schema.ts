/**
 * Phase 2 external-validation data model for `@arch/bench`.
 *
 * This is **plumbing only**. It lets the benchmark *represent*, *lock*, *run*,
 * *classify*, and *report* externally authored service specs and their
 * evolutions (see docs/ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md, Phase 2).
 *
 * No real external dataset ships yet. The committed `benchmarks/external/`
 * data is a clearly-marked **fixture/demo** that exercises this plumbing and is
 * excluded from every benchmark claim. Real externally authored services,
 * evolutions, authorship/source metadata, and holdout decisions remain
 * `[PENDING - EXTERNAL]`.
 */

import { EXPECTED_OUTCOMES, TASK_KINDS, type ExpectedOutcome, type TaskKind } from "../manifest/schema.js";

export const EXTERNAL_MANIFEST_SCHEMA_VERSION = "arch.bench.external.v1" as const;

/**
 * Classification of an external evolution's end-state. Unsupported and blocked
 * outcomes are first-class results, never dropped from the dataset.
 */
export type ExternalOutcome =
  | "passed"
  | "blocked_supported_reason"
  | "blocked_unsupported_capability"
  | "failed_verification"
  | "failed_oracle"
  | "human_code_violation"
  | "migration_check_failed"
  | "excessive_churn";

export const EXTERNAL_OUTCOMES: readonly ExternalOutcome[] = [
  "passed",
  "blocked_supported_reason",
  "blocked_unsupported_capability",
  "failed_verification",
  "failed_oracle",
  "human_code_violation",
  "migration_check_failed",
  "excessive_churn",
];

/** An external evolution that passed or blocked for a correct, explicit reason. */
export function isPassOrExplicitBlock(outcome: ExternalOutcome): boolean {
  return (
    outcome === "passed" ||
    outcome === "blocked_supported_reason" ||
    outcome === "blocked_unsupported_capability"
  );
}

/** An outcome that represents a genuine Arch capability gap (product signal). */
export function isUnsupportedCapability(outcome: ExternalOutcome): boolean {
  return outcome === "blocked_unsupported_capability";
}

/**
 * Structured family of diff Arch could not (yet) apply. Mirrors the Phase 3
 * "external failure → product response" table so unsupported outcomes map to a
 * concrete capability decision rather than an opaque string.
 */
export type UnsupportedDiffType =
  | "nullable_field"
  | "field_rename"
  | "relation_change"
  | "relation_cardinality_change"
  | "type_narrowing"
  | "type_widening"
  | "destructive_removal"
  | "custom_behavior"
  | "query_endpoint"
  | "workflow_insertion"
  | "target_stack_change"
  | "other";

export const UNSUPPORTED_DIFF_TYPES: readonly UnsupportedDiffType[] = [
  "nullable_field",
  "field_rename",
  "relation_change",
  "relation_cardinality_change",
  "type_narrowing",
  "type_widening",
  "destructive_removal",
  "custom_behavior",
  "query_endpoint",
  "workflow_insertion",
  "target_stack_change",
  "other",
];

/** Structured reason an evolution was unsupported or blocked. */
export interface UnsupportedReason {
  /** Diff family this reason belongs to. */
  readonly code: UnsupportedDiffType;
  /** One-line human-readable summary. */
  readonly summary: string;
  /** Optional longer explanation. */
  readonly detail?: string;
}

export type FailurePriority = "low" | "medium" | "high";

/**
 * Required failure-analysis output for every failed external task (roadmap
 * Phase 2). Serialized verbatim to `failures/<task>.failure.json`.
 */
export interface ExternalFailureAnalysis {
  readonly task: string;
  readonly outcome: ExternalOutcome;
  /** Present when `outcome === "blocked_unsupported_capability"`. */
  readonly unsupportedDiff?: UnsupportedDiffType;
  readonly reason: string;
  readonly suggestedNextSteps: readonly string[];
  readonly shouldArchSupportThis: boolean;
  readonly priority: FailurePriority;
}

/** Authorship / provenance metadata for an externally authored service. */
export interface ExternalAuthorship {
  /** Who authored it (person, team, or org). */
  readonly author: string;
  /** Where it came from (URL, repo, or "fixture"). */
  readonly source: string;
  /** Product domain (crm, ecommerce, logistics, ...). */
  readonly domain: string;
  /** Whether this service was held out during Arch development. */
  readonly heldOut: boolean;
}

/** An externally authored service: a base spec plus its evolution list. */
export interface ExternalService {
  readonly id: string;
  readonly title: string;
  readonly authorship: ExternalAuthorship;
  /**
   * Base spec path relative to the external manifest dir. Optional for
   * representation-only fixtures that exercise reporting without a runnable spec.
   */
  readonly baseSpec?: string;
  /** True for synthetic demo data that MUST be excluded from claims. */
  readonly fixture: boolean;
  readonly notes?: string;
}

/** One externally authored evolution of a service. */
export interface ExternalEvolution {
  readonly id: string;
  readonly service: string;
  readonly order: number;
  readonly kind: TaskKind;
  readonly intent: string;
  /** Spec paths relative to the manifest dir (present when the evolution is runnable). */
  readonly fromSpec?: string;
  readonly toSpec?: string;
  /** Arch-level expected end-state, when the evolution is runnable. */
  readonly expectedOutcome?: ExpectedOutcome;
  /**
   * External classification. On a fixture this is the AUTHOR-DECLARED
   * expectation (clearly excluded from claims). On a real run it is filled in by
   * {@link classifyExternalOutcome}.
   */
  readonly externalOutcome?: ExternalOutcome;
  readonly unsupportedDiffType?: UnsupportedDiffType;
  readonly unsupportedReason?: UnsupportedReason;
  /** Documented remediation steps, folded into a synthesized failure analysis. */
  readonly suggestedNextSteps?: readonly string[];
  /** Optional author-supplied failure analysis; otherwise one is synthesized from the real outcome. */
  readonly failureAnalysis?: ExternalFailureAnalysis;
  /** True for synthetic demo data that MUST be excluded from claims. */
  readonly fixture: boolean;
}

export interface ExternalManifest {
  readonly schema_version: typeof EXTERNAL_MANIFEST_SCHEMA_VERSION;
  /** Monotonic dataset version, bumped on any post-import modification. */
  readonly datasetVersion: string;
  /** True if the entire dataset is synthetic fixture/demo data. */
  readonly fixture: boolean;
  /** Human note kept with the dataset (e.g. "fixture — excluded from claims"). */
  readonly notes?: string;
  readonly services: readonly ExternalService[];
  readonly evolutions: readonly ExternalEvolution[];
}

const TASK_KIND_SET: ReadonlySet<string> = new Set<string>(TASK_KINDS);
const EXPECTED_OUTCOME_SET: ReadonlySet<string> = new Set<string>(EXPECTED_OUTCOMES);
const EXTERNAL_OUTCOME_SET: ReadonlySet<string> = new Set<string>(EXTERNAL_OUTCOMES);
const UNSUPPORTED_DIFF_SET: ReadonlySet<string> = new Set<string>(UNSUPPORTED_DIFF_TYPES);

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && TASK_KIND_SET.has(value);
}
export function isExpectedOutcome(value: unknown): value is ExpectedOutcome {
  return typeof value === "string" && EXPECTED_OUTCOME_SET.has(value);
}
export function isExternalOutcome(value: unknown): value is ExternalOutcome {
  return typeof value === "string" && EXTERNAL_OUTCOME_SET.has(value);
}
export function isUnsupportedDiffType(value: unknown): value is UnsupportedDiffType {
  return typeof value === "string" && UNSUPPORTED_DIFF_SET.has(value);
}
