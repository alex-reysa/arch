# IR_SPEC.md

# Arch Intermediate Representation Specification

**Status:** V1 canonical technical specification  
**Applies to:** Arch V1  
**IR schema version:** `arch.ir.v1`  
**Default target:** TypeScript, Node.js, Fastify, PostgreSQL, Prisma, Redis by default or `cache: none` / `cache:none`, Vitest, Docker Compose, pnpm

## 1. Overview

Arch is a spec-to-code synchronization system for AI-generated backend software. Developers write structured `.arch` source files that describe backend intent: models, workflows, triggers, integrations, policies, tests, and behavioral guarantees. Arch parses those files, compiles them into a typed intermediate representation, computes minimal intent diffs between IR snapshots, maps diffs to generated artifacts, patches affected implementation regions, and verifies the result against generated tests and declared guarantees.

The IR is the canonical machine-readable contract between the `.arch` language and the rest of the compiler/runtime pipeline. `.arch` syntax is intentionally not used directly for generation, diffing, or verification. Source syntax can contain shorthand, ordering choices, comments, and human-oriented phrasing. The IR removes those ambiguities and gives downstream components a deterministic, validated, typed, source-mapped representation of system intent.

This document formalizes the V1 IR for the narrow product scope described in the Arch product context: a TypeScript backend workflow service synchronized from durable system intent, with implementation code treated as an inspectable build artifact and `.arch` intent treated as the source of truth. The product context establishes the core loop of `.arch → typed IR → intent diff → patch plan → constrained implementation edits → generated tests → verification`, the V1 backend stack, and the requirement to preserve generated/human ownership boundaries.

The canonical V1 pipeline is Parser -> AST -> draft semantic model or draft IR -> semantic validation -> canonical IR -> IR schema validation -> IR snapshot store -> typed diff -> dependency graph -> sync plan -> deterministic templates or constrained agents -> verification -> metadata promotion. The IR is the contract that keeps each stage deterministic, typed, source-mapped, artifact-aware, and ownership-aware.

## 2. Purpose of the IR

The IR exists to make Arch deterministic, auditable, and incrementally synchronizable.

A `.arch` source file should not directly drive code generation because source syntax is not a stable compiler boundary. It may include shorthand declarations, omitted defaults, equivalent reorderings, inconsistent whitespace, source comments, and future syntactic sugar. Direct generation from source would make formatting changes look like system changes and would force every downstream component to understand every surface-language feature.

The IR provides these capabilities:

| Capability | IR responsibility |
|---|---|
| Deterministic normalization | Convert equivalent `.arch` inputs into one canonical JSON shape. |
| Semantic validation | Resolve references and reject invalid or unsupported V1 constructs before planning. |
| Stable entity identity | Assign stable IDs to all entities that survive formatting changes and reordering. |
| Typed diffs | Compare previous and current IR snapshots using structured entity-level change types. |
| Dependency graph construction | Identify which entities depend on models, fields, workflows, integrations, guarantees, and policies. |
| Artifact mapping | Record which generated files or regions implement each IR entity. |
| Ownership enforcement | Distinguish generated, mixed, extension-point, and human-owned artifacts. |
| Guarantee-to-test mapping | Map behavioral guarantees to generated tests, static checks, runtime assertions, or manual verification warnings. |
| Verification | Define expected verification commands, test artifacts, and guarantee coverage. |
| Drift detection | Compare implementation artifacts and generated regions back to the IR snapshot that produced them. |
| Traceability | Preserve source locations and source hashes for errors, plans, generated files, and drift reports. |

## 3. V1 Design Principles

### 3.1 Canonicalization before generation

All code generation, diffing, planning, verification, and artifact mapping operate on canonical IR, not on raw AST or source text.

Canonicalization must:

- expand shorthand into explicit typed objects;
- apply default values explicitly;
- resolve all references to fully qualified entity IDs;
- normalize scalar units, such as `200ms`, into typed duration values;
- sort unordered collections deterministically;
- preserve meaningful ordered collections, such as workflow steps and enum values;
- remove comments and formatting from semantic comparison;
- compute canonical hashes over normalized IR, not over raw source.

### 3.2 Determinism

Given the same `.arch` semantic input and compiler version, IR generation must produce byte-for-byte identical canonical JSON.

The canonical IR must not contain timestamps, random UUIDs, local absolute paths, process IDs, hostnames, or non-deterministic ordering. Runtime metadata may be stored outside canonical IR snapshots, but must not participate in the canonical IR hash.

### 3.3 Typed entities, not prompt strings

Every meaningful construct is represented as a typed IR entity with a `kind`, stable `id`, validation rules, source mapping, and, when applicable, ownership and artifact mapping metadata.

Natural-language descriptions may exist as metadata, especially for guarantees, but they are never the only representation of behavior that Arch depends on.

### 3.4 Incrementality

The IR must support minimal changes. Adding a field, changing a guarantee threshold, or reordering workflow steps must produce localized typed diffs. The planner must be able to identify affected artifacts without regenerating the entire backend.

### 3.5 Explicit unsupported behavior

Unsupported V1 features must be rejected with explicit validation errors. The compiler must not silently convert unsupported requirements into vague implementation instructions.

### 3.6 Traceability

Every generated artifact, generated region, test, and verification expectation should be traceable to one or more IR entity IDs and source locations.

### 3.7 Ownership boundaries

Arch may update generated artifacts and generated regions. It must not overwrite human-owned files or completed extension-point implementations without explicit developer action.

## 4. Canonical IR Document Shape

The canonical IR document is a JSON object with the following top-level shape:

```ts
interface ArchIR {
  schema_version: "arch.ir.v1";
  canonical_hash: string;
  system: SystemIR;
  target: TargetIR;
  models: ModelIR[];
  custom_extensions: CustomExtensionIR[];
  workflows: WorkflowIR[];
  integrations: IntegrationIR[];
  policies: PolicyIR[];
  guarantees: GuaranteeIR[];
  tests: TestIR[];
  artifacts: ArtifactIR[];
  ownership: OwnershipIR[];
  sources: SourceLocationIR[];
  verification: VerificationIR;
}
```

### 4.1 Canonical JSON rules

The canonical JSON serializer must apply these rules:

1. Use UTF-8 without BOM.
2. Use Unix line endings.
3. Sort object keys lexicographically.
4. Sort unordered entity arrays by `id`.
5. Preserve workflow `steps` order by numeric `order`.
6. Preserve enum value order as declared, because enum ordering may be reflected in generated code or migrations.
7. Omit fields whose value is `null` unless the field is required by schema.
8. Emit empty arrays for required collection fields when no entries exist.
9. Normalize source paths to repository-relative POSIX paths.
10. Normalize durations into `{ "value": number, "unit": "ms" | "s" }`.
11. Normalize identifiers using the entity ID rules in Section 7.
12. Compute `canonical_hash` as `sha256:` plus the SHA-256 digest of the canonical IR document with `canonical_hash` temporarily omitted.

### 4.2 Entity ordering

These arrays are unordered and must be sorted by `id`:

- `models`
- `custom_extensions`
- `integrations`
- `policies`
- `guarantees`
- `tests`
- `artifacts`
- `ownership`
- `sources`

These arrays preserve declared semantic order:

- `WorkflowIR.steps`
- `StepIR.depends_on`, when it encodes an explicit ordered dependency list
- enum values in `FieldIR.type.values`

## 5. Common Types

### 5.1 Entity reference

An entity reference is a string containing a stable entity ID.

```ts
type EntityRef = string;
```

Examples:

```json
"model.Post"
"model.Post.field.content"
"workflow.CreatePost.step.sanitize_post_content"
"guarantee.notification_failure_does_not_rollback_post"
```

Validation:

- The referenced entity must exist in the same IR document unless explicitly marked as an external extension point.
- References must point to an entity kind compatible with the consuming field.
- References must be fully qualified. Bare names are allowed in `.arch` source but not in canonical IR.

### 5.2 Entity identity

All first-class entities include identity metadata.

```ts
interface EntityIdentityIR {
  id: string;
  kind: EntityKind;
  name: string;
  display_name?: string;
  aliases: string[];
  source_id: string;
}
```

Required fields:

- `id`: stable canonical entity ID.
- `kind`: one of the allowed entity kinds.
- `name`: semantic name from source or compiler-generated semantic name.
- `aliases`: previous IDs or alternate semantic names used for rename detection.
- `source_id`: ID of the primary `SourceLocationIR` entry.

Allowed `kind` values:

```text
system
target
model
model_field
relation
model_index
workflow
trigger
workflow_step
integration
custom_extension
policy
guarantee
test
artifact
ownership
source_location
verification
```

Validation:

- `id` must be unique across the IR document.
- `aliases` must not contain the entity's current `id`.
- No two entities may share the same alias unless they are both removed entities in a diff context.
- `source_id` must reference an existing source location unless the entity is compiler-injected.

### 5.3 Scalar values

```ts
type PrimitiveScalar = string | number | boolean;
```

IR scalar values must be JSON primitives or typed objects. Compiler-specific symbolic values must not be encoded as ad hoc strings.

### 5.4 Duration value

```ts
interface DurationIR {
  value: number;
  unit: "ms" | "s";
}
```

Validation:

- `value` must be positive.
- V1 canonicalization should emit milliseconds for values less than 1000ms and seconds only when explicitly declared in seconds.
- Comparisons must convert to milliseconds internally.

Example:

```json
{ "value": 200, "unit": "ms" }
```

### 5.5 Type descriptor

Fields, inputs, outputs, and predicates use typed descriptors.

```ts
interface TypeDescriptorIR {
  kind:
    | "uuid"
    | "string"
    | "text"
    | "int"
    | "bigint"
    | "float"
    | "decimal"
    | "boolean"
    | "timestamp"
    | "date"
    | "json"
    | "enum"
    | "model_ref"
    | "model_ref_list";
  values?: string[];
  model_id?: EntityRef;
}
```

Validation:

- `values` is required for `enum` and forbidden for non-enum kinds.
- `model_id` is required for `model_ref` and `model_ref_list` and forbidden for non-reference kinds.
- `model_ref` and `model_ref_list` must point to an existing `ModelIR`.
- `model_ref_list` is valid only for non-persisted inverse relation fields represented by `RelationIR`. It must not create a scalar array column.
- V1 does not support arbitrary nested object schemas outside `json`.
- V1 rejects scalar arrays and implicit many-to-many relations.

### 5.6 Constraint descriptor

```ts
interface ConstraintIR {
  required: boolean;
  unique: boolean;
  primary: boolean;
  indexed: boolean;
  immutable: boolean;
  max_length?: number;
  min_length?: number;
  default?: PrimitiveScalar | { kind: "now" | "uuid" };
}
```

Validation:

- `primary: true` implies `required: true` and `unique: true`.
- `max_length` and `min_length` are valid only for `string` or `text` fields.
- `default.kind = "now"` is valid only for `timestamp` or `date`.
- `default.kind = "uuid"` is valid only for `uuid`.
- `min_length` must be less than or equal to `max_length`.

### 5.7 Field storage descriptor

`FieldStorageIR` describes how a field maps to persistence. It makes inverse relations, generated foreign keys, and non-persisted fields explicit for diffing and artifact planning.

```ts
interface FieldStorageIR {
  persisted: boolean;
  storage_kind: "column" | "relation_field" | "generated_foreign_key" | "virtual_inverse_relation";
  column_name?: string;
  generated: boolean;
  relation_id?: EntityRef;
}
```

Validation:

- Scalar, enum, JSON, timestamp, and direct model reference fields normally use `persisted: true`.
- Inverse one-to-many fields use `persisted: false` and `storage_kind: "virtual_inverse_relation"`.
- Generated foreign key columns are represented through `RelationIR.foreign_key`; they may be reflected in artifact generation but are not user-authored scalar fields.
- `storage.relation_id`, when present, must reference an existing `RelationIR`.

### 5.8 Common structured metadata

These helper shapes are referenced by entity schemas and must be validated as part of `arch.ir.v1`.

```ts
interface IndexIR extends EntityIdentityIR {
  kind: "model_index";
  model_id: EntityRef;
  field_ids: EntityRef[];
  unique: boolean;
  generated: boolean;
  source_id: string;
}

interface IntegrationConfigFieldIR {
  name: string;
  type: "string" | "boolean" | "int" | "secret" | "json";
  required: boolean;
  default?: PrimitiveScalar | { kind: "none" };
}

interface PolicyRuleIR {
  field: string;
  operator: "equals" | "not_equals" | "lte" | "gte" | "lt" | "gt" | "in";
  value: PrimitiveScalar | DurationIR | PrimitiveScalar[] | DurationIR[];
}

interface TestAssertionIR {
  type: string;
  entity_id?: EntityRef;
  field_id?: EntityRef;
  workflow_id?: EntityRef;
  integration_id?: EntityRef;
  predicate?: string;
  expected?: PrimitiveScalar | DurationIR;
  parameters?: Record<string, unknown>;
}

interface TestFixtureIR {
  name: string;
  value: unknown;
}
```

Validation:

- `IndexIR.field_ids` must reference fields on `model_id`.
- V1 source-level named or composite indexes are reserved unless the implementation explicitly supports `IndexIR`; field-level `indexed` remains represented by `FieldIR.constraints.indexed`.
- `secret` config fields describe required runtime configuration only. Secret values must not appear in IR.
- Policy operators are canonicalized from source operators, for example `==` to `equals` and `<=` to `lte`.

### 5.9 Risk and change classification

```ts
type ChangeClass = "additive" | "modifying" | "destructive" | "ambiguous";
type RiskLevel = "low" | "medium" | "high" | "critical";
```

Rules:

- `additive`: adds behavior, schema, test, or mapping without removing existing behavior.
- `modifying`: changes existing behavior or constraints while preserving the entity identity.
- `destructive`: can remove data, drop generated behavior, break API compatibility, or invalidate existing artifacts.
- `ambiguous`: cannot be safely interpreted without a rename hint, migration hint, or developer decision.

## 6. Core Entity Schemas

### 6.1 SystemIR

`SystemIR` represents the root system declaration.

```ts
interface SystemIR extends EntityIdentityIR {
  kind: "system";
  name: string;
  description?: string;
  namespace: string;
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `aliases`
- `source_id`
- `namespace`

Optional fields:

- `description`
- `display_name`

Allowed values:

- `kind` must be `system`.
- `namespace` must be a filesystem-safe lowercase identifier generated from the system name unless explicitly declared.

Validation rules:

- Exactly one `SystemIR` is allowed per IR document.
- `name` must be unique at the system root.
- V1 supports one backend service per system.
- V1 rejects multi-service system declarations.

Example:

```json
{
  "id": "system.SocialFeed",
  "kind": "system",
  "name": "SocialFeed",
  "namespace": "social_feed",
  "aliases": [],
  "source_id": "source.backend_arch.system.SocialFeed"
}
```

### 6.2 TargetIR

`TargetIR` defines the supported implementation stack.

```ts
interface TargetIR extends EntityIdentityIR {
  kind: "target";
  language: "typescript";
  runtime: "node.fastify";
  database: "postgres";
  orm: "prisma";
  cache: "redis" | "none";
  test_framework: "vitest";
  local_runtime: "docker_compose";
  package_manager: "pnpm";
  auth: "oauth.github" | "none" | "custom";
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `language`
- `runtime`
- `database`
- `orm`
- `cache`
- `test_framework`
- `local_runtime`
- `package_manager`
- `auth`
- `aliases`
- `source_id`

Allowed V1 values:

| Field | Allowed values |
|---|---|
| `language` | `typescript` |
| `runtime` | `node.fastify` |
| `database` | `postgres` |
| `orm` | `prisma` |
| `cache` | `redis`, `none` |
| `test_framework` | `vitest` |
| `local_runtime` | `docker_compose` |
| `package_manager` | `pnpm` |
| `auth` | `oauth.github`, `none`, `custom` |

Validation rules:

- Exactly one target is allowed.
- Unsupported target values must be rejected, not downgraded.
- Changing `database`, `orm`, `runtime`, or `language` is at least `target_changed` with high risk and normally destructive or ambiguous.
- `cache: redis` requires generated Redis runtime configuration.
- Source spellings `cache: none` and `cache:none` canonicalize to IR `cache: "none"`; normal V1 source uses `cache: none`.
- `cache: none` rejects workflow steps that require generated cache artifacts unless those steps are represented as declared custom extension calls.

Example:

```json
{
  "id": "target.primary",
  "kind": "target",
  "name": "primary",
  "language": "typescript",
  "runtime": "node.fastify",
  "database": "postgres",
  "orm": "prisma",
  "cache": "redis",
  "test_framework": "vitest",
  "local_runtime": "docker_compose",
  "package_manager": "pnpm",
  "auth": "oauth.github",
  "aliases": [],
  "source_id": "source.backend_arch.target.primary"
}
```

### 6.3 ModelIR

`ModelIR` represents a persistent domain model.

```ts
interface ModelIR extends EntityIdentityIR {
  kind: "model";
  fields: FieldIR[];
  relations: RelationIR[];
  indexes: IndexIR[];
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `fields`
- `relations`
- `indexes`
- `aliases`
- `source_id`

Optional fields:

- `display_name`

Validation rules:

- Model names must be unique within the system.
- Each model must declare exactly one primary field in V1.
- Each model must have at least one field.
- Field names must be unique within a model.
- Relation names must be unique within a model.
- V1 maps each model to one Prisma model.
- V1 rejects polymorphic models, inheritance, embedded documents, and cross-database models.

Example:

```json
{
  "id": "model.Post",
  "kind": "model",
  "name": "Post",
  "fields": [
    {
      "id": "model.Post.field.id",
      "kind": "model_field",
      "name": "id",
      "model_id": "model.Post",
      "type": { "kind": "uuid" },
      "constraints": {
        "required": true,
        "unique": true,
        "primary": true,
        "indexed": true,
        "immutable": true,
        "default": { "kind": "uuid" }
      },
      "aliases": [],
      "source_id": "source.backend_arch.model.Post.field.id"
    }
  ],
  "relations": [],
  "indexes": [],
  "aliases": [],
  "source_id": "source.backend_arch.model.Post"
}
```

### 6.4 FieldIR

`FieldIR` represents a scalar, enum, JSON, timestamp, or model-reference field declared on a model.

```ts
interface FieldIR extends EntityIdentityIR {
  kind: "model_field";
  model_id: EntityRef;
  type: TypeDescriptorIR;
  constraints: ConstraintIR;
  storage?: FieldStorageIR;
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `model_id`
- `type`
- `constraints`
- `aliases`
- `source_id`

Optional fields:

- `storage`
- `display_name`

Allowed field type kinds:

```text
uuid
string
text
int
bigint
float
decimal
boolean
timestamp
date
json
enum
model_ref
model_ref_list
```

Validation rules:

- `model_id` must point to an existing `ModelIR`.
- `id` must be `model.<ModelName>.field.<field_name>` unless a future explicit identity annotation is used.
- `primary` fields must be scalar, not `model_ref`.
- `required: true` means non-null persistence and required validation unless the field has a generated default.
- `enum` fields must have at least one value, and values must be unique.
- `model_ref` fields must have a corresponding `RelationIR`.
- `model_ref_list` fields are allowed only for inverse one-to-many relation views. They must use `storage.persisted: false` and must not generate scalar array persistence.
- Changing `type.kind` is a `model_field_type_changed` diff.
- Changing constraints is a `model_field_constraint_changed` diff.

Example:

```json
{
  "id": "model.Post.field.content",
  "kind": "model_field",
  "name": "content",
  "model_id": "model.Post",
  "type": { "kind": "string" },
  "constraints": {
    "required": true,
    "unique": false,
    "primary": false,
    "indexed": false,
    "immutable": false,
    "max_length": 5000
  },
  "aliases": [],
  "source_id": "source.backend_arch.model.Post.field.content"
}
```

Enum example:

```json
{
  "id": "model.Post.field.visibility",
  "kind": "model_field",
  "name": "visibility",
  "model_id": "model.Post",
  "type": {
    "kind": "enum",
    "values": ["public", "private", "followers"]
  },
  "constraints": {
    "required": true,
    "unique": false,
    "primary": false,
    "indexed": true,
    "immutable": false,
    "default": "public"
  },
  "aliases": [],
  "source_id": "source.backend_arch.model.Post.field.visibility"
}
```

### 6.5 RelationIR

`RelationIR` represents a semantic relationship between models. A relation may be produced by source syntax such as `author: User required`.

```ts
interface RelationIR extends EntityIdentityIR {
  kind: "relation";
  from_model_id: EntityRef;
  to_model_id: EntityRef;
  field_id: EntityRef;
  inverse_field_id?: EntityRef;
  via_relation_id?: EntityRef;
  declaration_kind: "inline_field" | "relation_block" | "inverse_field" | "compiler_generated";
  cardinality: "many_to_one" | "one_to_many" | "one_to_one";
  required: boolean;
  foreign_key: {
    field_name: string;
    generated: boolean;
  };
  on_delete: "restrict" | "cascade" | "set_null" | "no_action";
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `from_model_id`
- `to_model_id`
- `field_id`
- `declaration_kind`
- `cardinality`
- `required`
- `foreign_key`
- `on_delete`
- `aliases`
- `source_id`

Optional fields:

- `inverse_field_id`
- `via_relation_id`

Allowed V1 relation cardinalities:

- `many_to_one`
- `one_to_many`
- `one_to_one`

Validation rules:

- `from_model_id` and `to_model_id` must point to existing models.
- For inline and relation-block declarations, `field_id` must point to a `FieldIR` with `type.kind = "model_ref"`.
- For inverse one-to-many declarations, `field_id` points to the underlying forward relation field, `inverse_field_id` points to the source `model_ref_list` field, `via_relation_id` points to the forward relation, and the inverse field must use `storage.persisted: false`.
- `required: true` is incompatible with `on_delete: set_null`.
- V1 rejects implicit many-to-many relations. Use an explicit join model instead.
- If no `on_delete` is declared, default to `restrict`.
- The generated foreign key field must not collide with declared fields.
- Relation order is not semantic. Relation identity and `via_relation_id` drive diffs.

Example:

```json
{
  "id": "relation.Post.author.User",
  "kind": "relation",
  "name": "author",
  "from_model_id": "model.Post",
  "to_model_id": "model.User",
  "field_id": "model.Post.field.author",
  "declaration_kind": "inline_field",
  "cardinality": "many_to_one",
  "required": true,
  "foreign_key": {
    "field_name": "author_id",
    "generated": true
  },
  "on_delete": "restrict",
  "aliases": [],
  "source_id": "source.backend_arch.model.Post.field.author"
}
```

### 6.6 WorkflowIR

`WorkflowIR` represents an executable backend workflow.

```ts
interface WorkflowIR extends EntityIdentityIR {
  kind: "workflow";
  trigger: TriggerIR;
  steps: StepIR[];
  guarantee_ids: EntityRef[];
  policy_ids: EntityRef[];
  input_model_id?: EntityRef;
  output_model_id?: EntityRef;
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `trigger`
- `steps`
- `guarantee_ids`
- `policy_ids`
- `aliases`
- `source_id`

Optional fields:

- `input_model_id`
- `output_model_id`
- `display_name`

Validation rules:

- Workflow names must be unique.
- A workflow must have exactly one trigger in V1.
- A workflow must have at least one step.
- Step IDs must be unique within the workflow.
- Step `order` values must be contiguous integers starting at `1` after canonicalization.
- Each referenced model, field, integration, policy, and guarantee must exist.
- Unsupported trigger kinds must be rejected.
- The same API method/path combination must not be used by more than one workflow.

Example:

```json
{
  "id": "workflow.CreatePost",
  "kind": "workflow",
  "name": "CreatePost",
  "trigger": {
    "id": "workflow.CreatePost.trigger.api_post_posts",
    "kind": "trigger",
    "name": "api_post_posts",
    "workflow_id": "workflow.CreatePost",
    "trigger_kind": "api",
    "api": {
      "method": "POST",
      "path": "/posts",
      "auth_required": true
    },
    "aliases": [],
    "source_id": "source.backend_arch.workflow.CreatePost.trigger"
  },
  "steps": [],
  "guarantee_ids": [
    "guarantee.no_unsanitized_html_persisted",
    "guarantee.notification_failure_does_not_rollback_post"
  ],
  "policy_ids": [],
  "aliases": [],
  "source_id": "source.backend_arch.workflow.CreatePost"
}
```

### 6.7 TriggerIR

`TriggerIR` represents how a workflow is invoked.

```ts
interface TriggerIR extends EntityIdentityIR {
  kind: "trigger";
  workflow_id: EntityRef;
  trigger_kind: "api";
  api: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    auth_required: boolean;
  };
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `workflow_id`
- `trigger_kind`
- `api`
- `aliases`
- `source_id`

Allowed V1 trigger kinds:

- `api`

Validation rules:

- `workflow_id` must point to an existing workflow.
- `api.path` must start with `/`.
- `api.path` must not contain a query string.
- Dynamic segments must use Fastify-compatible parameter syntax in generated code, but canonical IR stores the source path as a normalized path string.
- API trigger method/path pairs must be unique.
- V1 rejects cron, queue, webhook subscription, event bus, and streaming triggers unless represented as `custom` extension points outside generated runtime behavior. Generated support is not provided for those triggers in V1.

Example:

```json
{
  "id": "workflow.CreatePost.trigger.api_post_posts",
  "kind": "trigger",
  "name": "api_post_posts",
  "workflow_id": "workflow.CreatePost",
  "trigger_kind": "api",
  "api": {
    "method": "POST",
    "path": "/posts",
    "auth_required": true
  },
  "aliases": [],
  "source_id": "source.backend_arch.workflow.CreatePost.trigger"
}
```

### 6.8 StepIR

`StepIR` represents one ordered workflow operation.

```ts
interface StepIR extends EntityIdentityIR {
  kind: "workflow_step";
  workflow_id: EntityRef;
  order: number;
  operation: StepOperationIR;
  reads: EntityRef[];
  writes: EntityRef[];
  uses_integrations: EntityRef[];
  depends_on: EntityRef[];
  failure_behavior: "rollback_workflow" | "continue" | "record_error" | "retry_then_continue" | "retry_then_fail";
  transaction_boundary: "inside_transaction" | "outside_transaction" | "starts_transaction" | "commits_transaction" | "none";
  source_id: string;
}
```

`StepOperationIR`:

```ts
interface StepOperationIR {
  type:
    | "validate_input"
    | "moderate_content"
    | "sanitize_field"
    | "insert_model"
    | "update_cache"
    | "notify_users"
    | "call_custom"
    | "return_response";
  target?: EntityRef;
  field_id?: EntityRef;
  model_id?: EntityRef;
  integration_id?: EntityRef;
  custom_extension_id?: EntityRef;
  parameters: Record<string, unknown>;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `workflow_id`
- `order`
- `operation`
- `reads`
- `writes`
- `uses_integrations`
- `depends_on`
- `failure_behavior`
- `transaction_boundary`
- `aliases`
- `source_id`

Allowed V1 operation types:

- `validate_input`
- `moderate_content`
- `sanitize_field`
- `insert_model`
- `update_cache`
- `notify_users`
- `call_custom`
- `return_response`

Validation rules:

- `workflow_id` must point to an existing workflow.
- `order` must be positive.
- `operation.target`, `field_id`, `model_id`, `integration_id`, and `custom_extension_id`, when present, must reference existing compatible entities.
- `moderate_content` requires an integration of kind `llm_moderation`.
- `notify_users` requires an integration of kind `push`, `email`, or `custom`.
- `update_cache` requires `target.cache = redis` or a declared custom cache extension point.
- `insert_model` must write an existing model.
- `sanitize_field` must target a string or text field.
- `call_custom` requires a declared `CustomExtensionIR` with kind `function` or `workflow_step`.
- Steps that use non-required integrations may use `continue`, `record_error`, or retry behavior. Required integrations normally use `rollback_workflow` or `retry_then_fail`.
- Transactional guarantees can impose additional validation on step placement.

Example:

```json
{
  "id": "workflow.CreatePost.step.sanitize_post_content",
  "kind": "workflow_step",
  "name": "sanitize_post_content",
  "workflow_id": "workflow.CreatePost",
  "order": 3,
  "operation": {
    "type": "sanitize_field",
    "field_id": "model.Post.field.content",
    "parameters": {
      "mode": "html_safe"
    }
  },
  "reads": ["model.Post.field.content"],
  "writes": ["model.Post.field.content"],
  "uses_integrations": [],
  "depends_on": ["workflow.CreatePost.step.moderate_post_content"],
  "failure_behavior": "rollback_workflow",
  "transaction_boundary": "none",
  "aliases": [],
  "source_id": "source.backend_arch.workflow.CreatePost.step.sanitize_post_content"
}
```

### 6.9 IntegrationIR

`IntegrationIR` represents an external service, provider, or custom boundary used by workflows.

```ts
interface IntegrationIR extends EntityIdentityIR {
  kind: "integration";
  integration_kind:
    | "llm_moderation"
    | "push"
    | "email"
    | "cache"
    | "auth"
    | "custom";
  required: boolean;
  provider?: string;
  config_schema: IntegrationConfigFieldIR[];
  failure_policy: "fail_workflow" | "best_effort" | "retry" | "custom";
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `integration_kind`
- `required`
- `config_schema`
- `failure_policy`
- `aliases`
- `source_id`

Optional fields:

- `provider`
- `display_name`

Allowed V1 integration kinds:

- `llm_moderation`
- `push`
- `email`
- `cache`
- `auth`
- `custom`

Validation rules:

- Integration names must be unique.
- `required: true` with `failure_policy: best_effort` is invalid unless a workflow guarantee explicitly scopes the failure as non-blocking.
- Referenced integrations must exist before workflow validation succeeds.
- V1 generates stubs and typed interfaces for integrations; provider-specific production SDK configuration may be custom or limited to explicit provider templates.
- Unknown integration kinds are rejected.

Example:

```json
{
  "id": "integration.PushProvider",
  "kind": "integration",
  "name": "PushProvider",
  "integration_kind": "push",
  "required": false,
  "provider": "custom",
  "config_schema": [],
  "failure_policy": "best_effort",
  "aliases": [],
  "source_id": "source.backend_arch.integration.PushProvider"
}
```

### 6.10 CustomExtensionIR

`CustomExtensionIR` represents a source-level `custom` declaration. It is the IR anchor for typed human-owned extension points, even when the extension is not yet called by a workflow.

```ts
interface CustomExtensionIR extends EntityIdentityIR {
  kind: "custom_extension";
  extension_kind: "function" | "workflow_step" | "policy";
  input_types: TypeDescriptorIR[];
  output_type?: TypeDescriptorIR;
  file: string;
  export_name: string;
  artifact_id?: EntityRef;
  ownership_id?: EntityRef;
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `extension_kind`
- `input_types`
- `file`
- `export_name`
- `aliases`
- `source_id`

Optional fields:

- `output_type`
- `artifact_id`
- `ownership_id`
- `display_name`

Validation rules:

- Custom extension names must be unique.
- `file` must be repository-relative and should normally be under `src/custom/`.
- `export_name` must be a non-empty exported symbol name.
- `input_types` and `output_type`, when model-based, must reference existing models.
- `function` and `workflow_step` custom extensions may be called from `StepIR.operation.type = "call_custom"`.
- `policy` custom extensions may be referenced by `PolicyIR` with `enforcement: "custom"`.
- Custom test generators are reserved for post-V1 and must be rejected by semantic validation.
- The compiler may create an extension stub when missing, but ownership must be `extension_point` and must prevent overwriting human implementation without confirmation.

Example:

```json
{
  "id": "custom_extension.PostRankingStrategy",
  "kind": "custom_extension",
  "name": "PostRankingStrategy",
  "extension_kind": "function",
  "input_types": [{ "kind": "model_ref", "model_id": "model.Post" }],
  "output_type": { "kind": "decimal" },
  "file": "src/custom/postRankingStrategy.ts",
  "export_name": "postRankingStrategy",
  "artifact_id": "artifact.src_custom_postRankingStrategy_ts",
  "ownership_id": "ownership.src_custom_postRankingStrategy_ts",
  "aliases": [],
  "source_id": "source.backend_arch.custom.PostRankingStrategy"
}
```

### 6.11 PolicyIR

`PolicyIR` represents a reusable execution, authorization, retry, caching, or transaction policy.

```ts
interface PolicyIR extends EntityIdentityIR {
  kind: "policy";
  policy_kind:
    | "auth"
    | "authorization"
    | "retry"
    | "transaction"
    | "idempotency"
    | "cache"
    | "rate_limit"
    | "custom";
  scope: EntityRef[];
  rules: PolicyRuleIR[];
  enforcement: "generated_code" | "runtime_assertion" | "manual" | "custom";
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `policy_kind`
- `scope`
- `rules`
- `enforcement`
- `aliases`
- `source_id`

Allowed V1 policy kinds:

- `auth`
- `authorization`
- `retry`
- `transaction`
- `idempotency`
- `cache`
- `rate_limit`
- `custom`

Validation rules:

- `scope` entries must reference existing entities.
- Policies must not contradict guarantees. Example: a transaction policy that places push notification inside a transaction conflicts with a guarantee that notification failure must not rollback post creation.
- `manual` enforcement must be reported in the plan and verification report.
- Unknown policy kinds are rejected.

Example:

```json
{
  "id": "policy.create_post_notifications_best_effort",
  "kind": "policy",
  "name": "create_post_notifications_best_effort",
  "policy_kind": "retry",
  "scope": ["workflow.CreatePost.step.notify_mentioned_users"],
  "rules": [
    {
      "field": "max_attempts",
      "operator": "equals",
      "value": 3
    }
  ],
  "enforcement": "generated_code",
  "aliases": [],
  "source_id": "source.backend_arch.policy.create_post_notifications_best_effort"
}
```

### 6.12 GuaranteeIR

`GuaranteeIR` represents a first-class behavioral guarantee.

```ts
interface GuaranteeIR extends EntityIdentityIR {
  kind: "guarantee";
  category:
    | "data_integrity"
    | "transactional_behavior"
    | "security_safety"
    | "moderation"
    | "latency"
    | "integration_failure"
    | "authorization"
    | "custom";
  description: string;
  formal_predicate?: PredicateIR;
  scope: EntityRef[];
  verifiability: "testable" | "partially_verifiable" | "runtime_assertable" | "manual" | "unsupported";
  verification: GuaranteeVerificationIR;
  runtime_assertions: RuntimeAssertionIR[];
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `category`
- `description`
- `scope`
- `verifiability`
- `verification`
- `runtime_assertions`
- `aliases`
- `source_id`

Optional fields:

- `formal_predicate`
- `display_name`

Allowed categories:

- `data_integrity`
- `transactional_behavior`
- `security_safety`
- `moderation`
- `latency`
- `integration_failure`
- `authorization`
- `custom`

Validation rules:

- `scope` must contain at least one workflow, model, field, integration, or policy reference.
- `verifiability: testable` requires at least one expected generated test.
- `verifiability: partially_verifiable` requires a `verification.limitations` explanation.
- `verifiability: unsupported` is rejected in V1 unless the compiler is running in `allow-unsupported-guarantees` diagnostic mode. It must not drive code generation.
- `formal_predicate`, when present, must reference existing entities.
- Latency guarantees are normally partially verifiable in V1 because local tests cannot prove production p95 latency.

Example:

```json
{
  "id": "guarantee.notification_failure_does_not_rollback_post",
  "kind": "guarantee",
  "name": "notification_failure_does_not_rollback_post",
  "category": "transactional_behavior",
  "description": "Failure while notifying mentioned users must not rollback persisted post creation.",
  "formal_predicate": {
    "type": "implies",
    "if": {
      "event": "integration_failure",
      "integration_id": "integration.PushProvider"
    },
    "then": {
      "state": "exists",
      "entity_id": "model.Post"
    }
  },
  "scope": [
    "workflow.CreatePost",
    "workflow.CreatePost.step.insert_post",
    "workflow.CreatePost.step.notify_mentioned_users",
    "integration.PushProvider"
  ],
  "verifiability": "testable",
  "verification": {
    "strategy": "integration_test",
    "expected_tests": [
      "test.create_post_notification_failure_does_not_rollback"
    ],
    "limitations": []
  },
  "runtime_assertions": [],
  "aliases": [],
  "source_id": "source.backend_arch.workflow.CreatePost.guarantee.notification_failure_does_not_rollback_post"
}
```

### 6.13 TestIR

`TestIR` represents a generated or declared test expectation.

```ts
interface TestIR extends EntityIdentityIR {
  kind: "test";
  test_kind: "unit" | "integration" | "contract" | "static" | "load_scaffold";
  framework: "vitest";
  path: string;
  scope: EntityRef[];
  guarantee_id?: EntityRef;
  assertions: TestAssertionIR[];
  fixtures: TestFixtureIR[];
  generated: boolean;
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `test_kind`
- `framework`
- `path`
- `scope`
- `assertions`
- `fixtures`
- `generated`
- `aliases`
- `source_id`

Optional fields:

- `guarantee_id`

Allowed values:

- `framework` must be `vitest` in V1.
- `path` must be repository-relative.
- Generated test paths should be under `tests/generated/`.
- Human-owned/custom tests should be under `tests/custom/` and must be represented with `generated: false` if included in IR metadata.

Validation rules:

- `scope` must not be empty.
- `guarantee_id`, when present, must reference a `GuaranteeIR`.
- Every `testable` guarantee must map to at least one `TestIR`.
- Test IDs must be stable across formatting changes.
- Tests generated from guarantees must include assertions that can be traced to the guarantee predicate or verification strategy.

Example:

```json
{
  "id": "test.create_post_notification_failure_does_not_rollback",
  "kind": "test",
  "name": "create_post_notification_failure_does_not_rollback",
  "test_kind": "integration",
  "framework": "vitest",
  "path": "tests/generated/createPost.notificationFailure.test.ts",
  "scope": [
    "workflow.CreatePost",
    "guarantee.notification_failure_does_not_rollback_post"
  ],
  "guarantee_id": "guarantee.notification_failure_does_not_rollback_post",
  "assertions": [
    {
      "type": "database_record_exists_after_integration_failure",
      "entity_id": "model.Post",
      "integration_id": "integration.PushProvider"
    }
  ],
  "fixtures": [],
  "generated": true,
  "aliases": [],
  "source_id": "source.backend_arch.workflow.CreatePost.guarantee.notification_failure_does_not_rollback_post"
}
```

### 6.14 ArtifactIR

`ArtifactIR` records generated or managed implementation artifacts associated with IR entities.

```ts
interface ArtifactIR extends EntityIdentityIR {
  kind: "artifact";
  artifact_kind:
    | "prisma_schema"
    | "migration"
    | "typescript_model"
    | "validator"
    | "route"
    | "workflow"
    | "integration_stub"
    | "policy"
    | "test"
    | "runtime_config"
    | "docker_compose"
    | "package_manifest"
    | "extension_point"
    | "metadata";
  path: string;
  region?: ArtifactRegionIR;
  entity_ids: EntityRef[];
  ownership_id: EntityRef;
  generation: ArtifactGenerationIR;
  generated_from_hash?: string;
  source_id: string;
}

interface ArtifactGenerationIR {
  mode: "deterministic_template" | "constrained_agent" | "manual_registration";
  generator_id: string;
  template_id?: string;
  ir_fragment_hash: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `artifact_kind`
- `path`
- `entity_ids`
- `ownership_id`
- `generation`
- `aliases`
- `source_id`

Optional fields:

- `region`
- `generated_from_hash`

Validation rules:

- `path` must be repository-relative.
- Generated TypeScript files live directly under `src/...` (e.g. `src/workflows/createPost.ts`), not under any nested `generated/` subdirectory of `src`.
- `entity_ids` must reference existing entities.
- `ownership_id` must reference an `OwnershipIR` entry.
- Fully generated files normally omit `region`.
- Mixed files must include `region`.
- Artifacts must not point to human-owned files unless the artifact kind is `extension_point` metadata or the ownership update policy is `read_only`.
- `generated_from_hash`, when present, must be the canonical hash of the IR fragment used to generate the artifact or region.
- `generation.ir_fragment_hash` must be deterministic and must not include timestamps, local absolute paths, or runtime verification output.
- `constrained_agent` means the artifact may be produced by an agent from a bounded patch task. It does not permit agents to parse `.arch`, decide diffs, create plans from scratch, bypass ownership, weaken guarantees, or mark verification passed.

Example:

```json
{
  "id": "artifact.src_workflows_createPost_ts",
  "kind": "artifact",
  "name": "src/workflows/createPost.ts",
  "artifact_kind": "workflow",
  "path": "src/workflows/createPost.ts",
  "entity_ids": ["workflow.CreatePost"],
  "ownership_id": "ownership.src_workflows_createPost_ts",
  "generation": {
    "mode": "deterministic_template",
    "generator_id": "arch.templates.typescript.fastify.v1",
    "template_id": "workflow.fastify.v1",
    "ir_fragment_hash": "sha256:8ec7d3e4..."
  },
  "generated_from_hash": "sha256:8ec7d3e4...",
  "aliases": [],
  "source_id": "source.generated.artifact.src_workflows_createPost_ts"
}
```

### 6.15 OwnershipIR

`OwnershipIR` defines who may update an artifact or region.

```ts
interface OwnershipIR extends EntityIdentityIR {
  kind: "ownership";
  path: string;
  region?: ArtifactRegionIR;
  owner: "arch" | "human" | "shared";
  ownership_kind: "generated_file" | "generated_region" | "extension_point" | "human_file";
  update_policy: "overwrite_allowed" | "patch_allowed" | "create_only" | "read_only" | "requires_confirmation";
  write_scope: "whole_file" | "generated_region" | "stub_only" | "none";
  entity_ids: EntityRef[];
  content_hash?: string;
  source_id: string;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `path`
- `owner`
- `ownership_kind`
- `update_policy`
- `write_scope`
- `entity_ids`
- `aliases`
- `source_id`

Optional fields:

- `region`
- `content_hash`

Validation rules:

- `generated_file` must use `owner: arch` and normally `overwrite_allowed` or `patch_allowed`.
- `generated_region` must use `owner: arch`, include `region`, and use `patch_allowed`.
- `extension_point` must use `owner: human` or `shared` and normally `create_only` or `requires_confirmation`.
- `human_file` must use `owner: human` and `read_only`.
- `write_scope` must agree with `ownership_kind`: generated files use `whole_file`, generated regions use `generated_region`, extension points use `stub_only` until confirmed, and human files use `none`.
- Arch must not modify `human_file` or completed extension-point implementations unless the developer provides explicit confirmation outside the IR.

Example:

```json
{
  "id": "ownership.src_workflows_createPost_ts",
  "kind": "ownership",
  "name": "src/workflows/createPost.ts",
  "path": "src/workflows/createPost.ts",
  "owner": "arch",
  "ownership_kind": "generated_file",
  "update_policy": "overwrite_allowed",
  "write_scope": "whole_file",
  "entity_ids": ["workflow.CreatePost"],
  "content_hash": "sha256:2cd9e1...",
  "aliases": [],
  "source_id": "source.generated.ownership.src_workflows_createPost_ts"
}
```

### 6.16 SourceLocationIR

`SourceLocationIR` preserves traceability to `.arch` source text or compiler-generated metadata.

```ts
interface SourceLocationIR extends EntityIdentityIR {
  kind: "source_location";
  entity_id: EntityRef;
  file: string;
  start: SourcePositionIR;
  end: SourcePositionIR;
  span: {
    start_offset: number;
    end_offset: number;
  };
  source_hash: string;
  generated: boolean;
}

interface SourcePositionIR {
  line: number;
  column: number;
  offset: number;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `entity_id`
- `file`
- `start`
- `end`
- `span`
- `source_hash`
- `generated`
- `aliases`
- `source_id`

Validation rules:

- `file` must be repository-relative.
- `line` and `column` are 1-based.
- `offset`, `start_offset`, and `end_offset` are 0-based byte offsets in UTF-8 source.
- `source_hash` is `sha256:` plus the SHA-256 digest of the exact raw source span after normalizing line endings to `\n`.
- `source_id` must equal the source location entity's own `id`.
- Compiler-generated source locations must use `generated: true` and a synthetic file namespace such as `.arch/generated`.
- Source mappings must be specific enough to report validation errors at the smallest meaningful declaration.
- Source mapping changes alone are not implementation changes. Typed implementation diffs compare semantic IR fields and ignore `SourceLocationIR`, `source_id`, raw span offsets, and source hashes unless a semantic entity field also changes.

Example:

```json
{
  "id": "source.backend_arch.model.Post.field.content",
  "kind": "source_location",
  "name": "backend.arch:model.Post.field.content",
  "entity_id": "model.Post.field.content",
  "file": "backend.arch",
  "start": { "line": 17, "column": 5, "offset": 330 },
  "end": { "line": 17, "column": 34, "offset": 359 },
  "span": { "start_offset": 330, "end_offset": 359 },
  "source_hash": "sha256:91c2a9...",
  "generated": false,
  "aliases": [],
  "source_id": "source.backend_arch.model.Post.field.content"
}
```

### 6.17 VerificationIR

`VerificationIR` defines expected checks for the generated implementation.

```ts
interface VerificationIR extends EntityIdentityIR {
  kind: "verification";
  commands: VerificationCommandIR[];
  guarantee_coverage: GuaranteeCoverageIR[];
  drift_checks: DriftCheckIR[];
  repair: {
    max_attempts: number;
    allowed: boolean;
  };
  source_id: string;
}

interface VerificationCommandIR {
  name: string;
  command: string;
  required: boolean;
  provides: ("typecheck" | "unit_tests" | "integration_tests" | "contract_tests" | "static_checks" | "load_scaffold" | "lint")[];
}

interface GuaranteeCoverageIR {
  guarantee_id: EntityRef;
  status: "covered" | "partially_covered" | "manual" | "missing";
  strategy: "unit_test" | "integration_test" | "contract_test" | "static_check" | "runtime_assertion" | "load_test_scaffold" | "manual_review" | "custom";
  test_ids: EntityRef[];
  runtime_assertion_ids: string[];
  limitations: string[];
}

interface DriftCheckIR {
  type: "generated_artifact_hash" | "generated_region_hash" | "ownership_boundary" | "source_map" | "guarantee_static_pattern";
  required: boolean;
}
```

Required fields:

- `id`
- `kind`
- `name`
- `commands`
- `guarantee_coverage`
- `drift_checks`
- `repair`
- `aliases`
- `source_id`

Validation rules:

- V1 commands should include `pnpm typecheck`, `pnpm test`, and optionally `pnpm lint` when lint configuration is generated.
- `repair.max_attempts` must be between 0 and 3 in V1.
- Every guarantee must have a coverage entry.
- Drift checks must include ownership validation and generated artifact hash validation.
- Latency guarantees must use `status: "partially_covered"` unless the verification strategy is explicitly external to V1 local verification.
- Unsupported guarantees do not produce normal `GuaranteeCoverageIR`. They are reported as diagnostics and block normal V1 apply.

Example:

```json
{
  "id": "verification.primary",
  "kind": "verification",
  "name": "primary",
  "commands": [
    { "name": "typecheck", "command": "pnpm typecheck", "required": true, "provides": ["typecheck"] },
    { "name": "test", "command": "pnpm test", "required": true, "provides": ["unit_tests", "integration_tests"] }
  ],
  "guarantee_coverage": [
    {
      "guarantee_id": "guarantee.no_unsanitized_html_persisted",
      "status": "covered",
      "strategy": "integration_test",
      "test_ids": ["test.create_post_no_unsanitized_html_persisted"],
      "runtime_assertion_ids": [],
      "limitations": []
    }
  ],
  "drift_checks": [
    { "type": "generated_artifact_hash", "required": true },
    { "type": "ownership_boundary", "required": true }
  ],
  "repair": {
    "max_attempts": 3,
    "allowed": true
  },
  "aliases": [],
  "source_id": "source.generated.verification.primary"
}
```

## 7. Entity ID Rules

### 7.1 ID strategy

V1 uses semantic path-based IDs as primary entity identifiers. IDs are not random and are not derived from raw source positions. Hashes are used for content identity and drift detection, not as primary entity IDs.

Examples:

```json
{
  "id": "model.Post.field.visibility",
  "kind": "model_field",
  "name": "visibility"
}
```

Canonical ID patterns:

| Entity | Pattern | Example |
|---|---|---|
| System | `system.<SystemName>` | `system.SocialFeed` |
| Target | `target.primary` | `target.primary` |
| Model | `model.<ModelName>` | `model.Post` |
| Field | `model.<ModelName>.field.<field_name>` | `model.Post.field.visibility` |
| Relation | `relation.<FromModel>.<relation_name>.<ToModel>` | `relation.Post.author.User` |
| Workflow | `workflow.<WorkflowName>` | `workflow.CreatePost` |
| Trigger | `workflow.<WorkflowName>.trigger.<normalized_trigger>` | `workflow.CreatePost.trigger.api_post_posts` |
| Step | `workflow.<WorkflowName>.step.<normalized_step_name>` | `workflow.CreatePost.step.notify_mentioned_users` |
| Integration | `integration.<IntegrationName>` | `integration.PushProvider` |
| Custom extension | `custom_extension.<CustomName>` | `custom_extension.PostRankingStrategy` |
| Policy | `policy.<policy_name>` | `policy.create_post_notifications_best_effort` |
| Guarantee | `guarantee.<guarantee_name>` | `guarantee.no_unsanitized_html_persisted` |
| Test | `test.<test_name>` | `test.create_post_no_unsanitized_html_persisted` |
| Artifact | `artifact.<normalized_path>` | `artifact.src_models_post_ts` |
| Ownership | `ownership.<normalized_path_or_region>` | `ownership.src_models_post_ts` |
| Source | `source.<normalized_file>.<entity_path>` | `source.backend_arch.model.Post` |
| Verification | `verification.primary` | `verification.primary` |

### 7.2 Allowed ID characters

IDs must match:

```text
^[A-Za-z][A-Za-z0-9_.:-]*$
```

Additional rules:

- IDs must not contain spaces.
- IDs must not contain `/`, `\\`, or shell-special characters.
- Path-based artifact IDs normalize `/`, `.`, and `-` into `_` after preserving enough uniqueness.
- Names inside IDs preserve semantic case for models, workflows, systems, and integrations.
- Field, policy, guarantee, and step segments use source names normalized to snake case unless the source name is already a valid lower identifier.

### 7.3 Reordering

IDs survive reordering because they are not based on source line numbers or array index positions.

Examples:

- Reordering `model User` and `model Post` must not change `model.User` or `model.Post`.
- Reordering fields inside a model must not change field IDs.
- Reordering workflow steps does not change step IDs, but it does produce `workflow_step_reordered` diffs because step order is semantically meaningful.

### 7.4 Renames

Because V1 IDs are semantic, renaming an entity changes its primary ID unless the compiler receives an explicit rename hint or alias metadata.

Default behavior:

- `model.Post` renamed to `model.Article` is interpreted as `model_removed(model.Post)` plus `model_added(model.Article)`.
- `model.Post.field.content` renamed to `model.Post.field.body` is interpreted as field removal plus field addition.
- The diff engine may emit an additional `rename_suspected` diagnostic when before/after shapes are highly similar, but this diagnostic is not a committed diff type in V1.

Supported V1 rename handling:

- An entity may contain `aliases` with previous IDs when the source language or migration metadata provides a rename hint.
- When `aliases` contains a previous ID, the diff engine may classify the change as a modifying change instead of remove/add.
- If a rename affects persistent data or generated routes, developer confirmation is required because generated migrations or API compatibility may be affected.

Example:

```json
{
  "id": "model.Article",
  "kind": "model",
  "name": "Article",
  "aliases": ["model.Post"]
}
```

### 7.5 IDs in diffs and artifact mapping

Diffs use entity IDs as stable anchors:

```json
{
  "type": "model_field_added",
  "entity_id": "model.Post.field.visibility",
  "parent_entity_id": "model.Post"
}
```

Artifact mappings use entity IDs to determine affected files:

```json
{
  "entity_ids": ["model.Post", "model.Post.field.visibility"],
  "path": "prisma/schema.prisma"
}
```

Guarantee-to-test mappings use entity IDs to preserve traceability:

```json
{
  "guarantee_id": "guarantee.notification_failure_does_not_rollback_post",
  "test_id": "test.create_post_notification_failure_does_not_rollback"
}
```

## 8. Normalized IR Example: SocialFeed

The following JSON example is illustrative, not a full schema-conformance fixture. Hash values, byte offsets, and some repeated artifact generation metadata are shortened for readability. A real canonical IR document must emit every required field, complete SHA-256 digests, exact source offsets, and deterministic generated metadata.

```json
{
  "schema_version": "arch.ir.v1",
  "canonical_hash": "sha256:4aa2f2b7example",
  "system": {
    "id": "system.SocialFeed",
    "kind": "system",
    "name": "SocialFeed",
    "namespace": "social_feed",
    "aliases": [],
    "source_id": "source.backend_arch.system.SocialFeed"
  },
  "target": {
    "id": "target.primary",
    "kind": "target",
    "name": "primary",
    "language": "typescript",
    "runtime": "node.fastify",
    "database": "postgres",
    "orm": "prisma",
    "cache": "redis",
    "test_framework": "vitest",
    "local_runtime": "docker_compose",
    "package_manager": "pnpm",
    "auth": "oauth.github",
    "aliases": [],
    "source_id": "source.backend_arch.target.primary"
  },
  "models": [
    {
      "id": "model.Post",
      "kind": "model",
      "name": "Post",
      "fields": [
        {
          "id": "model.Post.field.author",
          "kind": "model_field",
          "name": "author",
          "model_id": "model.Post",
          "type": { "kind": "model_ref", "model_id": "model.User" },
          "constraints": {
            "required": true,
            "unique": false,
            "primary": false,
            "indexed": true,
            "immutable": false
          },
          "aliases": [],
          "source_id": "source.backend_arch.model.Post.field.author"
        },
        {
          "id": "model.Post.field.content",
          "kind": "model_field",
          "name": "content",
          "model_id": "model.Post",
          "type": { "kind": "string" },
          "constraints": {
            "required": true,
            "unique": false,
            "primary": false,
            "indexed": false,
            "immutable": false,
            "max_length": 5000
          },
          "aliases": [],
          "source_id": "source.backend_arch.model.Post.field.content"
        },
        {
          "id": "model.Post.field.created_at",
          "kind": "model_field",
          "name": "created_at",
          "model_id": "model.Post",
          "type": { "kind": "timestamp" },
          "constraints": {
            "required": true,
            "unique": false,
            "primary": false,
            "indexed": true,
            "immutable": true,
            "default": { "kind": "now" }
          },
          "aliases": [],
          "source_id": "source.backend_arch.model.Post.field.created_at"
        },
        {
          "id": "model.Post.field.id",
          "kind": "model_field",
          "name": "id",
          "model_id": "model.Post",
          "type": { "kind": "uuid" },
          "constraints": {
            "required": true,
            "unique": true,
            "primary": true,
            "indexed": true,
            "immutable": true,
            "default": { "kind": "uuid" }
          },
          "aliases": [],
          "source_id": "source.backend_arch.model.Post.field.id"
        }
      ],
      "relations": [
        {
          "id": "relation.Post.author.User",
          "kind": "relation",
          "name": "author",
          "from_model_id": "model.Post",
          "to_model_id": "model.User",
          "field_id": "model.Post.field.author",
          "declaration_kind": "inline_field",
          "cardinality": "many_to_one",
          "required": true,
          "foreign_key": {
            "field_name": "author_id",
            "generated": true
          },
          "on_delete": "restrict",
          "aliases": [],
          "source_id": "source.backend_arch.model.Post.field.author"
        }
      ],
      "indexes": [],
      "aliases": [],
      "source_id": "source.backend_arch.model.Post"
    },
    {
      "id": "model.User",
      "kind": "model",
      "name": "User",
      "fields": [
        {
          "id": "model.User.field.bio",
          "kind": "model_field",
          "name": "bio",
          "model_id": "model.User",
          "type": { "kind": "string" },
          "constraints": {
            "required": false,
            "unique": false,
            "primary": false,
            "indexed": false,
            "immutable": false,
            "max_length": 280
          },
          "aliases": [],
          "source_id": "source.backend_arch.model.User.field.bio"
        },
        {
          "id": "model.User.field.id",
          "kind": "model_field",
          "name": "id",
          "model_id": "model.User",
          "type": { "kind": "uuid" },
          "constraints": {
            "required": true,
            "unique": true,
            "primary": true,
            "indexed": true,
            "immutable": true,
            "default": { "kind": "uuid" }
          },
          "aliases": [],
          "source_id": "source.backend_arch.model.User.field.id"
        },
        {
          "id": "model.User.field.username",
          "kind": "model_field",
          "name": "username",
          "model_id": "model.User",
          "type": { "kind": "string" },
          "constraints": {
            "required": true,
            "unique": true,
            "primary": false,
            "indexed": true,
            "immutable": false
          },
          "aliases": [],
          "source_id": "source.backend_arch.model.User.field.username"
        }
      ],
      "relations": [],
      "indexes": [],
      "aliases": [],
      "source_id": "source.backend_arch.model.User"
    }
  ],
  "integrations": [
    {
      "id": "integration.LLMModeratorGuardrail",
      "kind": "integration",
      "name": "LLMModeratorGuardrail",
      "integration_kind": "llm_moderation",
      "required": true,
      "provider": "custom",
      "config_schema": [],
      "failure_policy": "fail_workflow",
      "aliases": [],
      "source_id": "source.backend_arch.integration.LLMModeratorGuardrail"
    },
    {
      "id": "integration.PushProvider",
      "kind": "integration",
      "name": "PushProvider",
      "integration_kind": "push",
      "required": false,
      "provider": "custom",
      "config_schema": [],
      "failure_policy": "best_effort",
      "aliases": [],
      "source_id": "source.backend_arch.integration.PushProvider"
    }
  ],
  "custom_extensions": [
    {
      "id": "custom_extension.PostRankingStrategy",
      "kind": "custom_extension",
      "name": "PostRankingStrategy",
      "extension_kind": "function",
      "input_types": [{ "kind": "model_ref", "model_id": "model.Post" }],
      "output_type": { "kind": "decimal" },
      "file": "src/custom/postRankingStrategy.ts",
      "export_name": "postRankingStrategy",
      "artifact_id": "artifact.src_custom_postRankingStrategy_ts",
      "ownership_id": "ownership.src_custom_postRankingStrategy_ts",
      "aliases": [],
      "source_id": "source.backend_arch.custom.PostRankingStrategy"
    }
  ],
  "policies": [],
  "workflows": [
    {
      "id": "workflow.CreatePost",
      "kind": "workflow",
      "name": "CreatePost",
      "trigger": {
        "id": "workflow.CreatePost.trigger.api_post_posts",
        "kind": "trigger",
        "name": "api_post_posts",
        "workflow_id": "workflow.CreatePost",
        "trigger_kind": "api",
        "api": {
          "method": "POST",
          "path": "/posts",
          "auth_required": true
        },
        "aliases": [],
        "source_id": "source.backend_arch.workflow.CreatePost.trigger"
      },
      "steps": [
        {
          "id": "workflow.CreatePost.step.validate_input",
          "kind": "workflow_step",
          "name": "validate_input",
          "workflow_id": "workflow.CreatePost",
          "order": 1,
          "operation": {
            "type": "validate_input",
            "model_id": "model.Post",
            "parameters": {}
          },
          "reads": ["model.Post"],
          "writes": [],
          "uses_integrations": [],
          "depends_on": [],
          "failure_behavior": "rollback_workflow",
          "transaction_boundary": "none",
          "aliases": [],
          "source_id": "source.backend_arch.workflow.CreatePost.step.validate_input"
        },
        {
          "id": "workflow.CreatePost.step.moderate_post_content",
          "kind": "workflow_step",
          "name": "moderate_post_content",
          "workflow_id": "workflow.CreatePost",
          "order": 2,
          "operation": {
            "type": "moderate_content",
            "field_id": "model.Post.field.content",
            "integration_id": "integration.LLMModeratorGuardrail",
            "parameters": {}
          },
          "reads": ["model.Post.field.content"],
          "writes": [],
          "uses_integrations": ["integration.LLMModeratorGuardrail"],
          "depends_on": ["workflow.CreatePost.step.validate_input"],
          "failure_behavior": "rollback_workflow",
          "transaction_boundary": "none",
          "aliases": [],
          "source_id": "source.backend_arch.workflow.CreatePost.step.moderate_post_content"
        },
        {
          "id": "workflow.CreatePost.step.sanitize_post_content",
          "kind": "workflow_step",
          "name": "sanitize_post_content",
          "workflow_id": "workflow.CreatePost",
          "order": 3,
          "operation": {
            "type": "sanitize_field",
            "field_id": "model.Post.field.content",
            "parameters": { "mode": "html_safe" }
          },
          "reads": ["model.Post.field.content"],
          "writes": ["model.Post.field.content"],
          "uses_integrations": [],
          "depends_on": ["workflow.CreatePost.step.moderate_post_content"],
          "failure_behavior": "rollback_workflow",
          "transaction_boundary": "none",
          "aliases": [],
          "source_id": "source.backend_arch.workflow.CreatePost.step.sanitize_post_content"
        },
        {
          "id": "workflow.CreatePost.step.insert_post",
          "kind": "workflow_step",
          "name": "insert_post",
          "workflow_id": "workflow.CreatePost",
          "order": 4,
          "operation": {
            "type": "insert_model",
            "model_id": "model.Post",
            "parameters": {}
          },
          "reads": ["model.Post"],
          "writes": ["model.Post"],
          "uses_integrations": [],
          "depends_on": ["workflow.CreatePost.step.sanitize_post_content"],
          "failure_behavior": "rollback_workflow",
          "transaction_boundary": "inside_transaction",
          "aliases": [],
          "source_id": "source.backend_arch.workflow.CreatePost.step.insert_post"
        },
        {
          "id": "workflow.CreatePost.step.update_feed_cache_for_author_followers",
          "kind": "workflow_step",
          "name": "update_feed_cache_for_author_followers",
          "workflow_id": "workflow.CreatePost",
          "order": 5,
          "operation": {
            "type": "update_cache",
            "target": "model.Post",
            "parameters": {
              "cache_key": "FeedCache",
              "audience": "author.followers"
            }
          },
          "reads": ["model.Post", "relation.Post.author.User"],
          "writes": [],
          "uses_integrations": [],
          "depends_on": ["workflow.CreatePost.step.insert_post"],
          "failure_behavior": "record_error",
          "transaction_boundary": "outside_transaction",
          "aliases": [],
          "source_id": "source.backend_arch.workflow.CreatePost.step.update_feed_cache_for_author_followers"
        },
        {
          "id": "workflow.CreatePost.step.notify_mentioned_users",
          "kind": "workflow_step",
          "name": "notify_mentioned_users",
          "workflow_id": "workflow.CreatePost",
          "order": 6,
          "operation": {
            "type": "notify_users",
            "integration_id": "integration.PushProvider",
            "parameters": {
              "audience": "mentioned_users"
            }
          },
          "reads": ["model.Post.field.content"],
          "writes": [],
          "uses_integrations": ["integration.PushProvider"],
          "depends_on": ["workflow.CreatePost.step.insert_post"],
          "failure_behavior": "continue",
          "transaction_boundary": "outside_transaction",
          "aliases": [],
          "source_id": "source.backend_arch.workflow.CreatePost.step.notify_mentioned_users"
        }
      ],
      "guarantee_ids": [
        "guarantee.no_unsanitized_html_persisted",
        "guarantee.notification_failure_does_not_rollback_post",
        "guarantee.post_creation_p95_latency"
      ],
      "policy_ids": [],
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost"
    }
  ],
  "guarantees": [
    {
      "id": "guarantee.no_unsanitized_html_persisted",
      "kind": "guarantee",
      "name": "no_unsanitized_html_persisted",
      "category": "security_safety",
      "description": "Post content persisted by CreatePost must be sanitized for HTML safety.",
      "formal_predicate": {
        "type": "for_all_persisted_records",
        "entity_id": "model.Post",
        "field_id": "model.Post.field.content",
        "predicate": "is_html_safe"
      },
      "scope": [
        "workflow.CreatePost",
        "model.Post.field.content",
        "workflow.CreatePost.step.sanitize_post_content",
        "workflow.CreatePost.step.insert_post"
      ],
      "verifiability": "testable",
      "verification": {
        "strategy": "integration_test",
        "expected_tests": ["test.create_post_no_unsanitized_html_persisted"],
        "limitations": []
      },
      "runtime_assertions": [
        {
          "id": "assertion.post_content_html_safe_before_insert",
          "location": "workflow.CreatePost.step.insert_post",
          "predicate": "is_html_safe(model.Post.field.content)",
          "mode": "throw"
        }
      ],
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost.guarantee.no_unsanitized_html_persisted"
    },
    {
      "id": "guarantee.notification_failure_does_not_rollback_post",
      "kind": "guarantee",
      "name": "notification_failure_does_not_rollback_post",
      "category": "transactional_behavior",
      "description": "Failure while notifying mentioned users must not rollback persisted post creation.",
      "formal_predicate": {
        "type": "implies",
        "if": {
          "event": "integration_failure",
          "integration_id": "integration.PushProvider"
        },
        "then": {
          "state": "exists",
          "entity_id": "model.Post"
        }
      },
      "scope": [
        "workflow.CreatePost",
        "workflow.CreatePost.step.insert_post",
        "workflow.CreatePost.step.notify_mentioned_users",
        "integration.PushProvider"
      ],
      "verifiability": "testable",
      "verification": {
        "strategy": "integration_test",
        "expected_tests": ["test.create_post_notification_failure_does_not_rollback"],
        "limitations": []
      },
      "runtime_assertions": [],
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost.guarantee.notification_failure_does_not_rollback_post"
    },
    {
      "id": "guarantee.post_creation_p95_latency",
      "kind": "guarantee",
      "name": "post_creation_p95_latency",
      "category": "latency",
      "description": "CreatePost should complete with p95 latency less than or equal to 200ms in the declared local test scaffold.",
      "formal_predicate": {
        "type": "percentile_latency_lte",
        "workflow_id": "workflow.CreatePost",
        "percentile": 95,
        "threshold": { "value": 200, "unit": "ms" }
      },
      "scope": ["workflow.CreatePost"],
      "verifiability": "partially_verifiable",
      "verification": {
        "strategy": "load_test_scaffold",
        "expected_tests": ["test.create_post_p95_latency_scaffold"],
        "limitations": [
          "Local Vitest/Docker Compose execution cannot prove production p95 latency."
        ]
      },
      "runtime_assertions": [],
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost.guarantee.post_creation_p95_latency"
    }
  ],
  "tests": [
    {
      "id": "test.create_post_no_unsanitized_html_persisted",
      "kind": "test",
      "name": "create_post_no_unsanitized_html_persisted",
      "test_kind": "integration",
      "framework": "vitest",
      "path": "tests/generated/createPost.htmlSafety.test.ts",
      "scope": [
        "workflow.CreatePost",
        "guarantee.no_unsanitized_html_persisted"
      ],
      "guarantee_id": "guarantee.no_unsanitized_html_persisted",
      "assertions": [
        {
          "type": "persisted_field_satisfies_predicate",
          "entity_id": "model.Post",
          "field_id": "model.Post.field.content",
          "predicate": "is_html_safe"
        }
      ],
      "fixtures": [
        {
          "name": "unsafe_html_post_body",
          "value": { "content": "<script>alert(1)</script>hello" }
        }
      ],
      "generated": true,
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost.guarantee.no_unsanitized_html_persisted"
    },
    {
      "id": "test.create_post_notification_failure_does_not_rollback",
      "kind": "test",
      "name": "create_post_notification_failure_does_not_rollback",
      "test_kind": "integration",
      "framework": "vitest",
      "path": "tests/generated/createPost.notificationFailure.test.ts",
      "scope": [
        "workflow.CreatePost",
        "guarantee.notification_failure_does_not_rollback_post"
      ],
      "guarantee_id": "guarantee.notification_failure_does_not_rollback_post",
      "assertions": [
        {
          "type": "database_record_exists_after_integration_failure",
          "entity_id": "model.Post",
          "integration_id": "integration.PushProvider"
        }
      ],
      "fixtures": [
        {
          "name": "push_provider_failure",
          "value": { "integration_id": "integration.PushProvider", "behavior": "throw" }
        }
      ],
      "generated": true,
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost.guarantee.notification_failure_does_not_rollback_post"
    },
    {
      "id": "test.create_post_p95_latency_scaffold",
      "kind": "test",
      "name": "create_post_p95_latency_scaffold",
      "test_kind": "load_scaffold",
      "framework": "vitest",
      "path": "tests/generated/createPost.latency.test.ts",
      "scope": [
        "workflow.CreatePost",
        "guarantee.post_creation_p95_latency"
      ],
      "guarantee_id": "guarantee.post_creation_p95_latency",
      "assertions": [
        {
          "type": "local_latency_percentile_lte",
          "workflow_id": "workflow.CreatePost",
          "percentile": 95,
          "threshold": { "value": 200, "unit": "ms" }
        }
      ],
      "fixtures": [],
      "generated": true,
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost.guarantee.post_creation_p95_latency"
    }
  ],
  "artifacts": [
    {
      "id": "artifact.docker_compose_yml",
      "kind": "artifact",
      "name": "docker-compose.yml",
      "artifact_kind": "docker_compose",
      "path": "docker-compose.yml",
      "entity_ids": ["target.primary"],
      "ownership_id": "ownership.docker_compose_yml",
      "generated_from_hash": "sha256:targetexample",
      "aliases": [],
      "source_id": "source.generated.artifact.docker_compose_yml"
    },
    {
      "id": "artifact.prisma_schema_prisma",
      "kind": "artifact",
      "name": "prisma/schema.prisma",
      "artifact_kind": "prisma_schema",
      "path": "prisma/schema.prisma",
      "entity_ids": ["target.primary", "model.Post", "model.User", "relation.Post.author.User"],
      "ownership_id": "ownership.prisma_schema_prisma",
      "generated_from_hash": "sha256:schemaexample",
      "aliases": [],
      "source_id": "source.generated.artifact.prisma_schema_prisma"
    },
    {
      "id": "artifact.src_integrations_pushProvider_ts",
      "kind": "artifact",
      "name": "src/integrations/pushProvider.ts",
      "artifact_kind": "integration_stub",
      "path": "src/integrations/pushProvider.ts",
      "entity_ids": ["integration.PushProvider"],
      "ownership_id": "ownership.src_integrations_pushProvider_ts",
      "generated_from_hash": "sha256:pushexample",
      "aliases": [],
      "source_id": "source.generated.artifact.src_integrations_pushProvider_ts"
    },
    {
      "id": "artifact.src_models_post_ts",
      "kind": "artifact",
      "name": "src/models/post.ts",
      "artifact_kind": "typescript_model",
      "path": "src/models/post.ts",
      "entity_ids": ["model.Post"],
      "ownership_id": "ownership.src_models_post_ts",
      "generated_from_hash": "sha256:postmodelexample",
      "aliases": [],
      "source_id": "source.generated.artifact.src_models_post_ts"
    },
    {
      "id": "artifact.src_routes_posts_ts",
      "kind": "artifact",
      "name": "src/routes/posts.ts",
      "artifact_kind": "route",
      "path": "src/routes/posts.ts",
      "entity_ids": ["workflow.CreatePost", "workflow.CreatePost.trigger.api_post_posts"],
      "ownership_id": "ownership.src_routes_posts_ts",
      "generated_from_hash": "sha256:routeexample",
      "aliases": [],
      "source_id": "source.generated.artifact.src_routes_posts_ts"
    },
    {
      "id": "artifact.src_workflows_createPost_ts",
      "kind": "artifact",
      "name": "src/workflows/createPost.ts",
      "artifact_kind": "workflow",
      "path": "src/workflows/createPost.ts",
      "entity_ids": ["workflow.CreatePost"],
      "ownership_id": "ownership.src_workflows_createPost_ts",
      "generated_from_hash": "sha256:workflowexample",
      "aliases": [],
      "source_id": "source.generated.artifact.src_workflows_createPost_ts"
    },
    {
      "id": "artifact.src_custom_postRankingStrategy_ts",
      "kind": "artifact",
      "name": "src/custom/postRankingStrategy.ts",
      "artifact_kind": "extension_point",
      "path": "src/custom/postRankingStrategy.ts",
      "entity_ids": ["custom_extension.PostRankingStrategy"],
      "ownership_id": "ownership.src_custom_postRankingStrategy_ts",
      "generation": {
        "mode": "deterministic_template",
        "generator_id": "arch.templates.typescript.fastify.v1",
        "template_id": "custom_extension.stub.v1",
        "ir_fragment_hash": "sha256:customextensionexample"
      },
      "aliases": [],
      "source_id": "source.generated.artifact.src_custom_postRankingStrategy_ts"
    },
    {
      "id": "artifact.tests_generated_createPost_htmlSafety_test_ts",
      "kind": "artifact",
      "name": "tests/generated/createPost.htmlSafety.test.ts",
      "artifact_kind": "test",
      "path": "tests/generated/createPost.htmlSafety.test.ts",
      "entity_ids": ["test.create_post_no_unsanitized_html_persisted"],
      "ownership_id": "ownership.tests_generated_createPost_htmlSafety_test_ts",
      "generated_from_hash": "sha256:htmltestexample",
      "aliases": [],
      "source_id": "source.generated.artifact.tests_generated_createPost_htmlSafety_test_ts"
    },
    {
      "id": "artifact.tests_generated_createPost_notificationFailure_test_ts",
      "kind": "artifact",
      "name": "tests/generated/createPost.notificationFailure.test.ts",
      "artifact_kind": "test",
      "path": "tests/generated/createPost.notificationFailure.test.ts",
      "entity_ids": ["test.create_post_notification_failure_does_not_rollback"],
      "ownership_id": "ownership.tests_generated_createPost_notificationFailure_test_ts",
      "generated_from_hash": "sha256:notificationtestexample",
      "aliases": [],
      "source_id": "source.generated.artifact.tests_generated_createPost_notificationFailure_test_ts"
    }
  ],
  "ownership": [
    {
      "id": "ownership.docker_compose_yml",
      "kind": "ownership",
      "name": "docker-compose.yml",
      "path": "docker-compose.yml",
      "owner": "arch",
      "ownership_kind": "generated_file",
      "update_policy": "overwrite_allowed",
      "write_scope": "whole_file",
      "entity_ids": ["target.primary"],
      "content_hash": "sha256:dockerexample",
      "aliases": [],
      "source_id": "source.generated.ownership.docker_compose_yml"
    },
    {
      "id": "ownership.prisma_schema_prisma",
      "kind": "ownership",
      "name": "prisma/schema.prisma",
      "path": "prisma/schema.prisma",
      "owner": "arch",
      "ownership_kind": "generated_file",
      "update_policy": "patch_allowed",
      "write_scope": "whole_file",
      "entity_ids": ["target.primary", "model.Post", "model.User"],
      "content_hash": "sha256:prismaexample",
      "aliases": [],
      "source_id": "source.generated.ownership.prisma_schema_prisma"
    },
    {
      "id": "ownership.src_custom_postRankingStrategy_ts",
      "kind": "ownership",
      "name": "src/custom/postRankingStrategy.ts",
      "path": "src/custom/postRankingStrategy.ts",
      "owner": "human",
      "ownership_kind": "extension_point",
      "update_policy": "create_only",
      "write_scope": "stub_only",
      "entity_ids": ["custom_extension.PostRankingStrategy"],
      "aliases": [],
      "source_id": "source.generated.ownership.src_custom_postRankingStrategy_ts"
    },
    {
      "id": "ownership.src_workflows_createPost_ts",
      "kind": "ownership",
      "name": "src/workflows/createPost.ts",
      "path": "src/workflows/createPost.ts",
      "owner": "arch",
      "ownership_kind": "generated_file",
      "update_policy": "overwrite_allowed",
      "write_scope": "whole_file",
      "entity_ids": ["workflow.CreatePost"],
      "content_hash": "sha256:workflowfileexample",
      "aliases": [],
      "source_id": "source.generated.ownership.src_workflows_createPost_ts"
    }
  ],
  "sources": [
    {
      "id": "source.backend_arch.system.SocialFeed",
      "kind": "source_location",
      "name": "backend.arch:system.SocialFeed",
      "entity_id": "system.SocialFeed",
      "file": "backend.arch",
      "start": { "line": 1, "column": 1, "offset": 0 },
      "end": { "line": 52, "column": 2, "offset": 1260 },
      "span": { "start_offset": 0, "end_offset": 1260 },
      "source_hash": "sha256:systemsourceexample",
      "generated": false,
      "aliases": [],
      "source_id": "source.backend_arch.system.SocialFeed"
    },
    {
      "id": "source.backend_arch.model.Post.field.content",
      "kind": "source_location",
      "name": "backend.arch:model.Post.field.content",
      "entity_id": "model.Post.field.content",
      "file": "backend.arch",
      "start": { "line": 17, "column": 5, "offset": 342 },
      "end": { "line": 17, "column": 34, "offset": 371 },
      "span": { "start_offset": 342, "end_offset": 371 },
      "source_hash": "sha256:contentsourceexample",
      "generated": false,
      "aliases": [],
      "source_id": "source.backend_arch.model.Post.field.content"
    },
    {
      "id": "source.backend_arch.workflow.CreatePost.step.notify_mentioned_users",
      "kind": "source_location",
      "name": "backend.arch:workflow.CreatePost.step.notify_mentioned_users",
      "entity_id": "workflow.CreatePost.step.notify_mentioned_users",
      "file": "backend.arch",
      "start": { "line": 40, "column": 7, "offset": 890 },
      "end": { "line": 40, "column": 47, "offset": 930 },
      "span": { "start_offset": 890, "end_offset": 930 },
      "source_hash": "sha256:notifysourceexample",
      "generated": false,
      "aliases": [],
      "source_id": "source.backend_arch.workflow.CreatePost.step.notify_mentioned_users"
    },
    {
      "id": "source.generated.verification.primary",
      "kind": "source_location",
      "name": ".arch/generated:verification.primary",
      "entity_id": "verification.primary",
      "file": ".arch/generated",
      "start": { "line": 1, "column": 1, "offset": 0 },
      "end": { "line": 1, "column": 1, "offset": 0 },
      "span": { "start_offset": 0, "end_offset": 0 },
      "source_hash": "sha256:generated",
      "generated": true,
      "aliases": [],
      "source_id": "source.generated.verification.primary"
    }
  ],
  "verification": {
    "id": "verification.primary",
    "kind": "verification",
    "name": "primary",
    "commands": [
      { "name": "typecheck", "command": "pnpm typecheck", "required": true, "provides": ["typecheck"] },
      { "name": "test", "command": "pnpm test", "required": true, "provides": ["unit_tests", "integration_tests", "load_scaffold"] }
    ],
    "guarantee_coverage": [
      {
        "guarantee_id": "guarantee.no_unsanitized_html_persisted",
        "status": "covered",
        "strategy": "integration_test",
        "test_ids": ["test.create_post_no_unsanitized_html_persisted"],
        "runtime_assertion_ids": ["assertion.post_content_html_safe_before_insert"],
        "limitations": []
      },
      {
        "guarantee_id": "guarantee.notification_failure_does_not_rollback_post",
        "status": "covered",
        "strategy": "integration_test",
        "test_ids": ["test.create_post_notification_failure_does_not_rollback"],
        "runtime_assertion_ids": [],
        "limitations": []
      },
      {
        "guarantee_id": "guarantee.post_creation_p95_latency",
        "status": "partially_covered",
        "strategy": "load_test_scaffold",
        "test_ids": ["test.create_post_p95_latency_scaffold"],
        "runtime_assertion_ids": [],
        "limitations": ["Local tests cannot prove production p95 latency."]
      }
    ],
    "drift_checks": [
      { "type": "generated_artifact_hash", "required": true },
      { "type": "ownership_boundary", "required": true },
      { "type": "guarantee_static_pattern", "required": false }
    ],
    "repair": {
      "max_attempts": 3,
      "allowed": true
    },
    "aliases": [],
    "source_id": "source.generated.verification.primary"
  }
}
```

## 9. Semantic Validation Rules

Validation happens after parsing and before canonical IR is accepted for planning or generation. Validators must report errors using `SourceLocationIR` IDs and source ranges.

### 9.1 Document-level rules

1. Exactly one system declaration is allowed.
2. Exactly one target declaration is allowed.
3. At least one model or workflow must be declared for generation.
4. All entity IDs must be unique.
5. All source IDs must resolve.
6. Canonical IR must conform to `arch.ir.v1`.
7. Unsupported V1 constructs must produce validation errors, not warnings.
8. Normal V1 accepts one source file, `backend.arch`; additional `.arch` files require a deterministic preprocessor that emits a single source map before IR generation.

### 9.2 Target rules

1. V1 target values are limited to the allowed values in `TargetIR`.
2. `runtime` must be `node.fastify`.
3. `database` must be `postgres`.
4. `orm` must be `prisma`.
5. `test_framework` must be `vitest`.
6. `local_runtime` must be `docker_compose`.
7. Workflows requiring cache behavior require `cache: redis` unless the step is custom.
8. Target changes that affect persistent data or runtime architecture must be classified as `target_changed` before apply.

### 9.3 Model and field rules

1. Model names must be unique.
2. Field names must be unique within a model.
3. Each model must have exactly one primary field.
4. Field types must be valid V1 `TypeDescriptorIR` kinds.
5. Enum fields must declare at least one unique enum value.
6. Required fields without defaults must be present in generated input validation unless they are generated by the runtime.
7. Optional fields must be nullable or optional in generated validation and persistence mapping.
8. `max_length` and `min_length` are valid only for `string` and `text`.
9. A `model_ref` field must have a corresponding relation.
10. A `model_ref_list` field must be an inverse relation view and must not persist a scalar array column.
11. Scalar arrays are rejected in V1.
12. Field names must not collide with generated Prisma foreign key names.
13. Removing a model or field is destructive unless it is unused and has no persistent artifact.
14. Changing a field type is destructive when it may cause data loss or incompatible migrations.

### 9.4 Relation rules

1. Relation targets must point to existing models.
2. A relation's `field_id` must be a `model_ref` field on `from_model_id`.
3. `required: true` cannot use `on_delete: set_null`.
4. V1 rejects implicit many-to-many relations.
5. Generated foreign key fields must be deterministic and collision-free.
6. Relation removal is destructive if it removes a foreign key column or generated access path.
7. Inverse one-to-many relation views must resolve through `via_relation_id` to a declared or compiler-generated forward relation.

### 9.5 Workflow and trigger rules

1. Workflow names must be unique.
2. Each workflow must have exactly one trigger.
3. V1 supports only API triggers.
4. API method/path pairs must be unique.
5. Workflow steps must have contiguous order values after canonicalization.
6. Workflow steps must reference existing models, fields, relations, integrations, and policies.
7. A workflow cannot reference undeclared models.
8. A workflow cannot reference undeclared integrations.
9. Step operation types must be among the V1 supported operation types.
10. `moderate_content` requires an `llm_moderation` integration.
11. `notify_users` requires a `push`, `email`, or `custom` integration.
12. `sanitize_field` requires a string-like field.
13. `insert_model` must write an existing model.
14. Workflow step reordering is semantic and must be preserved in IR.

### 9.6 Integration rules

1. Integration names must be unique.
2. Integration kinds must be supported V1 kinds.
3. Required integrations must not be silently treated as best-effort.
4. Optional integrations used after persistent writes must have explicit failure behavior in the step or inferred by an applicable guarantee.
5. Missing integrations referenced by steps are validation errors.
6. Provider-specific generation is limited to explicit V1 templates; otherwise generate typed stubs and require custom implementation.

### 9.7 Custom extension rules

1. Custom extension names must be unique.
2. Custom extension files must be repository-relative.
3. Custom extension calls must reference declared `CustomExtensionIR` entities.
4. Callable workflow custom extensions must have `extension_kind: "function"` or `extension_kind: "workflow_step"`.
5. Arch may create missing stubs but must mark them as extension points and must not overwrite completed human implementation without confirmation.

### 9.8 Policy rules

1. Policy scopes must reference existing entities.
2. Policy rules must use known operators and typed values.
3. Policy enforcement must be one of the allowed enforcement modes.
4. Policies must not conflict with guarantees.
5. Manual policies must be included in verification output as manually checked or not covered.

### 9.9 Guarantee rules

1. Guarantees are first-class entities, not comments.
2. Guarantee IDs must be stable and unique.
3. Each guarantee must have a category.
4. Each guarantee must have at least one scoped entity.
5. Each guarantee must declare verifiability.
6. `testable` guarantees must map to generated tests.
7. `partially_verifiable` guarantees must explain the limitation.
8. `runtime_assertable` guarantees must map to runtime assertion metadata.
9. `manual` guarantees must be reported in plan and check output.
10. `unsupported` guarantees must be rejected for normal V1 apply.
11. Guarantees must not require unsupported distributed transactions, frontend behavior, mobile behavior, or advanced formal verification.
12. Unknown short-form guarantees must fail semantic validation in V1. The compiler must not create a `custom` or `unsupported` guarantee from an unknown short identifier unless diagnostics-only mode is explicitly enabled.
13. Latency guarantees are partially verifiable in V1 unless backed by an explicitly external verification integration. Local Vitest or Docker Compose execution must not be described as proof of production p95 latency.

### 9.10 Test rules

1. Every generated test must reference a model, workflow, guarantee, policy, or integration.
2. Generated test paths must be under `tests/generated/`.
3. Generated tests must use `vitest`.
4. Tests derived from guarantees must reference `guarantee_id`.
5. Load-test scaffold tests must be marked as partial coverage if they cannot prove production behavior.

### 9.11 Artifact and ownership rules

1. Every artifact path must be repository-relative.
2. Every artifact must map to one or more IR entities.
3. Every artifact must have ownership metadata.
4. Arch may overwrite generated files according to `update_policy`.
5. Arch may patch generated regions according to `region` and marker boundaries.
6. Arch must not overwrite human-owned files.
7. Extension points may be created as stubs, but completed implementations are read-only unless confirmed.
8. Artifact mappings must be updated whenever generation changes.
9. Drift checks must compare generated artifact hashes or generated-region hashes against artifact metadata.

### 9.12 Unsupported V1 features

The validator must reject these features explicitly:

- frontend routes or UI generation;
- mobile apps;
- arbitrary backend languages;
- backend frameworks other than Fastify;
- databases other than PostgreSQL;
- ORMs other than Prisma;
- multi-service orchestration;
- Kubernetes deployment;
- production cloud deployment automation;
- complex event streaming;
- complex distributed transactions;
- implicit many-to-many relations;
- scalar array persistence;
- arbitrary natural-language requirements as executable behavior;
- advanced formal verification claims;
- autonomous long-running agents;
- automatic destructive migrations without confirmation.

### 9.13 Source construct to IR mapping

Every supported V1 source construct must be represented in canonical IR as a source-derived entity or as explicitly compiler-generated metadata.

| V1 source construct | Canonical IR representation |
|---|---|
| `system Name {}` | `SystemIR` |
| `target {}` | `TargetIR` with defaults expanded |
| `model Name {}` | `ModelIR` |
| field declaration | `FieldIR`; optional compiler-generated `IndexIR` when an implementation materializes index metadata |
| enum field | `FieldIR.type.kind = "enum"` with ordered `values` |
| model reference field | `FieldIR.type.kind = "model_ref"` plus `RelationIR` |
| inverse relation field | `FieldIR.type.kind = "model_ref_list"` with `storage.persisted = false` plus `RelationIR.declaration_kind = "inverse_field"` |
| relation block | `RelationIR` plus referenced `FieldIR` |
| `workflow Name {}` | `WorkflowIR` |
| workflow trigger | nested `TriggerIR` |
| workflow step | ordered `StepIR`; source order preserved as `order` |
| `integration Name {}` | `IntegrationIR` |
| `custom Name {}` | `CustomExtensionIR`, extension-point `ArtifactIR`, and `OwnershipIR`; `StepIR` when called |
| named `policy` | `PolicyIR` |
| short `policies` entry | compiler-generated `PolicyIR` with generated `SourceLocationIR` or the source entry span |
| long `guarantee` | `GuaranteeIR` plus `VerificationIR.guarantee_coverage`; `TestIR` when testable |
| short supported guarantee | compiler-generated `GuaranteeIR`; often compiler-generated `TestIR` and runtime assertion metadata |
| unknown short guarantee | validation error in normal V1 |
| `tests generate ...` | compiler-generated `TestIR` and generated test `ArtifactIR` |
| `tests include custom ...` | `TestIR` with `generated: false`, human-owned `OwnershipIR`, and read-only artifact metadata |

Required compiler-generated IR entities include source locations for defaults, verification metadata, generated tests derived from guarantees, generated artifact mappings, and ownership metadata. They must use deterministic IDs and synthetic `SourceLocationIR` entries when no exact source span exists.

## 10. Diff Model

The IR diff engine compares two canonical IR documents: `base` and `next`. It emits typed changes from semantic IR fields, not from source text diffs. Formatting-only changes may update source locations or source hashes, but they must not produce implementation diffs when semantic entity fields are unchanged.

### 10.1 Diff set shape

```ts
interface IRDiffSet {
  schema_version: "arch.diff.v1";
  base_ir_hash: string;
  next_ir_hash: string;
  changes: IRDiffChange[];
  summary: {
    additive: number;
    modifying: number;
    destructive: number;
    ambiguous: number;
    requires_confirmation: boolean;
    highest_risk: RiskLevel;
  };
}
```

### 10.2 Common diff change shape

```ts
interface IRDiffChange {
  id: string;
  type: DiffType;
  entity_id: EntityRef;
  parent_entity_id?: EntityRef;
  before?: unknown;
  after?: unknown;
  path: string;
  change_class: ChangeClass;
  risk: RiskLevel;
  requires_confirmation: boolean;
  affected_entity_ids: EntityRef[];
  expected_affected_artifacts: ArtifactImpactIR[];
  validation_notes: string[];
}
```

`path` uses a JSON Pointer-like path into canonical IR, such as:

```text
/models/model.Post/fields/model.Post.field.visibility
/workflows/workflow.CreatePost/steps/workflow.CreatePost.step.notify_mentioned_users
```

`expected_affected_artifacts`:

```ts
interface ArtifactImpactIR {
  artifact_kind: string;
  path_pattern: string;
  reason: string;
  required: boolean;
}
```

### 10.3 Required diff types

```ts
type DiffType =
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
```

### 10.4 Diff type matrix

| Diff type | Input shape | Class | Risk | Expected affected artifacts | Confirmation |
|---|---|---:|---:|---|---:|
| `model_added` | `after: ModelIR` | additive | medium | Prisma schema, migration, generated model, validator, optional tests | no |
| `model_removed` | `before: ModelIR` | destructive | high | Prisma schema, migration, generated model, validators, workflows referencing model, tests | yes |
| `model_field_added` | `after: FieldIR`, `parent_entity_id: ModelIR` | additive unless required without default | low to medium | Prisma schema, migration, generated model, validator, routes/workflows using model, tests | yes if required without default on existing persisted model |
| `model_field_removed` | `before: FieldIR` | destructive | high | Prisma schema, migration, generated model, validator, workflows/tests referencing field | yes |
| `model_field_type_changed` | `before: FieldIR.type`, `after: FieldIR.type` | modifying or destructive | medium to high | Prisma schema, migration, model type, validator, workflows, tests | yes if persistent field |
| `model_field_constraint_changed` | `before: ConstraintIR`, `after: ConstraintIR` | modifying | low to high | Prisma schema, migration, validator, generated tests | yes if tightening requiredness, uniqueness, max length, or dropping default |
| `relation_added` | `after: RelationIR` | additive | medium | Prisma schema, migration, generated model, workflow accessors, tests | no unless required FK needs backfill |
| `relation_removed` | `before: RelationIR` | destructive | high | Prisma schema, migration, generated model, workflows/tests referencing relation | yes |
| `relation_changed` | `before: RelationIR`, `after: RelationIR` | modifying or destructive | medium to high | Prisma schema, migration, generated model, workflows/tests referencing relation | yes if FK, requiredness, cardinality, or delete behavior changes |
| `model_index_added` | `after: IndexIR` | additive | low to medium | Prisma schema, migration | no unless large-table migration needs confirmation |
| `model_index_removed` | `before: IndexIR` | modifying | medium | Prisma schema, migration, query behavior | yes if generated behavior or policy relies on it |
| `model_index_changed` | `before: IndexIR`, `after: IndexIR` | modifying | medium | Prisma schema, migration | yes if uniqueness changes |
| `workflow_added` | `after: WorkflowIR` | additive | medium | Fastify route, workflow implementation, validators, integration stubs, tests | no |
| `workflow_removed` | `before: WorkflowIR` | destructive | high | route, workflow implementation, tests, guarantee coverage | yes |
| `workflow_step_added` | `after: StepIR` | additive or modifying | low to medium | workflow implementation, route behavior, affected integration stubs, tests | no unless external side effect or required integration |
| `workflow_step_removed` | `before: StepIR` | modifying or destructive | medium to high | workflow implementation, route behavior, tests, guarantee coverage | yes if step writes data, enforces safety, or supports guarantee |
| `workflow_step_reordered` | `before: StepIR.order`, `after: StepIR.order` | modifying | medium | workflow implementation, tests, transactional checks | yes if persistence, moderation, sanitation, or notification order changes guarantee semantics |
| `workflow_step_changed` | `before: StepIR`, `after: StepIR` | modifying | medium to high | workflow implementation, tests, integration stubs, policies | yes if operation type, writes, failure behavior, or transaction boundary changes |
| `integration_added` | `after: IntegrationIR` | additive | low to medium | integration stub, config, workflow implementation if used, tests | no |
| `integration_removed` | `before: IntegrationIR` | destructive or ambiguous | medium to high | integration stub, workflows using it, config, tests, guarantees | yes |
| `integration_changed` | `before: IntegrationIR`, `after: IntegrationIR` | modifying or ambiguous | medium to high | integration stub, config, workflows using it, tests, guarantees | yes if requiredness, kind, provider, config, or failure policy changes |
| `custom_extension_added` | `after: CustomExtensionIR` | additive | low to medium | extension stub, ownership metadata, workflows if called | no unless path collides |
| `custom_extension_removed` | `before: CustomExtensionIR` | destructive or ambiguous | medium | extension stub metadata, workflow calls, custom policy/test hooks | yes if file exists or extension is referenced |
| `custom_extension_changed` | `before: CustomExtensionIR`, `after: CustomExtensionIR` | modifying or ambiguous | medium | extension stub/interface, ownership metadata, workflow call sites, tests | yes if file/export/type contract changes |
| `guarantee_added` | `after: GuaranteeIR` | additive | low to medium | generated tests, runtime assertions, verification plan, affected workflow/model code | no unless guarantee conflicts with existing behavior |
| `guarantee_removed` | `before: GuaranteeIR` | destructive | medium | generated tests, runtime assertions, verification coverage | yes |
| `guarantee_changed` | `before: GuaranteeIR`, `after: GuaranteeIR` | modifying or ambiguous | medium | generated tests, runtime assertions, workflow code if required | yes if category/scope/predicate changes; no for description-only change |
| `policy_added` | `after: PolicyIR` | additive | low to medium | generated policy code, workflows, tests, runtime assertions | no unless policy conflicts |
| `policy_removed` | `before: PolicyIR` | destructive or modifying | medium | generated policy code, workflows, tests, runtime assertions | yes if enforcement weakens |
| `policy_changed` | `before: PolicyIR`, `after: PolicyIR` | modifying | medium to high | generated policy code, workflows, tests, runtime assertions | yes if enforcement weakens or changes side effects |
| `test_added` | `after: TestIR` | additive | low | generated tests, verification metadata | no |
| `test_removed` | `before: TestIR` | destructive or modifying | medium | generated tests, verification metadata, guarantee coverage | yes if it reduces guarantee coverage |
| `test_changed` | `before: TestIR`, `after: TestIR` | modifying | low to medium | generated tests, verification metadata | yes if guarantee coverage weakens or custom path changes |
| `target_changed` | `before: TargetIR`, `after: TargetIR` | modifying/destructive/ambiguous | high to critical | project scaffolding, runtime config, Prisma, Docker Compose, package files, all generated code | yes |

### 10.5 Diff examples

Field addition:

```json
{
  "id": "diff.model.Post.field.visibility.added",
  "type": "model_field_added",
  "entity_id": "model.Post.field.visibility",
  "parent_entity_id": "model.Post",
  "after": {
    "id": "model.Post.field.visibility",
    "kind": "model_field",
    "name": "visibility",
    "model_id": "model.Post",
    "type": {
      "kind": "enum",
      "values": ["public", "private", "followers"]
    },
    "constraints": {
      "required": true,
      "unique": false,
      "primary": false,
      "indexed": true,
      "immutable": false,
      "default": "public"
    }
  },
  "path": "/models/model.Post/fields/model.Post.field.visibility",
  "change_class": "additive",
  "risk": "low",
  "requires_confirmation": false,
  "affected_entity_ids": ["model.Post", "model.Post.field.visibility"],
  "expected_affected_artifacts": [
    {
      "artifact_kind": "prisma_schema",
      "path_pattern": "prisma/schema.prisma",
      "reason": "Add enum and column",
      "required": true
    },
    {
      "artifact_kind": "migration",
      "path_pattern": "prisma/migrations/*",
      "reason": "Add Post.visibility with default (illustrative; migration scaffolding is owned by IMPLEMENTATION_PLAN §3.5)",
      "required": true
    },
    {
      "artifact_kind": "validator",
      "path_pattern": "src/validators/post.ts",
      "reason": "Validate visibility enum",
      "required": true
    }
  ],
  "validation_notes": []
}
```

Workflow step reorder:

```json
{
  "id": "diff.workflow.CreatePost.step.notify_mentioned_users.reordered",
  "type": "workflow_step_reordered",
  "entity_id": "workflow.CreatePost.step.notify_mentioned_users",
  "parent_entity_id": "workflow.CreatePost",
  "before": { "order": 6 },
  "after": { "order": 4 },
  "path": "/workflows/workflow.CreatePost/steps/workflow.CreatePost.step.notify_mentioned_users/order",
  "change_class": "modifying",
  "risk": "high",
  "requires_confirmation": true,
  "affected_entity_ids": [
    "workflow.CreatePost",
    "workflow.CreatePost.step.notify_mentioned_users",
    "guarantee.notification_failure_does_not_rollback_post"
  ],
  "expected_affected_artifacts": [
    {
      "artifact_kind": "workflow",
      "path_pattern": "src/workflows/createPost.ts",
      "reason": "Change execution order and transaction placement",
      "required": true
    },
    {
      "artifact_kind": "test",
      "path_pattern": "tests/generated/createPost.notificationFailure.test.ts",
      "reason": "Ensure notification failure remains non-rollbacking",
      "required": true
    }
  ],
  "validation_notes": [
    "Reordering notification before insert may violate transactional guarantee."
  ]
}
```

### 10.6 Ambiguity handling

The diff engine must classify uncertain changes as `ambiguous` rather than assuming developer intent.

Examples:

- A model was removed and a similar model was added without alias metadata.
- A guarantee predicate changed category and scope simultaneously.
- An integration provider changed with no migration strategy.
- A field was removed and a new same-typed field was added with similar constraints.

Ambiguous changes require developer confirmation or additional migration metadata before apply.

## 11. Guarantee Model

Guarantees are central to the IR. They describe non-negotiable behavior that generated code and tests must satisfy.

### 11.1 Guarantee identity

Guarantee IDs follow:

```text
guarantee.<snake_case_name>
```

Examples:

```text
guarantee.no_unsanitized_html_persisted
guarantee.notification_failure_does_not_rollback_post
guarantee.post_creation_p95_latency
```

Guarantee IDs are used by:

- generated tests;
- verification coverage;
- runtime assertions;
- artifact mappings;
- drift reports;
- repair plans.

### 11.2 Guarantee categories

| Category | Meaning | V1 support |
|---|---|---|
| `data_integrity` | Persistence invariants, uniqueness, required writes | Testable/static depending on predicate |
| `transactional_behavior` | Rollback, commit, ordering, failure isolation | Testable for local workflows |
| `security_safety` | Sanitization, unsafe input rejection, safe persistence | Testable/runtime assertable |
| `moderation` | Required moderation before persistence or external action | Testable/static pattern check |
| `latency` | Latency thresholds and performance expectations | Partially verifiable through scaffolds |
| `integration_failure` | Behavior when external integrations fail | Testable with mocks/stubs |
| `authorization` | Access control expectations | Testable/static if policy is explicit |
| `custom` | Domain-specific guarantee | Must declare verification strategy |

### 11.3 Predicate representation

`formal_predicate` is optional but strongly preferred. It should be structured enough for test generation.

Supported V1 predicate forms:

```ts
type PredicateIR =
  | { type: "for_all_persisted_records"; entity_id: EntityRef; field_id: EntityRef; predicate: string }
  | { type: "implies"; if: PredicateEventIR; then: PredicateStateIR }
  | { type: "percentile_latency_lte"; workflow_id: EntityRef; percentile: number; threshold: DurationIR }
  | { type: "step_precedes"; workflow_id: EntityRef; before_step_id: EntityRef; after_step_id: EntityRef }
  | { type: "requires_auth"; trigger_id: EntityRef }
  | { type: "custom"; expression: string; references: EntityRef[] };

type PredicateEventIR =
  | { event: "integration_failure"; integration_id: EntityRef }
  | { event: "workflow_invoked"; workflow_id: EntityRef }
  | { event: "step_failed"; step_id: EntityRef };

type PredicateStateIR =
  | { state: "exists"; entity_id: EntityRef }
  | { state: "does_not_exist"; entity_id: EntityRef }
  | { state: "field_satisfies"; field_id: EntityRef; predicate: string }
  | { state: "auth_required"; trigger_id: EntityRef };
```

Rules:

- Predicate references must resolve.
- `custom.expression` is not executable by default. It must be paired with `manual`, `partially_verifiable`, or a custom test generator.
- V1 predicates are not full formal verification. They are structured test-generation and runtime-assertion inputs.

### 11.4 Verification strategies

Allowed strategies:

```text
unit_test
integration_test
contract_test
static_check
runtime_assertion
load_test_scaffold
manual_review
custom
```

`GuaranteeVerificationIR`:

```ts
interface GuaranteeVerificationIR {
  strategy:
    | "unit_test"
    | "integration_test"
    | "contract_test"
    | "static_check"
    | "runtime_assertion"
    | "load_test_scaffold"
    | "manual_review"
    | "custom";
  expected_tests: EntityRef[];
  limitations: string[];
}
```

Validation:

- `expected_tests` must reference `TestIR` entries.
- `limitations` must be empty for `testable` unless the limitation is non-semantic, such as provider mocking.
- `manual_review` requires `verifiability: manual`.
- `load_test_scaffold` normally requires `verifiability: partially_verifiable`.

### 11.5 Runtime assertions

Runtime assertions can enforce or detect guarantee violations during execution.

```ts
interface RuntimeAssertionIR {
  id: string;
  location: EntityRef;
  predicate: string;
  mode: "throw" | "log" | "metric";
}
```

Rules:

- `location` must reference a workflow or step.
- `mode: throw` may change runtime behavior and must be considered in risk classification.
- Assertions must not silently replace tests; they are additional verification metadata.

### 11.6 Guarantee-to-test mapping

Every testable guarantee must map to one or more generated `TestIR` entries.

Example mapping:

```json
{
  "id": "guarantee.notification_failure_does_not_rollback_post",
  "kind": "guarantee",
  "category": "transactional_behavior",
  "scope": ["workflow.CreatePost"],
  "verifiability": "testable",
  "verification": {
    "strategy": "integration_test",
    "expected_tests": [
      "test.create_post_notification_failure_does_not_rollback"
    ],
    "limitations": []
  }
}
```

Corresponding test declaration:

```json
{
  "id": "test.create_post_notification_failure_does_not_rollback",
  "kind": "test",
  "test_kind": "integration",
  "framework": "vitest",
  "path": "tests/generated/createPost.notificationFailure.test.ts",
  "guarantee_id": "guarantee.notification_failure_does_not_rollback_post",
  "scope": ["workflow.CreatePost"]
}
```

### 11.7 Partial verification

Some guarantees cannot be proven locally in V1. They may still be represented if the IR marks them accurately.

Example:

```json
{
  "id": "guarantee.post_creation_p95_latency",
  "kind": "guarantee",
  "category": "latency",
  "verifiability": "partially_verifiable",
  "verification": {
    "strategy": "load_test_scaffold",
    "expected_tests": ["test.create_post_p95_latency_scaffold"],
    "limitations": [
      "Local tests cannot prove production p95 latency."
    ]
  }
}
```

Planner and verification reports must surface partial coverage explicitly.

## 12. Artifact Mapping

Artifact mapping connects IR entities to generated implementation artifacts. It is required for incremental sync, targeted patching, ownership enforcement, verification, and drift detection.

### 12.1 Mapping requirements

Each generated artifact must record:

- artifact ID;
- repository-relative path;
- artifact kind;
- owning IR entity IDs;
- ownership ID;
- optional generated region metadata;
- hash of the IR fragment used to generate it;
- hash of generated content or region in ownership metadata.

### 12.2 Example mapping

```json
{
  "entity_id": "model.Post",
  "artifacts": [
    {
      "id": "artifact.prisma_schema_prisma",
      "path": "prisma/schema.prisma",
      "region": {
        "kind": "semantic_region",
        "label": "model Post"
      },
      "ownership": "generated_region"
    },
    {
      "id": "artifact.src_models_post_ts",
      "path": "src/models/post.ts",
      "ownership": "generated_file"
    }
  ]
}
```

Canonical `ArtifactIR` form:

```json
{
  "id": "artifact.prisma_schema_prisma",
  "kind": "artifact",
  "artifact_kind": "prisma_schema",
  "path": "prisma/schema.prisma",
  "region": {
    "kind": "semantic_region",
    "label": "model Post"
  },
  "entity_ids": ["model.Post"],
  "ownership_id": "ownership.prisma_schema_prisma"
}
```

### 12.3 Region metadata

```ts
interface ArtifactRegionIR {
  kind: "whole_file" | "line_span" | "generated_marker" | "semantic_region";
  start_line?: number;
  end_line?: number;
  marker_id?: string;
  label?: string;
}
```

Rules:

- Fully generated files use `kind: whole_file` or omit `region`.
- Generated regions in mixed files must use `generated_marker`.
- Semantic regions, such as Prisma `model Post`, may be used for planning, but generated markers are preferred for precise patching when available.
- Line spans are allowed for diagnostics but are not stable enough as sole patch targets.

### 12.4 Generated region markers

Generated region markers should use this format in TypeScript:

```ts
// <arch-generated id="workflow.CreatePost.step.notify_mentioned_users">
// generated code
// </arch-generated>
```

Rules:

- Marker IDs must be IR entity IDs or artifact region IDs.
- Markers must be balanced.
- Nested generated markers are not allowed in V1.
- Modifying code inside a generated marker is drift unless the artifact is being patched by Arch.

### 12.5 Artifact impact by entity

Default V1 artifact dependencies:

| Entity | Typical generated artifacts |
|---|---|
| `TargetIR` | `package.json`, `docker-compose.yml`, `src/runtime/*`, `prisma/schema.prisma` |
| `ModelIR` | `prisma/schema.prisma`, migrations, `src/models/*`, `src/validators/*`, model tests |
| `FieldIR` | Prisma schema, migrations, generated model type, validator, affected route/workflow tests |
| `RelationIR` | Prisma schema, migrations, generated model type, workflow queries, tests |
| `WorkflowIR` | route, workflow implementation, validators, tests |
| `TriggerIR` | Fastify route registration, route tests |
| `StepIR` | workflow implementation, integration stubs, generated tests |
| `IntegrationIR` | integration interface/stub, runtime config, workflow implementation, integration tests |
| `CustomExtensionIR` | extension-point stub, ownership metadata, workflow call sites, custom tests or policies |
| `PolicyIR` | policy code, workflow implementation, tests |
| `GuaranteeIR` | generated tests, runtime assertions, verification coverage, possibly workflow code |
| `TestIR` | `tests/generated/*` |

### 12.6 Drift detection from artifact mapping

Drift detection must check:

1. Artifact exists where expected.
2. Artifact ownership metadata exists.
3. Generated file or region hash matches the last generated hash, unless a current Arch operation is updating it.
4. Generated markers are present and balanced.
5. Human-owned files were not modified by Arch.
6. Artifacts required by the current IR are not stale or orphaned.
7. Generated tests still map to declared guarantees.
8. Static guarantee drift detectors pass for supported patterns.

Example drift report input:

```json
{
  "artifact_id": "artifact.src_workflows_createPost_ts",
  "entity_id": "workflow.CreatePost",
  "expected_hash": "sha256:workflowfileexample",
  "actual_hash": "sha256:changed",
  "drift_kind": "generated_file_modified"
}
```

## 13. Source Mapping

Source mapping preserves traceability from IR entities back to `.arch` source.

### 13.1 Required source mapping fields

Every source-mapped entity must have:

- `file`;
- `line`;
- `column`;
- `span.start_offset`;
- `span.end_offset`;
- `entity_id`;
- `source_hash`.

### 13.2 Source hash

`source_hash` is computed over the exact raw source span with line endings normalized to `\n`.

Purpose:

- detect whether source text for an entity changed;
- produce precise validation errors;
- connect generated code headers to source declarations;
- preserve traceability across planning and apply;
- support diagnostics when generated artifacts drift.

### 13.3 Error reporting

Validation errors should include:

```json
{
  "code": "ARCH_VALIDATION_UNDECLARED_INTEGRATION",
  "message": "Workflow CreatePost step notify_mentioned_users references integration PushProvider, but no integration with that name is declared.",
  "entity_id": "workflow.CreatePost.step.notify_mentioned_users",
  "source_id": "source.backend_arch.workflow.CreatePost.step.notify_mentioned_users",
  "file": "backend.arch",
  "line": 40,
  "column": 7
}
```

### 13.4 Source mapping for compiler-injected entities

Some entities are compiler-injected, such as default verification metadata or generated artifact metadata. These must use synthetic source locations:

```json
{
  "id": "source.generated.verification.primary",
  "file": ".arch/generated",
  "generated": true,
  "entity_id": "verification.primary"
}
```

Compiler-injected entities must still be traceable and deterministic.

## 14. Ownership Model

### 14.1 Ownership categories

| Ownership kind | Owner | Update policy | Meaning |
|---|---|---|---|
| `generated_file` | `arch` | `overwrite_allowed` or `patch_allowed` | Arch owns the whole file. |
| `generated_region` | `arch` | `patch_allowed` | Arch owns only the marked region. |
| `extension_point` | `human` or `shared` | `create_only` or `requires_confirmation` | Arch may create a stub but must preserve human implementation. |
| `human_file` | `human` | `read_only` | Arch must not modify. |

### 14.2 Ownership validation

Before apply, Arch must verify:

1. The patch touches only allowed files or regions.
2. Human-owned files are unchanged unless explicitly confirmed.
3. Extension-point stubs are not overwritten after human modification.
4. Generated region markers are present before patching mixed files.
5. Artifact hashes match expected previous state before incremental patching, or drift is reported.

### 14.3 Ownership metadata storage

Canonical IR includes desired ownership metadata. Actual project state should also store `.arch/ownership.json` containing current content hashes and drift status. The state file may include timestamps and operation IDs because it is not canonical IR.

## 15. Verification Metadata

Verification metadata connects IR declarations to executable checks.

### 15.1 Required V1 verification commands

V1 generated projects should support:

```bash
pnpm typecheck
pnpm test
```

Optional if configured:

```bash
pnpm lint
```

Integration tests may require Docker Compose services.

### 15.2 Guarantee coverage statuses

```text
covered
partially_covered
manual
missing
```

Rules:

- `covered`: generated tests or assertions cover the guarantee according to its verification strategy.
- `partially_covered`: tests exist but cannot prove the full guarantee under V1 constraints.
- `manual`: developer must review.
- `missing`: validation or planning must fail for `testable` guarantees.
- Unsupported guarantees are diagnostics-only and must block normal V1 apply before verification coverage is accepted.

### 15.3 Repair metadata

V1 repair must be bounded:

```json
{
  "repair": {
    "allowed": true,
    "max_attempts": 3
  }
}
```

Repair tasks must be constrained by:

- failing verification output;
- typed diff or drift report;
- affected artifact list;
- ownership allowlist;
- guarantee/test expectations.

## 16. Dependency Graph Construction

The dependency graph is derived from IR references. It is not a separate source of truth.

### 16.1 Graph node types

Nodes:

- system;
- target;
- model;
- field;
- relation;
- workflow;
- trigger;
- step;
- integration;
- custom_extension;
- policy;
- guarantee;
- test;
- artifact;
- ownership.

### 16.2 Graph edges

| Edge | Meaning |
|---|---|
| `contains` | Parent entity contains child entity. |
| `references` | Entity references another entity. |
| `reads` | Step reads model/field/relation. |
| `writes` | Step writes model/field. |
| `uses` | Step uses integration or policy. |
| `verifies` | Test verifies guarantee. |
| `implements` | Artifact implements entity. |
| `owned_by` | Artifact or region has ownership metadata. |
| `scoped_to` | Guarantee or policy applies to entity. |

### 16.3 Affected artifact computation

For each diff:

1. Start with the changed entity.
2. Traverse `contains` upward to parent model/workflow/system.
3. Traverse reverse `references`, `reads`, `writes`, and `uses` edges to find dependent workflows, guarantees, tests, and policies.
4. Traverse `implements` edges to artifacts.
5. Filter artifacts by ownership and update policy.
6. Include generated tests for affected guarantees.
7. Mark human-owned or extension-point artifacts as read-only context unless confirmation is available.

## 17. Compiler Pipeline Contract

The pipeline order is normative for V1:

```text
Parser -> AST -> draft semantic model/draft IR -> semantic validation -> canonical IR -> IR schema validation -> IR snapshot store -> typed diff -> dependency graph -> sync plan -> deterministic templates/constrained agents -> verification -> metadata promotion
```

Semantic validation happens before a canonical IR snapshot is accepted. IR schema validation happens after canonicalization and before the snapshot is stored or diffed.

### 17.1 Parser to draft semantic model

Input:

- `.arch` source files;
- parser AST with source spans.

Output:

- draft semantic model or draft IR;
- source location map.

### 17.2 Semantic validator to canonical IR generator

Input:

- draft semantic model or draft IR.

Output:

- canonical IR if semantically valid;
- validation diagnostics if invalid.

### 17.3 Canonical IR schema validator to snapshot store

Input:

- canonical IR.

Output:

- schema-valid canonical IR snapshot;
- schema diagnostics if invalid.

### 17.4 Snapshot store to diff engine

Input:

- previous canonical IR snapshot;
- current canonical IR snapshot.

Output:

- `IRDiffSet` with typed changes.

### 17.5 Diff engine to dependency graph and planner

Input:

- current IR;
- diff set;
- artifact map;
- ownership metadata;
- dependency graph.

Output:

- patch plan with affected artifacts, risk classification, confirmation requirements, generated tests, and verification commands.

### 17.6 Planner to template/patch engine

Input:

- patch plan;
- allowed artifacts;
- relevant IR fragments;
- current file contents;
- ownership rules.

Output:

- deterministic template edits where possible;
- constrained synthesis tasks where deterministic edits are insufficient;
- updated artifact and ownership metadata.

Agents used in this phase receive typed, bounded patch tasks only. They must not parse `.arch`, decide diffs, create sync plans from scratch, bypass ownership, weaken guarantees, or mark verification passed.

### 17.7 Patch engine to verifier

Input:

- patched project;
- verification metadata;
- generated tests;
- ownership metadata.

Output:

- verification report;
- drift report if applicable;
- bounded repair plan if repair is enabled.

### 17.8 Verifier to metadata promotion

Input:

- successful verification report;
- updated artifact hashes;
- updated ownership state;
- IR snapshot.

Output:

- promoted IR and artifact metadata for future diffs;
- rejected promotion if required verification fails.

## 18. V1 Limitations and Explicit Non-Goals

V1 intentionally focuses on one backend stack and one synchronization loop.

Out of scope:

1. Frontend route or UI generation.
2. Mobile app generation.
3. Arbitrary app generation.
4. Multi-service orchestration.
5. Kubernetes or production deployment automation.
6. Arbitrary backend languages.
7. Backend frameworks other than Fastify.
8. Databases other than PostgreSQL.
9. ORMs other than Prisma.
10. Complex event streaming.
11. Complex distributed transactions.
12. Advanced formal verification.
13. Arbitrary natural-language requirements as executable guarantees.
14. Automatic destructive migrations.
15. Free-form autonomous codebase rewrites.
16. Hidden no-code runtime behavior.
17. Full production observability or SLO enforcement.
18. Multiple `.arch` source files unless merged by a deterministic preprocessor before IR generation.
19. Implicit many-to-many relations.
20. Scalar array persistence.
21. Cross-service data consistency guarantees.
22. Provider-complete integration SDK support.

Unsupported features must be rejected or marked manual/partial where explicitly allowed by the schema. They must not be silently delegated to generated code or implementation agents.

## 19. Implementation Notes for an IR Validator

A V1 validator should implement these passes in order:

1. **Draft shape validation:** ensure the draft semantic model or draft IR has enough structure for semantic validation.
2. **Identity validation:** ensure IDs are unique, aliases are non-conflicting, and source IDs resolve where already assigned.
3. **Reference resolution:** resolve all source references into `EntityRef` fields.
4. **Target validation:** reject unsupported stack values.
5. **Model validation:** validate primary keys, field types, constraints, relations, and indexes.
6. **Workflow validation:** validate triggers, step order, operation types, and references.
7. **Integration validation:** validate integration kinds, requirement flags, and failure policies.
8. **Custom extension validation:** validate extension contracts, files, exports, ownership intent, and call sites.
9. **Policy validation:** validate scopes, rule syntax, and enforcement modes.
10. **Guarantee validation:** validate category, scope, predicate references, verifiability, and test mapping.
11. **Canonical IR schema validation:** ensure the canonical JSON shape, required fields, enums, and primitive types conform to `arch.ir.v1`.
12. **Artifact validation:** validate artifact paths, ownership references, generation metadata, and generated-region metadata.
13. **Verification validation:** ensure commands and guarantee coverage are complete.
14. **Cross-entity consistency:** detect policy/guarantee conflicts, unsupported feature combinations, and destructive target changes.

## 20. Implementation Notes for an IR Diff Engine

A V1 diff engine should:

1. Load two canonical IR documents.
2. Verify both use `arch.ir.v1`.
3. Index entities by primary ID.
4. Use aliases to resolve explicit renames.
5. Compare entity existence for added/removed changes.
6. Compare fields within matching entities using typed comparators.
7. Treat workflow step order as semantic.
8. Ignore source formatting changes when semantic fields are unchanged.
9. Treat enum value order as semantic when comparing `TypeDescriptorIR.values`.
10. Emit typed diffs only from the supported V1 diff set.
11. Classify each diff by change class and risk.
12. Compute affected entities through the dependency graph.
13. Compute expected affected artifacts from artifact mappings and default dependency rules.
14. Mark destructive and ambiguous changes as requiring confirmation.
15. Emit deterministic diff ordering: destructive, ambiguous, modifying, additive; then by entity ID.

## 21. Implementation Notes for Artifact Mapping

A V1 artifact mapper should:

1. Generate default artifact mappings from entity kinds.
2. Preserve existing artifact IDs when paths do not change.
3. Store generated artifact hashes after apply.
4. Update artifact mappings when generated paths change.
5. Mark orphaned generated artifacts when their source entity is removed.
6. Require confirmation before deleting orphaned generated artifacts if the deletion is destructive.
7. Keep human-owned files out of patch allowlists.
8. Use generated-region markers only where fully generated files are impractical.

## 22. Implementation Notes for Guarantee-to-Test Mapping

A V1 guarantee-to-test mapper should:

1. Classify each guarantee by category.
2. Resolve scoped entities.
3. Select a verification strategy.
4. Generate one or more `TestIR` declarations.
5. Add runtime assertions when useful and safe.
6. Add verification coverage entries.
7. Mark partial coverage for latency and environment-dependent guarantees.
8. Reject unsupported guarantees unless diagnostic mode is enabled.

Recommended mappings:

| Guarantee category | Default V1 mapping |
|---|---|
| `security_safety` | Integration tests plus optional runtime assertion |
| `transactional_behavior` | Integration tests with mocked integration failure |
| `integration_failure` | Integration tests with failing stub |
| `moderation` | Static check that moderation precedes persistence plus integration test |
| `data_integrity` | Unit/integration tests and schema assertions |
| `authorization` | Route contract tests and policy checks |
| `latency` | Load-test scaffold, partial coverage |
| `custom` | Manual or custom mapper required |

## 23. Open Questions

These decisions are intentionally left open for implementation planning beyond this IR specification:

1. **Rename syntax:** Should `.arch` support explicit `renamed_from` annotations, or should rename hints live only in migration metadata?
2. **Source syntax evolution:** Which ergonomic additions should future `.arch` versions add without changing the V1 custom block-syntax baseline?
3. **Index syntax:** How expressive should V1 database indexes be beyond primary, unique, and simple indexed fields?
4. **Auth depth:** Should `oauth.github` be a real generated integration in V1 or a typed stub with route-level placeholders?
5. **Provider templates:** Which integration providers deserve deterministic templates versus custom stubs?
6. **Migration planning:** How much Prisma migration generation should be deterministic before requiring developer review?
7. **Performance guarantees:** What level of local load-test scaffolding is sufficient for partial latency verification?
8. **Drift detection depth:** Which guarantee drift detectors should V1 implement beyond ownership/hash checks and transactional notification placement?
9. **Multi-file source:** Should V1 allow multiple `.arch` files after deterministic merge, or keep exactly one `backend.arch` file?
10. **Custom code contracts:** How rich should `CustomExtensionIR` contracts become beyond V1 scalar/model input and output descriptors?

## 24. Summary

The Arch V1 IR is the durable compiler boundary for backend intent. It is deterministic, typed, source-mapped, diffable, artifact-aware, ownership-aware, and verification-oriented. It keeps `.arch` source human-readable while giving the compiler and synchronization pipeline a precise contract for validation, planning, patching, testing, drift detection, and repair.

The central rule is:

```text
Source syntax is for humans.
Canonical IR is for the compiler.
Generated implementation is a build artifact.
```
