import type {
  ArtifactGenerationIR,
  OwnershipKind,
  OwnershipWriteScope,
} from "@arch/ir";
import type { DiffV1, DiffV1Envelope } from "../diff/diff-schema.js";

// -------------------------------------------------------------------------
// Legacy patch op + sync plan (still consumed by patcher/plan-builder stubs).
// -------------------------------------------------------------------------

export type PatchOpKind =
  | "create_file"
  | "rewrite_file"
  | "patch_region"
  | "delete_file"
  | "create_migration";

export interface PatchOp {
  readonly id: string;
  readonly kind: PatchOpKind;
  readonly path: string;
  readonly artifact_id: string;
  readonly entity_ids: readonly string[];
  readonly write_scope: "arch_only" | "human_only" | "shared";
}

export interface VerificationObligation {
  readonly kind: "typecheck" | "tests" | "migrations" | "guarantee_test";
  readonly target?: string;
}

export interface SyncPlan {
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly previous_ir_hash: string | null;
  readonly current_ir_hash: string;
  readonly intent_changes: readonly { kind: string; description: string }[];
  readonly affected_artifacts: readonly string[];
  readonly patches: readonly PatchOp[];
  readonly verification: readonly VerificationObligation[];
  readonly destructive_changes: readonly string[];
  readonly created_at: string;
}

// -------------------------------------------------------------------------
// Canonical V1 sync plan — `SyncPlanV1`.
//
// Action groups, allowed/forbidden paths, ArtifactIR generation metadata,
// OwnershipIR write_scope decisions per AC `de4f5a6b...`. Every action carries
// the typed write-scope decision derived from the IR's OwnershipIR plus the
// generation metadata derived from the IR's ArtifactIR — so reviewers and
// agents see exactly the same authoritative shape that ends up in the
// artifact map after a successful apply.
// -------------------------------------------------------------------------

export type SyncPlanActionKind =
  | "create_file"
  | "rewrite_whole_file"
  | "patch_generated_region"
  | "delete_file"
  | "write_extension_stub"
  | "create_migration"
  | "no_op";

export type SyncPlanActionGroupKind =
  | "schema"
  | "model"
  | "validator"
  | "route"
  | "workflow"
  | "integration"
  | "policy"
  | "guarantee_test"
  | "model_test"
  | "workflow_test"
  | "custom_extension"
  | "migration"
  | "config"
  | "runtime"
  | "metadata";

/**
 * Per-artifact action. The OwnershipIR write_scope decision and the
 * ArtifactIR generation metadata are captured directly so an apply step
 * can validate the action without re-deriving them from the canonical IR.
 */
export interface SyncPlanActionV1 {
  readonly action_id: string;
  readonly kind: SyncPlanActionKind;
  readonly artifact_id: string;
  /** Project-relative POSIX path of the action target. */
  readonly path: string;
  readonly entity_ids: readonly string[];
  readonly diff_ids: readonly string[];
  /** Snapshot of the ArtifactIR.generation block this action will produce. */
  readonly generation: ArtifactGenerationIR;
  /** OwnershipIR write_scope decision authoritative for this action. */
  readonly ownership: SyncPlanOwnershipDecision;
  /**
   * Marker id when `kind === "patch_generated_region"`. Empty string is not
   * a valid value; the field is omitted for whole-file or stub actions.
   */
  readonly region_marker_id?: string;
  readonly destructive: boolean;
  readonly requires_confirmation: boolean;
}

export interface SyncPlanOwnershipDecision {
  readonly ownership_id: string;
  readonly ownership_kind: OwnershipKind;
  readonly write_scope: OwnershipWriteScope;
  readonly owner: "arch" | "human";
}

/**
 * Logical grouping of related actions. Groups exist so the planner can
 * order parallel work, surface a stable summary, and so reviewers can scan
 * a plan at the right level of granularity. Each action belongs to exactly
 * one group.
 */
export interface SyncPlanActionGroupV1 {
  readonly group_id: string;
  readonly kind: SyncPlanActionGroupKind;
  readonly summary: string;
  readonly action_ids: readonly string[];
}

export type SyncPlanVerificationKind =
  | "typecheck"
  | "tests"
  | "migrations"
  | "prisma_validate"
  | "guarantee_test"
  | "drift_check";

export interface SyncPlanVerificationObligationV1 {
  readonly kind: SyncPlanVerificationKind;
  /** Optional scoping target — e.g. test file path, migration name, etc. */
  readonly target?: string;
}

/**
 * Path allowlist / denylist used by the patcher and the agent runtime.
 * - `allowed`: every action must target a path matching at least one entry.
 * - `forbidden`: any action targeting a matching path must be rejected.
 *
 * Paths are POSIX globs evaluated relative to the project root.
 */
export interface SyncPlanPathPolicyV1 {
  readonly allowed: readonly string[];
  readonly forbidden: readonly string[];
}

export interface SyncPlanV1 {
  readonly schema_version: "arch.plan.v1";
  readonly plan_id: string;
  readonly plan_hash: string;
  readonly base_ir_hash: string | null;
  readonly target_ir_hash: string;
  readonly created_at: string;
  /** The diff envelope this plan was built from. */
  readonly diff: DiffV1Envelope;
  readonly diff_index: readonly DiffV1[];
  readonly action_groups: readonly SyncPlanActionGroupV1[];
  readonly actions: readonly SyncPlanActionV1[];
  readonly path_policy: SyncPlanPathPolicyV1;
  readonly verification: readonly SyncPlanVerificationObligationV1[];
  /** IDs of diffs that require explicit confirmation before apply. */
  readonly confirmations_required: readonly string[];
  readonly destructive: boolean;
}
