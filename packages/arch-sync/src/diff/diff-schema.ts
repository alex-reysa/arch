/**
 * Typed diff schema between two canonical IRs.
 *
 * `IntentChange` is the legacy/internal narrow union that the prototype diff
 * engine emits. `DiffV1` is the canonical, full V1 union from
 * `SYNC_ENGINE_SPEC.md` §7.7 — every supported V1 diff variant the sync
 * engine, planner, and reviewers must understand.
 *
 * Both forms are kept side-by-side because the diff engine, classifier, and
 * planner stubs in this package were authored against `IntentChange`. Rather
 * than break their compile, this file widens the contract by adding `DiffV1`
 * and a `DiffV1Envelope` that future code paths consume.
 */

// -------------------------------------------------------------------------
// Legacy narrow union (still referenced by classification.ts, comparators.ts).
// -------------------------------------------------------------------------

export type IntentChange =
  | { kind: "model_added"; modelId: string; modelName: string }
  | { kind: "model_removed"; modelId: string; modelName: string }
  | { kind: "model_field_added"; modelId: string; fieldId: string; fieldName: string }
  | { kind: "model_field_removed"; modelId: string; fieldId: string; fieldName: string }
  | { kind: "model_field_type_changed"; modelId: string; fieldId: string }
  | { kind: "workflow_step_added"; workflowId: string; stepId: string }
  | { kind: "workflow_step_removed"; workflowId: string; stepId: string }
  | { kind: "workflow_step_reordered"; workflowId: string }
  | { kind: "guarantee_added"; workflowId: string; guaranteeId: string }
  | { kind: "guarantee_removed"; workflowId: string; guaranteeId: string }
  | { kind: "integration_added"; integrationId: string }
  | { kind: "integration_removed"; integrationId: string }
  | { kind: "policy_changed"; policyId: string }
  | { kind: "target_changed"; before: string; after: string };

export interface IRDiff {
  readonly previous_hash: string | null;
  readonly current_hash: string;
  readonly changes: readonly IntentChange[];
}

// -------------------------------------------------------------------------
// Canonical V1 diff union — `DiffV1`.
//
// One variant per supported diff type. Each variant carries the entity IDs
// the diff applies to and an optional structured payload (e.g. before/after
// hashes for `*_changed`, ordering vectors for reorders, target field for
// target diffs). Risk-classification fields live on the envelope, not on
// individual diffs, so the classifier can override them without rewriting
// each variant.
// -------------------------------------------------------------------------

export type DiffV1Type =
  | "initial_generation"
  | "model_added"
  | "model_removed"
  | "model_field_added"
  | "model_field_removed"
  | "model_field_type_changed"
  | "model_field_constraint_changed"
  | "relation_added"
  | "relation_removed"
  | "relation_changed"
  | "model_index_added"
  | "model_index_removed"
  | "model_index_changed"
  | "workflow_added"
  | "workflow_removed"
  | "workflow_step_added"
  | "workflow_step_removed"
  | "workflow_step_reordered"
  | "workflow_step_changed"
  | "integration_added"
  | "integration_removed"
  | "integration_changed"
  | "custom_extension_added"
  | "custom_extension_removed"
  | "custom_extension_changed"
  | "guarantee_added"
  | "guarantee_removed"
  | "guarantee_changed"
  | "policy_added"
  | "policy_removed"
  | "policy_changed"
  | "test_added"
  | "test_removed"
  | "test_changed"
  | "target_changed";

/** Risk classification per `SYNC_ENGINE_SPEC.md` §13. */
export type DiffRiskClass =
  | "additive"
  | "modifying"
  | "destructive"
  | "structural"
  | "critical";

export type ConfirmationKind =
  | "destructive"
  | "ambiguous_rename"
  | "schema_breaking"
  | "ownership_widening"
  | "guarantee_weakening"
  | "target_change";

interface DiffV1Common {
  /** Deterministic id: `diff.<type>.<primary-entity>[.<secondary-entity>...]`. */
  readonly diff_id: string;
  readonly entity_ids: readonly string[];
  readonly risk: DiffRiskClass;
  readonly requires_confirmation: boolean;
  readonly confirmation_kinds: readonly ConfirmationKind[];
  readonly affected_entity_hints: readonly string[];
  readonly reason: string;
}

export type DiffV1 =
  | (DiffV1Common & { readonly type: "initial_generation" })
  | (DiffV1Common & { readonly type: "model_added"; readonly model_id: string })
  | (DiffV1Common & { readonly type: "model_removed"; readonly model_id: string })
  | (DiffV1Common & {
      readonly type: "model_field_added";
      readonly model_id: string;
      readonly field_id: string;
      readonly nullable: boolean;
      readonly has_default: boolean;
      readonly required_without_default: boolean;
    })
  | (DiffV1Common & {
      readonly type: "model_field_removed";
      readonly model_id: string;
      readonly field_id: string;
    })
  | (DiffV1Common & {
      readonly type: "model_field_type_changed";
      readonly model_id: string;
      readonly field_id: string;
      readonly before_type: string;
      readonly after_type: string;
    })
  | (DiffV1Common & {
      readonly type: "model_field_constraint_changed";
      readonly model_id: string;
      readonly field_id: string;
      readonly constraint: "nullable" | "default" | "unique";
    })
  | (DiffV1Common & {
      readonly type: "relation_added";
      readonly relation_id: string;
    })
  | (DiffV1Common & {
      readonly type: "relation_removed";
      readonly relation_id: string;
    })
  | (DiffV1Common & {
      readonly type: "relation_changed";
      readonly relation_id: string;
    })
  | (DiffV1Common & {
      readonly type: "model_index_added";
      readonly model_id: string;
      readonly index_id: string;
    })
  | (DiffV1Common & {
      readonly type: "model_index_removed";
      readonly model_id: string;
      readonly index_id: string;
    })
  | (DiffV1Common & {
      readonly type: "model_index_changed";
      readonly model_id: string;
      readonly index_id: string;
    })
  | (DiffV1Common & {
      readonly type: "workflow_added";
      readonly workflow_id: string;
    })
  | (DiffV1Common & {
      readonly type: "workflow_removed";
      readonly workflow_id: string;
    })
  | (DiffV1Common & {
      readonly type: "workflow_step_added";
      readonly workflow_id: string;
      readonly step_id: string;
    })
  | (DiffV1Common & {
      readonly type: "workflow_step_removed";
      readonly workflow_id: string;
      readonly step_id: string;
    })
  | (DiffV1Common & {
      readonly type: "workflow_step_reordered";
      readonly workflow_id: string;
      readonly before_order: readonly string[];
      readonly after_order: readonly string[];
    })
  | (DiffV1Common & {
      readonly type: "workflow_step_changed";
      readonly workflow_id: string;
      readonly step_id: string;
    })
  | (DiffV1Common & {
      readonly type: "integration_added";
      readonly integration_id: string;
    })
  | (DiffV1Common & {
      readonly type: "integration_removed";
      readonly integration_id: string;
    })
  | (DiffV1Common & {
      readonly type: "integration_changed";
      readonly integration_id: string;
    })
  | (DiffV1Common & {
      readonly type: "custom_extension_added";
      readonly custom_id: string;
    })
  | (DiffV1Common & {
      readonly type: "custom_extension_removed";
      readonly custom_id: string;
    })
  | (DiffV1Common & {
      readonly type: "custom_extension_changed";
      readonly custom_id: string;
      readonly contract_changed: boolean;
      readonly call_sites_changed: boolean;
    })
  | (DiffV1Common & {
      readonly type: "guarantee_added";
      readonly workflow_id: string;
      readonly guarantee_id: string;
    })
  | (DiffV1Common & {
      readonly type: "guarantee_removed";
      readonly workflow_id: string;
      readonly guarantee_id: string;
    })
  | (DiffV1Common & {
      readonly type: "guarantee_changed";
      readonly workflow_id: string;
      readonly guarantee_id: string;
      readonly stricter: boolean;
    })
  | (DiffV1Common & {
      readonly type: "policy_added";
      readonly policy_id: string;
    })
  | (DiffV1Common & {
      readonly type: "policy_removed";
      readonly policy_id: string;
    })
  | (DiffV1Common & {
      readonly type: "policy_changed";
      readonly policy_id: string;
    })
  | (DiffV1Common & {
      readonly type: "test_added";
      readonly test_id: string;
    })
  | (DiffV1Common & {
      readonly type: "test_removed";
      readonly test_id: string;
    })
  | (DiffV1Common & {
      readonly type: "test_changed";
      readonly test_id: string;
    })
  | (DiffV1Common & {
      readonly type: "target_changed";
      readonly field: "language" | "runtime" | "database" | "orm" | "cache" | "auth";
      readonly before: string;
      readonly after: string;
    });

/**
 * Top-level diff envelope. The sync engine emits exactly one envelope per
 * planning round; `diffs` is in deterministic source order so plan IDs and
 * plan hashes are reproducible.
 */
export interface DiffV1Envelope {
  readonly schema_version: "arch.diff.v1";
  readonly previous_ir_hash: string | null;
  readonly current_ir_hash: string;
  readonly diffs: readonly DiffV1[];
  readonly initial_generation: boolean;
}
