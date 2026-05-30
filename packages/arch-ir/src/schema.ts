/**
 * Canonical TypeScript representation of `arch.ir.v1`.
 *
 * This file is the single source of truth for the IR shape every other
 * package compiles against. It must stay in lock-step with `IR_SPEC.md`.
 * Stable name: `arch.ir.v1`. Schema-version bumps require a coordinated
 * change across all consumers.
 */

export const IR_SCHEMA_VERSION = "arch.ir.v1";

// -------------------------------------------------------------------------
// Canonical root
// -------------------------------------------------------------------------

export interface CanonicalIR {
  readonly schema_version: typeof IR_SCHEMA_VERSION;
  readonly canonical_hash: string;
  readonly target: TargetIR;
  readonly models: readonly ModelIR[];
  readonly integrations: readonly IntegrationIR[];
  readonly policies: readonly PolicyIR[];
  readonly workflows: readonly WorkflowIR[];
  readonly customs: readonly CustomExtensionIR[];
  readonly artifacts: readonly ArtifactIR[];
  readonly ownership: readonly OwnershipIR[];
  readonly verification: VerificationIR;
  readonly guarantee_coverage: readonly GuaranteeCoverageIR[];
  readonly source_locations: readonly SourceLocationIR[];
}

// -------------------------------------------------------------------------
// Target
// -------------------------------------------------------------------------

export interface TargetIR {
  readonly stack: string;
  readonly cache: "redis" | "none";
}

export const DEFAULT_TARGET_STACK = "ts.node.fastify.postgres.prisma";
export const DEFAULT_TARGET_CACHE: TargetIR["cache"] = "redis";
export const SUPPORTED_TARGET_STACKS: ReadonlySet<string> = new Set([
  DEFAULT_TARGET_STACK,
]);
export const SUPPORTED_TARGET_CACHES: ReadonlySet<TargetIR["cache"]> = new Set([
  "redis",
  "none",
]);

// -------------------------------------------------------------------------
// Entity identity
//
// `EntityRef` is the stable, byte-comparable handle. It is what diffs and
// patch ops carry around to refer to entities without reaching into the IR.
// `EntityIR` is the base shape every concrete IR entity extends with its
// own fields.
// -------------------------------------------------------------------------

/** Stable typed reference to any IR entity. */
export interface EntityRef {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
}

export type EntityKind =
  | "model"
  | "field"
  | "relation"
  | "model_index"
  | "integration"
  | "policy"
  | "workflow"
  | "workflow_step"
  | "guarantee"
  | "custom";

/**
 * Base entity shape. `EntityIR` carries identity plus an optional
 * SourceLocation reference so consumers can reach back into the source map
 * without re-walking the IR.
 */
export interface EntityIR extends EntityRef {
  readonly source_location_id?: string;
}

// -------------------------------------------------------------------------
// Models, fields, relations, model indexes
// -------------------------------------------------------------------------

export interface ModelIR extends EntityIR {
  readonly kind: "model";
  readonly fields: readonly FieldIR[];
  readonly indexes: readonly ModelIndexIR[];
}

export interface FieldIR extends EntityIR {
  readonly kind: "field";
  readonly model_id: string;
  readonly type: FieldTypeIR;
  readonly nullable: boolean;
  readonly default?: unknown;
  /** True iff a field-level `indexed` modifier was present. */
  readonly indexed: boolean;
  readonly relation?: RelationIR;
}

/**
 * Field type as written in the IR. The literal-string form keeps backward
 * compatibility with serializers; the structural form is what semantic
 * validation produces and what the generator consumes.
 */
export type FieldTypeIR =
  | { readonly kind: "primitive"; readonly name: PrimitiveFieldType }
  | { readonly kind: "id" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "model_ref"; readonly target_model_id: string }
  | { readonly kind: "list"; readonly element: FieldTypeIR };

export type PrimitiveFieldType =
  | "string"
  | "int"
  | "bigint"
  | "float"
  | "boolean"
  | "timestamp"
  | "json";

export interface RelationIR extends EntityIR {
  readonly kind: "relation";
  readonly cardinality: RelationCardinality;
  readonly source_model_id: string;
  readonly target_model_id: string;
  readonly storage: "persisted" | "non_persisted";
}

export type RelationCardinality = "one_to_one" | "one_to_many" | "many_to_one";

/**
 * V1 only emits indexes that came from a field-level `indexed` modifier.
 * `source` is a discriminator so reserved index forms (named, composite)
 * can be added without changing the field shape.
 */
export interface ModelIndexIR extends EntityIR {
  readonly kind: "model_index";
  readonly model_id: string;
  readonly fields: readonly string[];
  readonly source: "field_modifier";
  readonly unique: boolean;
}

// -------------------------------------------------------------------------
// Integrations, policies
// -------------------------------------------------------------------------

export interface IntegrationIR extends EntityIR {
  readonly kind: "integration";
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface PolicyIR extends EntityIR {
  readonly kind: "policy";
  readonly body: string;
}

// -------------------------------------------------------------------------
// Workflows, triggers, steps, guarantees
// -------------------------------------------------------------------------

export interface WorkflowIR extends EntityIR {
  readonly kind: "workflow";
  readonly trigger: TriggerIR;
  readonly steps: readonly WorkflowStepIR[];
  readonly guarantees: readonly GuaranteeIR[];
}

export type TriggerIR = ApiTriggerIR;

export interface ApiTriggerIR {
  readonly kind: "api";
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly auth: "none" | "required" | "optional";
}

export interface WorkflowStepIR extends EntityIR {
  readonly kind: "workflow_step";
  readonly workflow_id: string;
  /** Source-order index. Workflow step order is semantic and is preserved. */
  readonly order: number;
  readonly operation: WorkflowStepOperationIR;
}

export type WorkflowStepOperationIR =
  | { readonly kind: "validate"; readonly target: string }
  | { readonly kind: "sanitize"; readonly target: string; readonly policy_id?: string }
  | { readonly kind: "insert"; readonly model_id: string }
  | { readonly kind: "update"; readonly model_id: string }
  | { readonly kind: "delete"; readonly model_id: string }
  | { readonly kind: "call"; readonly integration_id: string; readonly operation: string }
  | { readonly kind: "emit"; readonly event: string }
  | { readonly kind: "custom_call"; readonly custom_id: string };

export interface GuaranteeIR extends EntityIR {
  readonly kind: "guarantee";
  readonly workflow_id: string;
  readonly form: "short" | "long";
  /** Bound arguments for short-form (`<= 250` etc.) or long-form blocks. */
  readonly arguments: Readonly<Record<string, unknown>>;
}

// -------------------------------------------------------------------------
// Custom extensions
// -------------------------------------------------------------------------

export interface CustomExtensionIR extends EntityIR {
  readonly kind: "custom";
  /** The literal `kind:` value declared in source. */
  readonly customKind: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

// -------------------------------------------------------------------------
// Artifacts, ownership
// -------------------------------------------------------------------------

export interface ArtifactIR {
  readonly artifact_id: string;
  /** Project-relative POSIX path. */
  readonly path: string;
  readonly entity_ids: readonly string[];
  readonly ownership_id: string;
  readonly generation: ArtifactGenerationIR;
}

export interface ArtifactGenerationIR {
  readonly mode: "full_file" | "generated_region" | "stub" | "manual";
  readonly generator_id: string;
  readonly template_id?: string;
  /**
   * Hash of the canonical IR fragment used to generate this artifact. The
   * fragment must not include timestamps, absolute paths, or runtime
   * verification output, so the hash is deterministic given semantic intent.
   */
  readonly ir_fragment_hash: string;
}

/**
 * Ownership write-scope union per IR_SPEC.md §6.15:
 *   - `whole_file`        — generated files; arch may rewrite the entire file.
 *   - `generated_region`  — arch may patch only inside marked regions.
 *   - `stub_only`         — extension points; arch may write the initial stub
 *                           once but never overwrite human edits afterwards.
 *   - `none`              — human-owned files; arch must never write.
 */
export type OwnershipWriteScope =
  | "whole_file"
  | "generated_region"
  | "stub_only"
  | "none";

export type OwnershipKind =
  | "generated_file"
  | "generated_region"
  | "extension_point"
  | "human_file";

export interface OwnershipIR {
  readonly ownership_id: string;
  readonly artifact_id: string;
  readonly ownership_kind: OwnershipKind;
  readonly write_scope: OwnershipWriteScope;
  /** Arch is the writer for everything except `human_file`/`none`. */
  readonly owner: "arch" | "human";
  /** Optional region descriptor for `generated_region` ownership. */
  readonly region?: OwnershipRegionIR;
}

export interface OwnershipRegionIR {
  readonly kind: "whole_file" | "line_span" | "generated_marker" | "semantic_region";
  readonly start_line?: number;
  readonly end_line?: number;
  readonly marker_id?: string;
}

// -------------------------------------------------------------------------
// Verification
// -------------------------------------------------------------------------

export interface VerificationIR {
  readonly typecheck: boolean;
  readonly tests: boolean;
  readonly migrations: boolean;
}

// -------------------------------------------------------------------------
// Guarantee coverage
// -------------------------------------------------------------------------

export type GuaranteeCoverageStatus =
  | "covered"
  | "partially_covered"
  | "manual"
  | "missing";

export interface GuaranteeCoverageIR {
  readonly guarantee_id: string;
  readonly status: GuaranteeCoverageStatus;
  readonly artifact_ids: readonly string[];
}

// -------------------------------------------------------------------------
// Source locations
// -------------------------------------------------------------------------

export interface SourceLocationIR {
  readonly id: string;
  readonly entity_id: string;
  readonly file: string;
  readonly start_line: number;
  readonly start_column: number;
  readonly end_line: number;
  readonly end_column: number;
}
