/**
 * Typed manifest schema owned by `@arch/bench`.
 *
 * The manifest is the committed, version-controlled description of the
 * benchmark: which subjects exist, which baselines to run, and the ordered
 * list of evolution tasks per subject. It is data only — no behavior — so it
 * can be authored by hand under `benchmarks/manifest.json` and validated
 * structurally by {@link validateManifest} before any run.
 */

export const BENCH_MANIFEST_SCHEMA_VERSION = "arch.bench.manifest.v1" as const;

/** The deterministic and live-agent baselines compared by the study. */
export type BaselineId =
  | "arch-typed-sync"
  | "full-regeneration"
  | "claude-direct-edit"
  | "claude-broad-constrained"
  | "grok-direct-edit"
  | "grok-broad-constrained"
  | "composer-direct-edit"
  | "composer-broad-constrained";

export const BASELINE_IDS: readonly BaselineId[] = [
  "arch-typed-sync",
  "full-regeneration",
  "claude-direct-edit",
  "claude-broad-constrained",
  "grok-direct-edit",
  "grok-broad-constrained",
  "composer-direct-edit",
  "composer-broad-constrained",
];

/** Whether a baseline calls a live LLM (and is therefore gated + repeated). */
export function isLiveBaseline(id: BaselineId): boolean {
  return (
    id === "claude-direct-edit" ||
    id === "claude-broad-constrained" ||
    id === "grok-direct-edit" ||
    id === "grok-broad-constrained" ||
    id === "composer-direct-edit" ||
    id === "composer-broad-constrained"
  );
}

/** Kinds of evolution task in the 20-per-subject mix. */
export type TaskKind =
  | "additive_field"
  | "enum_change"
  | "workflow_edit"
  | "guarantee_change"
  | "drift_injection"
  | "destructive_block"
  | "migration_data_preservation"
  | "human_owned_edit";

export const TASK_KINDS: readonly TaskKind[] = [
  "additive_field",
  "enum_change",
  "workflow_edit",
  "guarantee_change",
  "drift_injection",
  "destructive_block",
  "migration_data_preservation",
  "human_owned_edit",
];

/** Expected end-state of applying the task through Arch. */
export type ExpectedOutcome = "apply_passes" | "apply_blocks" | "drift_detected";

export const EXPECTED_OUTCOMES: readonly ExpectedOutcome[] = [
  "apply_passes",
  "apply_blocks",
  "drift_detected",
];

/**
 * A single evolution task. `fromSpec`/`toSpec` are paths to `.arch` files
 * relative to the manifest's directory (the `benchmarks/` root). For tasks
 * that do not change the spec (drift injection, human-owned-edit), `fromSpec`
 * and `toSpec` may be equal.
 */
export interface BenchTask {
  readonly id: string;
  readonly subject: string;
  readonly order: number;
  readonly kind: TaskKind;
  readonly fromSpec: string;
  readonly toSpec: string;
  readonly intent: string;
  readonly expectedDiffTypes: readonly string[];
  readonly expectedAffectedPaths: readonly string[];
  readonly expectedOutcome: ExpectedOutcome;
  /** For `drift_injection` tasks: the `arch check` drift kinds expected. */
  readonly expectedDriftKinds?: readonly string[];
  /** Oracle test files (relative to the manifest dir) copied into the project. */
  readonly oracleTests: readonly string[];
  /** Drift-injection scripts (relative to the manifest dir). */
  readonly driftScripts: readonly string[];
  /** Optional Postgres data-preservation check script (relative to manifest dir). */
  readonly dbCheck?: string;
  /**
   * For `guarantee_change` tasks: a verifier-backed guarantee assertion file
   * (relative to the manifest dir) that satisfies strict validation in lieu of
   * a behavioral oracle test.
   */
  readonly guaranteeAssertion?: string;
  /**
   * For guarantee-bearing tasks: whether the guarantee is backed by a real
   * behavioral oracle or only declared. Latency/guarantee tasks without a
   * measurable load oracle are `declared_but_not_behaviorally_verified` and are
   * excluded from correctness claims in reports.
   */
  readonly guaranteeVerification?: "behavioral" | "declared_but_not_behaviorally_verified";
  /**
   * For `human_owned_edit` tasks: a custom file (under `src/custom/**`) to seed
   * before the task and assert is preserved afterwards. `path` is relative to
   * the generated project root.
   */
  readonly humanOwnedSeed?: { readonly path: string; readonly content: string };
}

export interface BenchSubject {
  readonly id: string;
  readonly title: string;
  /** Path to the v00 base spec, relative to the manifest dir. */
  readonly baseSpec: string;
}

export interface BenchManifest {
  readonly schema_version: typeof BENCH_MANIFEST_SCHEMA_VERSION;
  /** Baselines this manifest expects to run. */
  readonly baselines: readonly BaselineId[];
  readonly subjects: readonly BenchSubject[];
  readonly tasks: readonly BenchTask[];
}
