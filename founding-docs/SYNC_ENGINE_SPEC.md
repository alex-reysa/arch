# Arch Sync Engine Specification

**Status:** V1 technical specification  
**Applies to:** Arch V1  
**Primary source file:** `backend.arch`  
**Canonical compiler boundary:** `arch.ir.v1`  
**Sync plan schema version:** `arch.sync_plan.v1`  
**Diff schema version:** `arch.diff.v1`  
**Patch schema version:** `arch.patch.v1`  
**Default target:** TypeScript, Node.js, Fastify, PostgreSQL, Prisma, Redis by default or `cache: none` / `cache:none`, Vitest, Docker Compose, pnpm

---

## 1. Overview

The Arch sync engine is the component that turns a validated change in system intent into a bounded implementation patch for an AI-generated TypeScript backend workflow service.

It answers this question:

```text
Given previous IR, current IR, artifact map, ownership map, and current codebase state,
what exact implementation changes are required?
```

The sync engine does not parse `.arch` source, invent missing requirements, freely traverse a repository, or decide whether generated code is correct. Those responsibilities are handled by other compiler stages and the verifier.

The sync engine receives previous and current canonical IR snapshots after IR schema validation, plus project metadata. It computes typed intent diffs, classifies risk, resolves affected implementation artifacts, builds a patch plan, applies deterministic and constrained agent-assisted patches, stages metadata updates, and hands the patched working tree to verification.

The V1 sync engine is deliberately conservative:

```text
small supported intent change -> small bounded patch
large supported intent change -> structured multi-step patch plan
destructive or ambiguous change -> explicit developer decision
unsupported change -> stop before writing
ownership conflict -> stop before writing
verification failure -> no metadata promotion
```

The sync engine exists to make AI-assisted backend code generation durable over time. Generated implementation code is an inspectable build artifact, but it is not the source of truth. The single `backend.arch` specification and its canonical IR are the source of truth for the single generated backend service in V1.

---

## 2. Scope

### 2.1 V1 responsibilities

The sync engine is responsible for:

```text
- loading IR snapshots and verifying schema version/canonical hash
- storing candidate and baseline IR snapshots
- computing typed intent diffs
- classifying changes by class and risk
- detecting destructive and ambiguous changes
- resolving affected IR entities
- resolving affected implementation artifacts
- enforcing artifact and ownership metadata
- creating machine-readable sync plans
- creating human-readable plan summaries
- creating deterministic patch operations
- creating constrained agent task specifications
- validating patch operations before writing
- applying patches only to allowlisted files or generated regions
- staging artifact-map and ownership metadata updates
- detecting stale plans and metadata conflicts
- blocking unsafe or unsupported changes
- handing verification requirements to the verifier
- promoting IR and metadata only after verification succeeds
```

### 2.2 V1 non-responsibilities

The sync engine must not:

```text
- parse raw `.arch` syntax
- perform semantic validation of source declarations
- generate canonical IR from source
- treat raw source text diffs as semantic diffs
- ask an LLM to determine what changed
- ask an LLM to choose the sync plan from scratch
- write to human-owned files without explicit permission
- silently accept manual edits to generated files
- silently perform destructive migrations
- silently delete generated artifacts
- weaken guarantees to make verification pass
- mark verification as passed
- operate as an autonomous long-running agent
- synchronize arbitrary legacy repositories outside the V1 generated structure
- implement unsupported V1 product scope such as frontend generation, arbitrary app generation, implicit many-to-many relations, scalar array persistence, complex event streaming, production deployment automation, or full formal verification
```

### 2.3 Supported sync domains in V1

V1 supports synchronization for these IR entity categories:

```text
target
model
model_field
model_index
relation
workflow
workflow_step
integration
custom_extension
policy
guarantee
test
verification metadata
```

Artifact and ownership metadata are inputs and outputs of the sync engine. They are not treated as primary product intent unless explicitly declared by the IR generator.

V1 default ownership follows the generated project layout:

```text
- `src/generated/**` is Arch-owned generated output.
- `src/custom/**` is human-owned after Arch creates an optional stub.
- generated regions are avoided and rare in V1; fully generated files plus extension points are preferred.
```

---

## 3. High-Level Sync Pipeline

The full Arch pipeline is:

```text
Parser -> AST -> draft semantic model/draft IR -> semantic validation -> canonical IR -> IR schema validation -> IR snapshot store -> typed diff -> dependency graph -> sync plan -> deterministic templates/constrained agents -> verification -> metadata promotion
```

The sync engine begins only after canonical IR schema validation and receives previous/current canonical IR snapshots from the snapshot store. It must not parse `backend.arch`, build draft IR, or perform semantic validation.

### 3.1 Plan mode

`arch plan` runs the read-only planning half of the sync engine.

```text
current backend.arch
   ↓ CLI/compiler pipeline parses, semantically validates, canonicalizes, and schema-validates outside sync engine
current canonical IR
   ↓ sync engine loads previous IR + metadata
snapshot validation
   ↓
typed IR diff
   ↓
risk classification
   ↓
affected entity graph
   ↓
affected artifact resolution
   ↓
ownership preflight
   ↓
patch plan generation
   ↓
write plan JSON + human summary
```

Plan mode may write:

```text
.arch/ir.current.json
.arch/plans/<plan-id>.plan.json
.arch/plans/<plan-id>.summary.md
.arch/runs/<run-id>/diff.json, if configured
```

Plan mode must not write implementation files.

### 3.2 Apply mode

`arch apply` runs the write path.

```text
selected sync plan
   ↓
CLI/compiler pipeline provides freshly compiled current canonical IR
   ↓
validate plan hashes and metadata hashes
   ↓
check ownership and drift in affected files
   ↓
validate confirmations for destructive changes
   ↓
apply deterministic template operations
   ↓
invoke constrained agents where planned
   ↓
validate and apply agent patch operations
   ↓
format and syntax-check touched files
   ↓
stage metadata updates
   ↓
verification handoff
   ↓ verifier + optional bounded repair outside core sync planning
verification result
   ↓
promote IR + metadata only on success
```

Apply mode may write implementation files only through validated patch operations.

### 3.3 Check mode

`arch check` uses the sync engine for drift detection and conformance planning, not for applying patches.

```text
current canonical IR
   ↓
last verified IR + metadata
   ↓
current codebase state
   ↓
metadata and ownership checks
   ↓
generated artifact hash checks
   ↓
static guarantee drift checks where supported
   ↓
drift report
```

### 3.4 Repair mode

`arch repair` consumes verification or drift failures and creates a bounded repair plan. Repair uses the same ownership, patch validation, and verification handoff contracts as apply.

Repair is not an unrestricted coding loop. It is a constrained patch path tied to a failed plan, failed verification stage, or deterministic drift report.

---

## 4. Inputs and Outputs

### 4.1 Required inputs

```ts
interface SyncEngineInput {
  mode: "plan" | "apply" | "check" | "repair";
  project_root: string;
  compiler_version: string;

  previous_ir?: ArchIR;
  current_ir: ArchIR;

  artifact_map?: ArtifactMapV1;
  ownership_map?: OwnershipMapV1;
  source_map?: SourceMapV1;

  codebase_state: CodebaseStateV1;

  selected_plan?: SyncPlanV1;
  command_flags: SyncCommandFlags;
}
```

Required input meanings:

| Input | Meaning |
|---|---|
| `previous_ir` | Last successfully applied and verified canonical IR. Missing only during first generation. |
| `current_ir` | Canonical IR compiled from current `backend.arch`. |
| `artifact_map` | Mapping from IR entities to generated files or regions, usually from `.arch/artifact-map.json`. |
| `ownership_map` | File and region ownership metadata, usually from `.arch/ownership.json`. |
| `source_map` | Entity-to-source mapping used for diagnostics and traceability. |
| `codebase_state` | Current repository file, hash, region, Git, and marker state. |
| `selected_plan` | Required in apply mode unless the CLI chooses the latest valid plan. |
| `command_flags` | Confirmation flags, repair settings, rollback settings, dirty-worktree policy, and verifier options. |

### 4.2 Codebase state

The sync engine treats the current repository as explicit input.

```ts
interface CodebaseStateV1 {
  root: string;
  files: CodebaseFileState[];
  git?: GitState;
  generated_regions: GeneratedRegionState[];
  symlinks: SymlinkState[];
  package_state?: PackageState;
}

interface CodebaseFileState {
  path: string;
  exists: boolean;
  file_kind: "regular" | "directory" | "symlink" | "missing" | "external";
  content_hash?: string;
  size_bytes?: number;
  git_status?: "clean" | "modified" | "added" | "deleted" | "untracked" | "ignored";
}

interface GeneratedRegionState {
  path: string;
  region_id: string;
  entity_ids: string[];
  start_marker_found: boolean;
  end_marker_found: boolean;
  content_hash?: string;
}
```

Rules:

```text
- All paths must be repository-relative POSIX paths.
- Absolute paths are invalid.
- Paths containing `..` after normalization are invalid.
- Symlink targets must not escape the repository.
- `node_modules/`, `.git/`, and external dependency directories are never patch targets.
```

### 4.3 Primary outputs

```ts
interface SyncEngineOutput {
  status:
    | "planned"
    | "applied_pending_verification"
    | "verified_and_promoted"
    | "blocked"
    | "failed";

  diff_set?: IRDiffSetV1;
  plan?: SyncPlanV1;
  patch_set?: PatchSetV1;
  metadata_update?: MetadataUpdateSetV1;
  verification_handoff?: VerificationHandoffV1;
  drift_report?: DriftReportV1;
  conflicts: SyncConflict[];
  diagnostics: SyncDiagnostic[];
}
```

The most important output is `SyncPlanV1`. A valid plan must make every intended implementation change explicit before code is written.

---

## 5. State Storage

### 5.1 Directory layout

The sync engine uses the following stable state files:

```text
.arch/
  ir.previous.json
  ir.current.json
  artifact-map.json
  ownership.json
  source-map.json
  drift.json
  plans/
    <plan-id>.plan.json
    <plan-id>.summary.md
  runs/
    <run-id>/
      input.json
      diff.json
      plan.json
      patch.json
      metadata-update.json
      verification-handoff.json
      verification-report.json
      verification-report.md
      conflicts.json
      agent-tasks/
      agent-results/
      files-before/
      files-after/
  repair-history/
    <repair-run-id>.json
  locks/
    apply.lock
  tmp/
```

Stable metadata files should be version-controlled by default:

```text
.arch/ir.previous.json
.arch/artifact-map.json
.arch/ownership.json
.arch/source-map.json
.arch/plans/*.summary.md, optionally
```

Volatile run logs may be ignored by project policy, but the sync engine must still write them during execution.

### 5.2 `ir.previous.json`

`ir.previous.json` is the last verified baseline IR.

Rules:

```text
- Created only after successful first apply and verification.
- Updated only after apply and required verification succeed.
- Never updated by failed plan, failed apply, failed repair, or check.
- Used as the diff baseline for the next plan.
- Its `canonical_hash` must match the canonical hash of its contents.
```

If missing, the sync engine treats the operation as first generation.

### 5.3 `ir.current.json`

`ir.current.json` is the latest candidate IR compiled from the current source.

Rules:

```text
- Written during plan, check, and apply preflight.
- Not considered verified.
- Must match `selected_plan.next_ir_hash` during apply.
- Promoted to `ir.previous.json` only after successful verification.
```

### 5.4 `artifact-map.json`

`artifact-map.json` maps IR entities to implementation artifacts.

```ts
interface ArtifactMapV1 {
  schema_version: "arch.artifact_map.v1";
  ir_hash: string;
  generator_version: string;
  artifacts: ArtifactMapEntry[];
}

interface ArtifactMapEntry {
  id: string;
  path: string;
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
  region?: ArtifactRegion;
  entity_ids: string[];
  ownership_id: string;
  generation: ArtifactGenerationMetadata;
  generated_from_hash?: string;
  source_ids: string[];
}

interface ArtifactGenerationMetadata {
  mode: "deterministic_template" | "constrained_agent" | "manual_registration";
  generator_id: string;
  template_id?: string;
  ir_fragment_hash: string;
}
```

Rules:

```text
- Artifact IDs must remain stable when paths do not change.
- Every generated file must have exactly one ownership entry.
- Every artifact entry must preserve generation metadata from `ArtifactIR`.
- A generated artifact may implement multiple IR entities.
- A single IR entity may map to multiple artifacts.
- Missing mapped files are drift unless they are planned deletions.
- Orphaned generated artifacts are not deleted unless the plan explicitly includes deletion.
```

### 5.5 `ownership.json`

`ownership.json` determines whether the sync engine may write to a file or region.

```ts
interface OwnershipMapV1 {
  schema_version: "arch.ownership.v1";
  entries: OwnershipEntry[];
}

interface OwnershipEntry {
  id: string;
  path: string;
  region?: ArtifactRegion;
  owner: "arch" | "human" | "shared";
  ownership_kind:
    | "generated_file"
    | "generated_region"
    | "extension_point"
    | "human_file";
  update_policy:
    | "overwrite_allowed"
    | "patch_allowed"
    | "create_only"
    | "read_only"
    | "requires_confirmation";
  write_scope: "whole_file" | "generated_region" | "stub_only" | "none";
  entity_ids: string[];
  content_hash?: string;
}
```

Rules:

```text
- `generated_file` may be overwritten or patched according to update policy.
- `generated_region` may be patched only inside matching generated markers.
- `extension_point` may be created if missing; after user edits, it is read-only unless explicit confirmation is supplied.
- `human_file` is read-only.
- `write_scope` must agree with ownership kind: generated files use `whole_file`, generated regions use `generated_region`, extension stubs use `stub_only`, and human files use `none`.
- No patch operation may target a path without an ownership decision.
```

### 5.6 Plan files

A plan file is an immutable record of a planned sync operation.

A plan is valid only while all of these are true:

```text
- current compiler version is compatible with plan.compiler_version
- `.arch/ir.previous.json`.canonical_hash == plan.base_ir_hash
- freshly compiled current IR canonical_hash == plan.next_ir_hash
- artifact-map hash == plan.artifact_map_hash, unless plan declares a compatible metadata migration
- ownership-map hash == plan.ownership_map_hash, unless plan declares a compatible metadata migration
- affected generated files have not drifted from ownership hashes
- required confirmations are present
```

If any condition fails, apply must stop with `plan_stale` or `metadata_changed`.

### 5.7 Atomic metadata writes

Metadata writes must use a safe replace protocol:

```text
1. Write to `.arch/tmp/<file>.<run-id>.tmp`.
2. Flush file contents.
3. Validate JSON schema and hashes.
4. Rename into place atomically where the filesystem supports it.
5. Record the write in the run report.
```

The sync engine must never partially promote `ir.previous.json`, `artifact-map.json`, and `ownership.json`. Promotion is a single logical transaction after verification passes.

---

## 6. Core Invariants

The sync engine must preserve these invariants.

### 6.1 Source-of-truth invariant

```text
Implementation changes are derived from canonical IR diffs, not raw source text diffs or LLM interpretation.
```

### 6.2 Minimality invariant

```text
Only files or generated regions affected by the typed diff may be changed.
```

A broader rewrite is allowed only when:

```text
- the file is fully generated;
- the file is allowlisted by the plan;
- the rewrite is cheaper and safer than region-level patching;
- the resulting generated artifact maps to the same or explicitly updated IR entities.
```

### 6.3 Ownership invariant

```text
Human-owned files and completed extension points are not modified by default.
```

### 6.4 Verification promotion invariant

```text
Metadata is promoted only after required verification succeeds.
```

A failed apply may leave working tree changes for inspection, but it must not update the verified baseline IR or committed artifact ownership hashes.

### 6.5 Deterministic planning invariant

Given the same:

```text
previous IR
current IR
artifact map
ownership map
codebase state
compiler version
command flags
```

`arch plan` must produce the same typed diff set, risk classification, affected artifacts, and machine-readable plan.

### 6.6 Agent boundary invariant

```text
Agents may produce patch proposals, but they may not change the plan semantics.
```

Agent output is accepted only if it validates against the patch schema, touches allowlisted files, respects ownership, and passes verification.

---

## 7. Typed Diff Computation

### 7.1 Diff input domain

The diff engine compares canonical IR documents. It computes intent diffs over these entity categories:

```text
target
model
model_field
model_index
relation
workflow
workflow_step
integration
custom_extension
policy
guarantee
test
```

The default intent diff excludes these metadata-only IR categories:

```text
artifact
ownership
source_location
verification metadata
```

Those categories are checked by metadata validation, guarantee/test planning, verification handoff construction, and drift detection, not by standalone intent diff types in V1.

`system` and `trigger` IR entities are used for initial generation, dependency graph construction, artifact resolution, and diagnostics. The required V1 diff matrix does not define standalone `system_changed` or `trigger_changed`; implementation-affecting changes in those areas must either be represented by an explicit supported diff in a future taxonomy or block as unsupported instead of being encoded as free-form diffs.

### 7.2 Diff preflight

Before comparison, the diff engine must:

```text
1. Validate both IR documents against `arch.ir.v1`.
2. Verify both canonical hashes.
3. Verify both schema versions are compatible.
4. Flatten all comparable entities into an entity index.
5. Validate entity ID uniqueness.
6. Resolve explicit aliases for rename-aware comparison.
7. Reject alias conflicts.
```

### 7.3 Entity flattening

Nested IR objects are flattened into entity records.

Example:

```text
model.Post
model.Post.field.id
model.Post.field.content
relation.Post.author.User
workflow.CreatePost
workflow.CreatePost.trigger.api_post_posts
workflow.CreatePost.step.validate_input
workflow.CreatePost.step.insert_post
guarantee.no_unsanitized_html_persisted
```

Each flattened record includes:

```ts
interface ComparableEntity {
  id: string;
  kind: string;
  parent_id?: string;
  canonical_value: unknown;
  compare_value: unknown;
  source_id?: string;
  aliases: string[];
}
```

`compare_value` must remove non-semantic fields such as source offsets and generated metadata. It must retain semantic fields such as workflow step order and enum value order.

### 7.4 Rename handling

V1 uses explicit aliases for safe rename detection.

Rules:

```text
- If current entity `aliases` contains a previous entity ID, compare them as the same logical entity.
- Do not emit generic rename diff types in V1. When an alias is explicit and valid, compare the entities as the same logical entity and record `previous_entity_id` on the resulting typed diff or metadata action when needed.
- If shapes are similar but no alias exists, emit remove/add diffs plus a `rename_suspected` diagnostic.
- Suspected renames are ambiguous and require developer action for persistent entities or public API entities.
```

Examples:

```text
model.Post -> model.Article without alias
  = model_removed(model.Post) + model_added(model.Article) + rename_suspected

model.Article aliases: [model.Post]
  = same logical model for comparison; plan may include metadata/path actions if artifact names move
```

### 7.5 Minimal diff rule

The diff engine emits the most specific stable diff possible.

Rules:

```text
- Adding a model emits `model_added`, not one `model_field_added` per field.
- Removing a workflow emits `workflow_removed`, not one `workflow_step_removed` per step.
- Changing a field max length emits `model_field_constraint_changed`, not `model_changed`.
- Reordering workflow steps emits `workflow_step_reordered` for affected steps.
- Changing only comments, whitespace, source line numbers, or declaration order outside semantic order emits no diff.
```

### 7.6 Diff set schema

```ts
interface IRDiffSetV1 {
  schema_version: "arch.diff.v1";
  base_ir_hash?: string;
  next_ir_hash: string;
  diff_hash: string;
  mode: "initial_generation" | "incremental_sync";
  changes: IntentDiffV1[];
  diagnostics: DiffDiagnostic[];
  summary: DiffSummary;
}

interface IntentDiffV1 {
  id: string;
  type: DiffTypeV1;
  entity_id: string;
  entity_kind: string;
  parent_entity_id?: string;
  previous_entity_id?: string;
  source_id?: string;

  change_class: "additive" | "modifying" | "destructive" | "ambiguous";
  risk: "low" | "medium" | "high" | "critical";

  before?: unknown;
  after?: unknown;
  field_path?: string;

  requires_confirmation: boolean;
  confirmation_kinds: ConfirmationKind[];
  affected_entity_hints: string[];
  reason: string;
}
```

Diff IDs must be deterministic:

```text
diff.<type>.<entity-id-normalized>.<short-change-hash>
```

### 7.7 Supported V1 diff types

```ts
type DiffTypeV1 =
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
```

Unsupported semantic differences must not be encoded as generic free-form diffs. They must produce `unsupported_diff` diagnostics and block planning.

`initial_generation` is a sync-mode sentinel for the missing-baseline case, not a semantic entity diff emitted by the canonical IR diff matrix.

### 7.8 Comparator rules by entity kind

#### Target comparator

Compare:

```text
language
runtime
database
orm
cache
auth
test_framework
local_runtime
package_manager
```

Rules:

```text
- `language`, `runtime`, `database`, or `orm` changes are critical in V1.
- `cache` may be `redis` by default or `none`; `redis -> none` is high risk if any workflow step uses cache.
- `auth` changes affect routes, policies, runtime config, and tests.
```

#### Model comparator

Compare:

```text
model existence
model identity and aliases
fields
relations
indexes
```

Rules:

```text
- Field-level changes are emitted as field diffs.
- Relation-level changes are emitted as relation diffs.
- Field-level indexes emit `model_index_*` diffs when they affect generated schema or migrations.
- Named or composite source index declarations are reserved and must have been rejected before canonical IR reaches sync; the sync engine must not make them supported through planning.
- Model removal is destructive.
```

#### Model index comparator

Compare:

```text
fields
unique
index kind
generated name, if present in canonical IR
```

Rules:

```text
- V1 supports indexes produced from field-level `indexed` / `index` declarations.
- Adding or removing a field-level index emits `model_index_added` or `model_index_removed`.
- Changing uniqueness or indexed fields emits `model_index_changed`.
- Named or composite source indexes must not appear as supported V1 changes.
```

#### Field comparator

Compare:

```text
type.kind
type.values for enum
type.model_id for model_ref
constraints.required
constraints.unique
constraints.primary
constraints.indexed
constraints.immutable
constraints.max_length
constraints.min_length
constraints.default
storage metadata when semantically relevant
```

Rules:

```text
- Type changes are separate from constraint changes.
- Enum value addition is usually modifying; enum value removal is destructive.
- Adding a required persistent field without a default is destructive or ambiguous when existing data may exist.
- Lowering `max_length` is high risk because existing data may violate it.
```

#### Relation comparator

Compare:

```text
from_model_id
to_model_id
field_id
inverse_field_id
via_relation_id
cardinality
required
foreign_key.field_name
on_delete
```

Rules:

```text
- Changing `on_delete` to `cascade` is high risk.
- Removing a relation is destructive if generated schema or workflows depend on it.
- Inverse relation fields are represented in canonical IR as `model_ref_list` with non-persisted storage; sync plans must not generate independent persisted columns for those inverse fields.
```

#### Workflow comparator

Compare:

```text
trigger
input_model_id
output_model_id
steps by stable step ID
step order
workflow guarantee IDs
workflow policy IDs
```

Rules:

```text
- Step order is semantic.
- Removing a safety, persistence, policy, or side-effect step is high risk.
- Changing a trigger path or method can be API breaking.
- Because the required V1 diff matrix does not yet define a dedicated trigger-change diff, trigger path/method changes must block as unsupported or be represented by an explicit future diff taxonomy before implementation.
```

#### Step comparator

Compare:

```text
operation.type
operation target/model/field/integration/custom references
operation parameters
reads
writes
uses_integrations
depends_on
failure_behavior
transaction_boundary
order
```

Rules:

```text
- Moving a notification step inside a transaction may violate transactional guarantees.
- Adding an external side-effect step is at least medium risk.
```

#### Integration comparator

Compare:

```text
integration_kind
required
provider
config_schema
failure_policy
```

Rules:

```text
- Removing an integration referenced by workflows blocks planning unless references are removed in the same plan.
- Changing a provider is modifying or ambiguous depending on provider template support.
```

#### Custom extension comparator

Compare:

```text
extension kind
file path
export name
input contract
output contract
ownership intent
workflow call sites
```

Rules:

```text
- `custom` source declarations map to first-class `CustomExtensionIR`.
- Added custom extensions create stubs and ownership metadata only; completed implementations are human-owned.
- Contract, file, export, or call-site changes emit `custom_extension_changed`.
- `custom kind: test_generator` is reserved for post-V1 and must have been rejected before sync.
```

#### Policy comparator

Compare:

```text
policy_kind
scope
rules
enforcement
```

Rules:

```text
- Weaker enforcement is high risk.
- Manual enforcement must be called out in plan and verification handoff.
```

#### Guarantee comparator

Compare:

```text
category
scope
description if semantically meaningful
formal_predicate
verifiability
verification strategy
runtime assertions
thresholds
```

Rules:

```text
- Adding a guarantee adds verification obligations and may require implementation patches.
- Removing or weakening a guarantee is high risk.
- Latency threshold changes are modifying and usually partially verifiable in V1.
- Unknown short-form guarantees must have failed semantic validation before sync; the sync engine must not infer executable behavior from them.
```

#### Test comparator

Compare:

```text
test_kind
framework
path
scope
guarantee_id
assertions
fixtures
generated flag
```

Rules:

```text
- Tests generated from guarantees are not deleted silently.
- Custom tests are not modified by the sync engine.
```

### 7.9 Deterministic diff ordering

Diffs must be sorted by:

```text
1. change_class severity: destructive, ambiguous, modifying, additive
2. risk: critical, high, medium, low
3. entity kind order: target, model, model_field, model_index, relation, integration, custom_extension, workflow, workflow_step, policy, guarantee, test
4. entity ID lexicographically
5. diff type lexicographically
```

This ordering ensures stable plan output.

---

## 8. Risk and Change Classification

### 8.1 Change classes

| Class | Meaning | Default behavior |
|---|---|---|
| `additive` | Adds new supported behavior, schema, tests, or generated artifacts without removing existing behavior. | Allowed if ownership is safe. |
| `modifying` | Changes existing behavior or constraints while preserving identity. | Allowed or warned depending on risk. |
| `destructive` | May remove data, generated behavior, tests, guarantees, or API compatibility. | Blocked without confirmation. |
| `ambiguous` | Cannot be safely interpreted without a rename hint, migration hint, or developer decision. | Blocked. |

### 8.2 Risk levels

| Risk | Meaning | Default behavior |
|---|---|---|
| `low` | Local generated-code change with minimal data/API/behavior risk. | Allowed. |
| `medium` | Bounded behavior, schema, integration, or test change. | Allowed with clear plan. |
| `high` | Data loss, API breakage, ownership risk, or guarantee weakening possible. | Blocked unless explicitly confirmed. |
| `critical` | Target/runtime architecture change or V1 unsupported migration. | Blocked; V1 may reject entirely. |

### 8.3 Base classification rules

| Diff | Default class | Default risk | Notes |
|---|---:|---:|---|
| `model_added` | additive | medium | Creates table, model, validators, tests. |
| `model_removed` | destructive | high | Drops table and generated artifacts. |
| `model_field_added` optional | additive | low | Add nullable/optional field. |
| `model_field_added` required with safe default | additive | medium | Add non-null column with default. |
| `model_field_added` required without default | destructive | high | Existing rows cannot be migrated safely. |
| `model_field_removed` | destructive | high | Drops column and dependent behavior. |
| `model_field_type_changed` compatible widening | modifying | medium | Example string max increase. |
| `model_field_type_changed` incompatible | destructive | high | Data conversion or loss possible. |
| enum value added | modifying | low | Usually safe but may affect validators/tests. |
| enum value removed | destructive | high | Existing data may contain removed value. |
| `relation_added` | additive | medium | Schema and validation impact. |
| `relation_removed` | destructive | high | Drops FK and dependent behavior. |
| `model_index_added` | additive | low/medium | Adds field-level index migration; named/composite source indexes remain unsupported. |
| `model_index_removed` | modifying | medium | Drops index and may affect generated query behavior. |
| `model_index_changed` | modifying | medium | Escalate if uniqueness changes. |
| `workflow_added` | additive | medium | Adds API route and behavior. |
| `workflow_removed` | destructive | high | Removes API behavior and tests. |
| trigger path/method change | modifying | high | Public API compatibility risk; V1 diff taxonomy should model this explicitly before implementation. |
| `workflow_step_added` pure validation/sanitization | additive | medium | May change accepted input. |
| `workflow_step_added` external side effect | additive | medium | Integration behavior introduced. |
| `workflow_step_removed` safety/persistence/guarantee step | destructive | high | May weaken behavior. |
| `workflow_step_reordered` | modifying | medium/high | Escalate if persistence/safety/transaction changes. |
| `workflow_step_changed` | modifying | medium/high | Operation, failure behavior, or transaction boundary changed. |
| `integration_added` unused | additive | low | Stub/config only. |
| `integration_added` used by workflow | additive | medium | Runtime and tests affected. |
| `integration_removed` referenced | destructive | high | Blocks unless references removed. |
| `custom_extension_added` | additive | low/medium | Creates or updates extension-point metadata and stubs only. |
| `custom_extension_removed` referenced | destructive/ambiguous | medium | Blocks if workflows, policies, tests, or existing files still reference it. |
| `custom_extension_changed` | modifying/ambiguous | medium | Contract, file/export path, ownership intent, or call sites changed. |
| `policy_added` | additive | medium | May alter auth/behavior. |
| `policy_removed` | destructive | high | Enforcement may weaken. |
| `policy_changed` weaker enforcement | destructive | high | Requires confirmation. |
| `guarantee_added` | additive | medium | Adds tests/assertions and may require code changes. |
| `guarantee_removed` | destructive | high | Removes contract coverage. |
| `guarantee_changed` stricter threshold | modifying | medium | May require code/test changes. Latency guarantees are partially verifiable in V1. |
| `guarantee_changed` weaker threshold | destructive | high | Contract weakened. |
| `test_added` generated | additive | low | Adds verification. |
| `test_removed` guarantee-derived | destructive | high | Coverage loss. |
| `target_changed` database/orm/runtime/language | destructive | critical | V1 blocks or requires target rewrite confirmation. |
| `target_changed` auth/cache | modifying | medium/high | Depends on workflow use. |

### 8.4 Risk escalation rules

The planner must escalate risk when any of these are true:

```text
- persistent data may be lost
- existing data may violate a new constraint
- public API route method/path changes
- generated tests or guarantee coverage would be removed
- a policy or guarantee is weakened
- an external side effect is introduced or made required
- an integration failure policy changes from best effort to required or vice versa
- a migration requires manual review
- affected generated files have drifted
- affected artifacts include mixed generated regions
- a dependency graph edge reaches a human-owned extension point
- V1 generator support is incomplete for the change
```

### 8.5 Confirmation kinds

```ts
type ConfirmationKind =
  | "confirm_destructive"
  | "confirm_data_loss"
  | "confirm_generated_artifact_deletion"
  | "confirm_api_breaking_change"
  | "confirm_policy_or_guarantee_weakening"
  | "confirm_target_rewrite"
  | "confirm_manual_migration_review"
  | "confirm_drift_resolution";
```

Confirmation rules:

```text
- Destructive changes require at least `confirm_destructive`.
- Data loss requires `confirm_data_loss`.
- Target rewrite requires `confirm_target_rewrite` and may still be unsupported in V1.
- Generated artifact deletion requires `confirm_generated_artifact_deletion` unless it is a non-destructive orphan cleanup explicitly requested by the user.
- Guarantee or policy weakening requires `confirm_policy_or_guarantee_weakening`.
```

---

## 9. Dependency Graph and Affected Artifact Resolution

### 9.1 Graph purpose

The dependency graph maps changed intent to implementation artifacts.

It answers:

```text
Which entities are affected by this typed diff?
Which generated artifacts implement those entities?
Which tests verify those entities or guarantees?
Which files are write targets, read-only context, or conflicts?
```

### 9.2 Graph node kinds

```text
IR entity nodes:
  system, target, model, model_field, model_index, relation, workflow, trigger,
  workflow_step, integration, custom_extension, policy, guarantee, test, verification

Artifact nodes:
  generated file, generated region, migration, runtime config,
  package manifest, test file, metadata file

Ownership nodes:
  generated_file, generated_region, extension_point, human_file
```

### 9.3 Graph edge kinds

```ts
type DependencyEdgeKind =
  | "contains"
  | "references"
  | "reads"
  | "writes"
  | "uses"
  | "verifies"
  | "implements"
  | "owned_by"
  | "scoped_to"
  | "depends_on"
  | "generates";
```

Examples:

```text
model.Post contains model.Post.field.content
workflow.CreatePost contains workflow.CreatePost.step.sanitize_post_content
workflow.CreatePost.step.sanitize_post_content reads model.Post.field.content
workflow.CreatePost.step.insert_post writes model.Post
workflow.CreatePost.step.notify_mentioned_users uses integration.PushProvider
guarantee.no_unsanitized_html_persisted scoped_to model.Post.field.content
test.create_post_no_unsanitized_html_persisted verifies guarantee.no_unsanitized_html_persisted
artifact.src_generated_workflows_createPost_ts implements workflow.CreatePost
artifact.src_generated_workflows_createPost_ts owned_by ownership.src_generated_workflows_createPost_ts
```

### 9.4 Artifact resolution algorithm

For each `IntentDiffV1`:

```text
1. Seed graph traversal with diff.entity_id.
2. Include parent entities through `contains` upward.
3. If the diff adds or removes a parent entity, include contained children.
4. Follow reverse `references`, `reads`, `writes`, and `uses` edges to dependent workflows, policies, guarantees, and tests.
5. Follow `scoped_to` and `verifies` edges for guarantee and test coverage.
6. Follow `implements` edges from affected entities to artifacts.
7. If no artifact map exists for a new entity, apply default generator mapping rules.
8. Include metadata artifacts required to update artifact and ownership maps.
9. Apply ownership classification to each artifact.
10. Emit `ArtifactImpact` records.
```

### 9.5 Artifact impact schema

```ts
interface ArtifactImpact {
  id: string;
  path: string;
  region?: ArtifactRegion;
  artifact_kind: string;
  entity_ids: string[];
  caused_by_diff_ids: string[];
  impact:
    | "create"
    | "update"
    | "replace_generated_file"
    | "patch_generated_region"
    | "delete_generated_artifact"
    | "read_context"
    | "metadata_update"
    | "verify_only";
  ownership_decision: OwnershipDecision;
  risk: "low" | "medium" | "high" | "critical";
  reason: string;
}

interface OwnershipDecision {
  writable: boolean;
  owner: "arch" | "human" | "shared" | "unknown";
  ownership_kind?: string;
  update_policy?: string;
  write_scope?: "whole_file" | "generated_region" | "stub_only" | "none";
  requires_confirmation: boolean;
  conflict?: SyncConflict;
}
```

### 9.6 Default V1 artifact mapping rules

When an entity has no existing artifact map entry, the sync engine uses generator rules.

| IR entity | Default affected artifacts |
|---|---|
| `target.primary` | `package.json`, `docker-compose.yml`, `src/runtime/config.ts`, `src/runtime/db.ts`, `src/runtime/cache.ts` when Redis is enabled. |
| `model.<Name>` | `prisma/schema.prisma`, `src/generated/models/<name>.ts`, `src/generated/validators/<name>.ts`, `tests/generated/<name>.model.test.ts`. |
| `model.<Name>.field.<field>` | `prisma/schema.prisma`, `prisma/migrations/*`, model file, validator file, dependent routes/workflows/tests. |
| `model.<Name>.index.<index>` | `prisma/schema.prisma`, `prisma/migrations/*`; only field-level index IR is supported in V1. |
| `relation.*` | `prisma/schema.prisma`, model and validator files for both sides, relation persistence tests. |
| `workflow.<Name>` | `src/generated/workflows/<name>.ts`, generated route file, workflow tests. |
| `workflow.<Name>.trigger.*` | Generated route file, API contract tests. |
| `workflow.<Name>.step.*` | Workflow implementation file, dependent integration stubs, step-specific guarantee tests. |
| `integration.<Name>` | `src/generated/integrations/<name>.ts`, `src/runtime/config.ts`, `.env.example` when generated, integration mocks/tests. |
| `custom_extension.<Name>` | `src/custom/<name>.ts` stub if missing, extension interface/contract artifacts, ownership metadata, workflow call sites. |
| `policy.<Name>` | `src/generated/policies/<name>.ts`, affected routes/workflows, policy tests. |
| `guarantee.<name>` | Generated guarantee tests, affected workflow/policy files, optional runtime assertions. |
| `test.<name>` | `tests/generated/<name>.test.ts` unless the test is custom. |

### 9.7 Ownership filtering

After artifact resolution, each artifact is assigned one of these write classifications:

| Classification | Meaning | Plan behavior |
|---|---|---|
| `write_allowed` | Arch owns the file or region and update policy allows writing. | May create patch actions. |
| `create_only_allowed` | Extension point or generated artifact may be created if missing. | May create only if file does not exist. |
| `read_context_only` | Human-owned or extension point implementation may be read for context but not changed. | May be included in agent context but not patch output. |
| `requires_confirmation` | Shared or generated region requires explicit confirmation. | Block apply until confirmed. |
| `blocked` | Human-owned write, unknown owner, missing marker, or drift conflict. | Plan is blocked or emits repair-only option. |

### 9.8 Orphaned generated artifacts

When an entity is removed, previously generated artifacts may become orphaned.

```ts
interface OrphanedArtifact {
  artifact_id: string;
  path: string;
  previous_entity_ids: string[];
  reason: "source_entity_removed" | "path_rule_changed" | "generator_no_longer_emits";
  deletion_allowed: boolean;
  requires_confirmation: boolean;
}
```

Rules:

```text
- Fully generated orphaned artifacts may be deleted only by an explicit plan action.
- If an orphaned artifact has drifted from its recorded generated hash, deletion is blocked until the developer resolves drift.
- Human-owned files are never deleted by orphan cleanup.
- Generated tests derived from removed guarantees require guarantee-weakening confirmation before deletion.
```

---

## 10. Sync Plan

### 10.1 Plan purpose

A sync plan is the executable contract between planning and applying.

It must answer:

```text
- what changed in intent
- why each change matters
- which files or regions are affected
- which changes are deterministic
- which changes require an agent
- which files are allowed to be touched
- which files are forbidden
- which metadata will change
- which confirmations are required
- which checks must pass
```

### 10.2 Plan schema

```ts
interface SyncPlanV1 {
  schema_version: "arch.sync_plan.v1";
  plan_id: string;
  compiler_version: string;
  created_at: string;

  mode: "initial_generation" | "incremental_sync" | "repair";

  base_ir_hash?: string;
  next_ir_hash: string;
  diff_hash: string;
  artifact_map_hash?: string;
  ownership_map_hash?: string;

  summary: string;
  risk: "low" | "medium" | "high" | "critical";
  change_class: "additive" | "modifying" | "destructive" | "ambiguous";

  required_confirmations: ConfirmationKind[];
  unsupported: UnsupportedPlanItem[];
  conflicts: SyncConflict[];

  diff_set: IRDiffSetV1;
  affected_entities: AffectedEntity[];
  affected_artifacts: ArtifactImpact[];

  action_groups: PlanActionGroup[];
  agent_tasks: AgentTaskSpec[];
  metadata_updates: PlannedMetadataUpdate[];
  verification: VerificationHandoffV1;
}
```

### 10.3 Plan ID

Plan IDs should be deterministic for the same inputs:

```text
plan.<mode>.<base-hash-short-or-none>.<next-hash-short>.<diff-hash-short>
```

If multiple plans are generated for the same input with different command flags, include the flag hash:

```text
plan.<mode>.<base>.<next>.<diff>.<flags>
```

### 10.4 Affected entity schema

```ts
interface AffectedEntity {
  entity_id: string;
  entity_kind: string;
  caused_by_diff_ids: string[];
  dependency_reason:
    | "changed_directly"
    | "parent_changed"
    | "child_changed"
    | "references_changed_entity"
    | "reads_changed_entity"
    | "writes_changed_entity"
    | "uses_changed_integration"
    | "scoped_guarantee"
    | "verifies_guarantee"
    | "implements_changed_entity";
  risk: "low" | "medium" | "high" | "critical";
}
```

### 10.5 Action groups

Actions are grouped to preserve safe implementation order.

Recommended ordering:

```text
1. metadata preflight and generated directory scaffolding
2. target/runtime/package configuration
3. database schema and migrations
4. generated TypeScript models
5. validators and DTO mapping
6. integrations and runtime stubs
7. policies
8. workflow implementations
9. routes
10. generated tests and guarantee tests
11. formatting and syntax checks
12. metadata update staging
13. verification handoff
```

### 10.6 Plan action schema

```ts
interface PlanActionGroup {
  id: string;
  title: string;
  order: number;
  caused_by_diff_ids: string[];
  actions: PlanAction[];
}

type PlanAction =
  | DeterministicTemplateAction
  | GeneratedRegionPatchAction
  | AgentPatchAction
  | MigrationAction
  | DeleteGeneratedArtifactAction
  | MetadataAction
  | VerificationAction
  | NoOpAction;

interface BasePlanAction {
  id: string;
  action_kind: string;
  order: number;
  entity_ids: string[];
  paths: string[];
  allowed_paths: string[];
  forbidden_paths: string[];
  preconditions: PatchPrecondition[];
  postconditions: PatchPostcondition[];
  risk: "low" | "medium" | "high" | "critical";
  requires_agent: boolean;
  requires_confirmation: boolean;
  confirmation_kinds: ConfirmationKind[];
  acceptance_criteria: string[];
}
```

### 10.7 Deterministic template action

```ts
interface DeterministicTemplateAction extends BasePlanAction {
  action_kind: "deterministic_template";
  template_id: string;
  template_version: string;
  ir_fragment_hashes: string[];
  output_kind: "create_file" | "overwrite_generated_file" | "update_json";
}
```

Use deterministic templates whenever possible for:

```text
- generated models
- validators
- Prisma schema sections
- integration interfaces and stubs
- route scaffolds
- runtime config
- Docker Compose
- generated test scaffolds
```

### 10.8 Generated region patch action

```ts
interface GeneratedRegionPatchAction extends BasePlanAction {
  action_kind: "generated_region_patch";
  path: string;
  region_id: string;
  expected_region_hash: string;
  replacement_strategy: "replace_region_contents" | "structured_region_patch";
}
```

Generated regions should be rare in V1. Prefer fully generated files plus human-owned extension points.

### 10.9 Agent patch action

```ts
interface AgentPatchAction extends BasePlanAction {
  action_kind: "agent_patch";
  agent_task_id: string;
  agent_role:
    | "schema_agent"
    | "api_agent"
    | "workflow_agent"
    | "integration_agent"
    | "test_agent"
    | "repair_agent";
}
```

Agent actions are allowed only after deterministic planning has established:

```text
- typed diffs
- affected entities
- allowed files
- forbidden files
- current file context
- acceptance criteria
- expected tests
```

### 10.10 Migration action

```ts
interface MigrationAction extends BasePlanAction {
  action_kind: "migration";
  migration_kind:
    | "create_table"
    | "drop_table"
    | "add_column"
    | "drop_column"
    | "alter_column"
    | "add_enum"
    | "alter_enum"
    | "add_index"
    | "drop_index"
    | "relation_fk_change";
  destructive: boolean;
  migration_review_required: boolean;
  prisma_migration_name?: string;
}
```

V1 may generate migration scaffolds. It must not silently execute destructive database migrations.

### 10.11 Delete generated artifact action

```ts
interface DeleteGeneratedArtifactAction extends BasePlanAction {
  action_kind: "delete_generated_artifact";
  path: string;
  expected_content_hash: string;
  orphaned_artifact_id: string;
}
```

Deletion is allowed only when:

```text
- the file is fully generated;
- the current content hash matches ownership metadata;
- the owning entity was removed or path rule changed;
- required destructive confirmations are present;
- the deletion is represented in the plan.
```

### 10.12 No-op action

A no-op action records a diff that requires no implementation write.

```ts
interface NoOpAction extends BasePlanAction {
  action_kind: "no_op";
  no_op_reason:
    | "metadata_only"
    | "manual_verification_only"
    | "already_satisfied"
    | "read_only_context"
    | "unsupported_blocked";
}
```

No-op actions are useful for manual guarantees, `partially_covered` latency verification, or unsupported diffs that block apply.

### 10.13 Plan validation rules

Before a plan can be written:

```text
- Every diff must map to at least one plan action or explicit blocked/no-op reason.
- Every write action must have an allowed path or generated region.
- No write action may include a human-owned file.
- Every generated artifact deletion must have an expected content hash.
- Every agent action must reference a valid agent task spec.
- Every destructive action must list required confirmations.
- Every affected artifact must have an ownership decision.
- Every write action must be compatible with the ownership entry `write_scope`.
- The verification handoff must include all required IR verification commands.
- The plan must be deterministic under the same inputs.
```

If validation fails, the sync engine must emit `plan_invalid` and write no implementation files.

---

## 11. Agent Task Contract

### 11.1 Agent task purpose

Agent tasks are bounded implementation subtasks. They adapt generated code when deterministic templates are insufficient.

Agents receive structured tasks, not free-form product requirements.

Agents must not parse `.arch`, decide diffs, create sync plans from scratch, bypass ownership, modify human-owned files, weaken guarantees, or mark verification passed. They receive typed bounded patch tasks only; deterministic patch validation and verifier results decide acceptance.

### 11.2 Agent task schema

```ts
interface AgentTaskSpec {
  schema_version: "arch.agent_task.v1";
  task_id: string;
  role:
    | "schema_agent"
    | "api_agent"
    | "workflow_agent"
    | "integration_agent"
    | "test_agent"
    | "repair_agent";

  plan_id: string;
  diff_ids: string[];
  entity_ids: string[];

  objective: string;
  ir_fragments: Record<string, unknown>;
  current_files: AgentFileContext[];

  allowed_paths: string[];
  forbidden_paths: string[];
  read_only_paths: string[];

  ownership_rules: OwnershipEntry[];
  implementation_constraints: string[];
  acceptance_criteria: string[];
  expected_tests: string[];

  output_schema: "arch.patch.v1";
}

interface AgentFileContext {
  path: string;
  content: string;
  content_hash: string;
  role: "editable" | "read_only_context";
}
```

### 11.3 Agent output schema

Agents must return patch operations, not prose.

```ts
interface AgentPatchProposal {
  schema_version: "arch.patch.v1";
  task_id: string;
  operations: PatchOperation[];
  rationale: PatchRationale[];
}
```

The sync engine may record rationale, but rationale does not authorize any patch.

### 11.4 Agent output rejection rules

Reject an agent proposal if:

```text
- it is not valid `arch.patch.v1`
- it touches a forbidden path
- it touches a path outside `allowed_paths`
- it modifies a human-owned file
- it removes or weakens a generated test without a planned diff
- it changes `.arch/` metadata directly
- it changes `backend.arch`
- it adds dependencies not declared by the plan
- it edits unrelated code
- it deletes guarantee enforcement
- it cannot apply cleanly to expected content hashes
- it fails syntax/type validation for touched files
```

### 11.5 Agent task examples

Example workflow task objective:

```text
Apply `workflow_step_added(workflow.CreatePost.step.notify_mentioned_users)`.
Patch only `src/generated/workflows/createPost.ts`.
Use `integration.PushProvider`.
Run notification after post persistence and outside the Prisma transaction.
Preserve `guarantee.notification_failure_does_not_rollback_post`.
```

Example test task objective:

```text
Generate an integration test for `guarantee.notification_failure_does_not_rollback_post`.
Patch only `tests/generated/createPost.notificationFailure.test.ts`.
Mock `PushProvider` failure and assert the Post record still exists.
```

---

## 12. Patch Application

### 12.1 Patch set schema

```ts
interface PatchSetV1 {
  schema_version: "arch.patch.v1";
  patch_id: string;
  plan_id: string;
  base_ir_hash?: string;
  next_ir_hash: string;
  operations: PatchOperation[];
  touched_paths: string[];
  expected_before_hashes: Record<string, string>;
  resulting_hashes?: Record<string, string>;
}
```

### 12.2 Patch operation schema

```ts
type PatchOperation =
  | CreateFileOperation
  | OverwriteGeneratedFileOperation
  | ReplaceGeneratedRegionOperation
  | ApplyUnifiedDiffOperation
  | DeleteGeneratedFileOperation
  | UpdateJsonOperation
  | CreateDirectoryOperation;

interface PatchOperationBase {
  op_id: string;
  op:
    | "create_file"
    | "overwrite_generated_file"
    | "replace_generated_region"
    | "apply_unified_diff"
    | "delete_generated_file"
    | "update_json"
    | "create_directory";
  path: string;
  entity_ids: string[];
  caused_by_action_id: string;
  preconditions: PatchPrecondition[];
}
```

### 12.3 Preconditions

```ts
type PatchPrecondition =
  | { kind: "path_absent"; path: string }
  | { kind: "path_exists"; path: string }
  | { kind: "content_hash_equals"; path: string; hash: string }
  | { kind: "ownership_allows_write"; ownership_id: string }
  | { kind: "region_exists"; path: string; region_id: string }
  | { kind: "region_hash_equals"; path: string; region_id: string; hash: string }
  | { kind: "confirmation_present"; confirmation: ConfirmationKind }
  | { kind: "not_symlink"; path: string }
  | { kind: "within_repo"; path: string };
```

All preconditions must pass immediately before writing.

### 12.4 Apply preflight

Before any implementation write, apply must:

```text
1. Acquire `.arch/locks/apply.lock`.
2. Require the CLI/compiler pipeline to provide a freshly compiled, schema-valid current canonical IR.
3. Verify provided current IR hash equals `plan.next_ir_hash`.
4. Verify `.arch/ir.previous.json` hash equals `plan.base_ir_hash`, except initial generation.
5. Verify artifact-map and ownership-map hashes match the plan.
6. Verify affected generated files and regions have not drifted.
7. Verify no write target is human-owned.
8. Verify required confirmations are present.
9. Verify no path escapes the repository.
10. Verify the working tree policy is satisfied for affected paths.
```

If any preflight check fails, apply stops before writing.

### 12.5 Write ordering

Patch operations must be applied in this order:

```text
1. create missing directories
2. create new generated files
3. update existing generated files
4. patch generated regions
5. create migration scaffolds
6. create extension point stubs if missing
7. delete generated artifacts, if confirmed
8. update generated tests
9. stage metadata files under `.arch/tmp/`
```

Metadata promotion occurs after verification, not during this write sequence.

### 12.6 Fully generated file updates

For fully generated files, Arch may replace the whole file when:

```text
- ownership kind is `generated_file`
- update policy is `overwrite_allowed` or `patch_allowed`
- content hash matches the expected precondition or the file is newly created
- path is allowlisted by the plan
```

Generated files should include headers, but enforcement depends on `ownership.json` and hashes.

### 12.7 Generated region updates

For generated regions, Arch may replace only the region body.

Rules:

```text
- Start and end markers must exist.
- Region ID must match ownership metadata.
- Region content hash must match expected hash unless drift resolution is explicitly confirmed.
- Patch must not modify content outside the region markers.
```

### 12.8 Extension point handling

Extension points are create-only by default.

Rules:

```text
- If an extension point file is missing, Arch may create a stub.
- If the file exists and matches the generated stub hash, Arch may update the stub only when the plan says so.
- If the file exists and hash differs from the stub, it is human-owned read-only context.
- Agent tasks may read extension point contracts but may not modify implementations.
```

### 12.9 Formatting and local validation

After patch operations but before verifier handoff, the sync engine should run narrow local validators when available:

```text
- JSON parse for metadata files
- TypeScript parser or formatter for touched `.ts` files
- Prisma schema formatting/validation preflight when `schema.prisma` changed
- generated region marker validation
- patch schema validation
```

Full correctness is determined by the verifier.

### 12.10 Failure during apply

If a write fails:

```text
- stop applying further operations
- write run report and conflict report
- do not promote metadata
- leave working tree as-is unless `--rollback-on-failure` is enabled and backups are complete
```

If rollback is requested, rollback is limited to file writes recorded in the patch set. The sync engine must not claim rollback of external side effects or database state.

---

## 13. Metadata Updates

### 13.1 Metadata update set schema

```ts
interface MetadataUpdateSetV1 {
  schema_version: "arch.metadata_update.v1";
  plan_id: string;
  run_id: string;
  base_ir_hash?: string;
  next_ir_hash: string;
  artifact_map_update: ArtifactMapUpdate;
  ownership_update: OwnershipUpdate;
  source_map_update?: SourceMapUpdate;
  snapshot_update: SnapshotUpdate;
}
```

### 13.2 Artifact map updates

Artifact map updates include:

```text
- add entries for new generated artifacts
- update entity mappings for changed artifacts
- update artifact generation metadata
- update `generated_from_hash`
- update source IDs
- remove entries for deleted generated artifacts
- mark orphaned artifacts when not deleted
```

Rules:

```text
- Artifact IDs are stable across content changes.
- Artifact IDs may change only when path identity changes and an alias is recorded.
- New artifacts must have ownership entries.
- New or changed artifacts must preserve `ArtifactIR.generation` metadata.
- Every generated test must map to at least one model, workflow, policy, guarantee, or declared test entity.
```

### 13.3 Ownership updates

Ownership updates include:

```text
- add ownership entries for new generated files
- add ownership entries for extension point stubs
- update content hashes for generated files and regions
- update region hashes
- preserve or update `write_scope`
- preserve human-owned entries unchanged
- convert edited extension stubs to read-only human-owned entries during check or explicit accept flows
```

Rules:

```text
- Ownership hashes are updated only after verification succeeds.
- A generated file with unexpected pre-apply hash is drift, not a new baseline.
- `write_scope` must never be widened during repair or metadata promotion unless an explicit ownership migration was planned and verified.
- Human-owned content hashes may be recorded for drift diagnostics but must not authorize writing.
```

### 13.4 Source map updates

The source map is provided by the compiler pipeline with the current canonical IR. Sync engine promotion should keep source-map entries consistent with the promoted IR hash.

Rules:

```text
- Source-map updates are promoted with successful apply.
- Source-map writes alone do not imply implementation sync success.
- Generated artifacts should preserve traceability to source IDs where possible.
```

### 13.5 Snapshot promotion

On successful verification:

```text
1. Write final artifact-map draft to `.arch/tmp/artifact-map.json`.
2. Write final ownership draft to `.arch/tmp/ownership.json`.
3. Write final source-map draft to `.arch/tmp/source-map.json`.
4. Verify all metadata schemas.
5. Verify all recorded file hashes match current working tree.
6. Copy current canonical IR to `.arch/tmp/ir.previous.json`.
7. Atomically replace stable metadata files.
8. Record promotion in run report.
```

After promotion:

```text
.arch/ir.previous.json == verified current IR
.arch/artifact-map.json.ir_hash == verified current IR hash
.arch/ownership.json contains hashes for generated artifacts as verified
```

### 13.6 Failed verification metadata rule

If verification fails:

```text
- do not update `ir.previous.json`
- do not update stable `artifact-map.json`
- do not update stable `ownership.json`
- preserve draft metadata under `.arch/runs/<run-id>/`
- preserve verification report
- make repair plan eligible only for allowlisted generated files
```

---

## 14. Conflict Handling

### 14.1 Conflict schema

```ts
interface SyncConflict {
  id: string;
  type: SyncConflictType;
  severity: "warning" | "blocking";
  entity_ids: string[];
  paths: string[];
  message: string;
  details?: Record<string, unknown>;
  resolution_options: ConflictResolutionOption[];
}

type SyncConflictType =
  | "snapshot_missing"
  | "snapshot_hash_mismatch"
  | "schema_version_mismatch"
  | "metadata_corrupt"
  | "plan_stale"
  | "unsupported_diff"
  | "ambiguous_rename"
  | "missing_artifact_mapping"
  | "artifact_missing"
  | "ownership_unknown"
  | "ownership_conflict"
  | "human_owned_file_targeted"
  | "generated_file_drift"
  | "generated_region_drift"
  | "generated_region_marker_missing"
  | "extension_point_already_implemented"
  | "path_collision"
  | "path_escapes_repo"
  | "symlink_target_unsafe"
  | "destructive_requires_confirmation"
  | "migration_conflict"
  | "git_dirty_conflict"
  | "agent_patch_invalid"
  | "patch_precondition_failed"
  | "verification_failed";
```

### 14.2 Blocking conflicts

These conflicts always block apply:

```text
- plan_stale
- snapshot_hash_mismatch
- metadata_corrupt
- unsupported_diff
- ambiguous_rename for persistent/API entities
- human_owned_file_targeted
- generated_file_drift in affected write target
- generated_region_marker_missing
- path_escapes_repo
- symlink_target_unsafe
- destructive_requires_confirmation
- migration_conflict without review confirmation
- patch_precondition_failed
```

### 14.3 Conflict resolution options

```ts
type ConflictResolutionOption =
  | "rerun_plan"
  | "restore_metadata_from_git"
  | "restore_generated_file"
  | "accept_generated_drift_as_new_baseline"
  | "move_custom_code_to_extension_point"
  | "add_rename_alias"
  | "declare_missing_integration"
  | "confirm_destructive_change"
  | "review_manual_migration"
  | "mark_file_human_owned"
  | "skip_unsupported_feature"
  | "manual_fix_then_rerun";
```

V1 may not implement every resolution command. If an option is manual, the plan must say so explicitly.

### 14.4 Plan-time versus apply-time conflicts

Plan-time conflicts are reported before writing:

```text
- unsupported diff
- destructive change without confirmation
- ambiguous rename
- missing integration
- missing generator rule
- affected artifact is human-owned
```

Apply-time conflicts are detected during preflight or patch validation:

```text
- plan stale
- generated file drift since planning
- ownership metadata changed
- content hash mismatch
- region marker missing
- Git dirty conflict
- patch cannot apply cleanly
```

Apply-time blocking conflicts must not be automatically converted into repair tasks unless the repair task is explicitly bounded and does not require changing plan semantics.

---

## 15. Destructive Change Handling

### 15.1 Destructive changes

The sync engine treats these as destructive or potentially destructive:

```text
- model removed
- persistent field removed
- required field removed
- field type changed incompatibly
- enum value removed
- relation removed
- relation delete behavior changed to cascade
- workflow removed
- API trigger method/path removed or changed
- workflow step removed when it writes data, enforces safety, or supports a guarantee
- required integration removed or made optional in a way that weakens guarantees
- policy removed or enforcement weakened
- guarantee removed or predicate weakened
- generated test removed when tied to a guarantee
- database, ORM, runtime, or language target changed
- generated artifact deletion
```

### 15.2 Destructive plan requirements

A destructive plan must include:

```text
- destructive diff IDs
- affected entities
- affected generated artifacts
- possible data loss
- possible API breakage
- generated tests or guarantees losing coverage
- migration actions
- required confirmations
- rollback limitations
```

### 15.3 Migration safety categories

| Migration category | Examples | V1 behavior |
|---|---|---|
| Safe additive | create table, add optional column, add column with default, add index | Generate or update migration scaffold. |
| Review required | add required column with default to existing table, relation FK change, enum value addition in strict DB modes | Generate scaffold and require review flag depending on risk. |
| Destructive | drop table, drop column, remove enum value, incompatible type change | Block without destructive confirmation and manual migration review. |
| Unsupported target rewrite | database/ORM/runtime/language change | Block in V1 or require explicit target rewrite flow outside normal sync. |

### 15.4 Deletion protocol

Generated artifact deletion is allowed only when:

```text
- deletion is planned;
- artifact is fully generated;
- artifact content hash matches ownership metadata;
- artifact does not contain human-owned edits;
- required deletion/destructive confirmations are present;
- deletion does not remove custom tests or extension point implementations.
```

If the artifact has drifted, deletion is blocked. The developer must restore, accept, or manually remove it.

### 15.5 Guarantee removal and test retirement

Removing a guarantee weakens the declared contract.

Rules:

```text
- The plan must classify guarantee removal as destructive/high risk.
- Generated tests tied only to the removed guarantee may be retired only with confirmation.
- Tests shared with other guarantees must remain.
- Runtime assertions tied only to the removed guarantee may be removed only with confirmation.
- Human-owned custom tests must not be removed.
```

### 15.6 Ambiguous rename handling

A rename without an explicit alias is remove/add.

For persistent or API entities, remove/add may imply data loss or API breakage. The plan must block with an `ambiguous_rename` diagnostic when similarity is high enough to suggest a rename.

Example:

```text
Previous: model.Post.field.content
Current:  model.Post.field.body

Diagnostic:
- rename suspected: content -> body
- default interpretation would drop `content` and add `body`
- add alias or migration hint to preserve data
```

V1 alias or migration hint support may live in source language or metadata. Without it, apply is blocked for high-risk suspected renames.

---

## 16. Verification Handoff

### 16.1 Handoff purpose

The sync engine does not decide whether the backend is correct. It creates a verification handoff that tells the verifier exactly what must be checked.

### 16.2 Handoff schema

```ts
interface VerificationHandoffV1 {
  schema_version: "arch.verification_handoff.v1";
  handoff_id: string;
  plan_id: string;
  run_id?: string;

  base_ir_hash?: string;
  next_ir_hash: string;

  changed_files: string[];
  changed_generated_regions: { path: string; region_id: string }[];
  changed_entity_ids: string[];
  changed_guarantee_ids: string[];
  generated_test_paths: string[];

  commands: VerificationCommand[];
  drift_checks: DriftCheckRequest[];
  guarantee_coverage_expectations: GuaranteeCoverageExpectation[];

  repair: {
    allowed: boolean;
    max_attempts: number;
    allowed_paths: string[];
    forbidden_paths: string[];
    related_plan_action_ids: string[];
  };
}

interface VerificationCommand {
  name: string;
  command: string;
  required: boolean;
  reason: string;
  related_entity_ids: string[];
}
```

### 16.3 Required V1 verification commands

The sync engine should include commands from `current_ir.verification.commands`, typically:

```bash
pnpm typecheck
pnpm test
pnpm lint
```

When relevant, the handoff should also request:

```text
- Prisma schema validation when `prisma/schema.prisma` changed
- migration validation when migrations changed
- targeted Vitest runs for newly generated tests
- full required test command before final success
- ownership and generated artifact hash checks
- drift checks for generated regions
```

### 16.4 Guarantee coverage expectations

```ts
interface GuaranteeCoverageExpectation {
  guarantee_id: string;
  status: "covered" | "partially_covered" | "manual" | "missing";
  expected_test_ids: string[];
  expected_test_paths: string[];
  runtime_assertion_ids: string[];
  limitations: string[];
}
```

Rules:

```text
- Every guarantee in current IR must have a coverage expectation.
- Testable guarantees must have generated or declared tests.
- Partially covered guarantees must include limitations.
- Latency guarantees are partially verifiable in V1 and usually use `partially_covered`.
- Manual guarantees must be reported; they do not silently pass.
- `unsupported` is diagnostics-only; normal V1 apply must block before verification if unsupported coverage would be required.
```

### 16.5 Verifier result handling

The verifier returns a verification report. The sync engine uses it only for metadata promotion decisions and repair planning.

If verification passes:

```text
- promote IR and metadata
- write final run report
- print reviewable diff summary
```

If verification fails:

```text
- do not promote IR or metadata
- preserve working tree changes unless rollback requested
- write failure report
- create repair plan only if failures are within allowed generated files and repair is enabled
```

### 16.6 Repair constraints

A repair plan may touch only:

```text
- files changed by the failed plan
- generated files directly related to the failing verifier stage
- generated tests directly related to the failing guarantee/test failure
```

Repair must not:

```text
- modify human-owned files
- delete failing tests to pass
- weaken guarantees or policies
- add unsupported dependencies
- perform destructive migration changes
- broaden the original plan intent
```

---

## 17. Drift Detection

### 17.1 Drift purpose

Drift detection checks whether implementation artifacts still match the last verified IR and metadata.

Drift is not the same as an intent diff. Intent diff compares previous IR to current IR. Drift compares verified generated artifacts to the current codebase state.

### 17.2 Drift categories

```ts
type DriftType =
  | "generated_file_modified"
  | "generated_region_modified"
  | "generated_region_marker_missing"
  | "artifact_missing"
  | "artifact_unmapped"
  | "artifact_no_longer_matches_ir_hash"
  | "ownership_metadata_mismatch"
  | "artifact_map_mismatch"
  | "source_map_mismatch"
  | "guarantee_test_missing"
  | "obvious_guarantee_violation"
  | "extension_point_overwritten"
  | "human_owned_file_misclassified";
```

### 17.3 Drift report schema

```ts
interface DriftReportV1 {
  schema_version: "arch.drift_report.v1";
  ir_hash: string;
  status: "no_drift" | "drift_detected";
  findings: DriftFinding[];
}

interface DriftFinding {
  id: string;
  type: DriftType;
  severity: "info" | "warning" | "blocking";
  entity_ids: string[];
  paths: string[];
  expected_hash?: string;
  actual_hash?: string;
  message: string;
  suggested_resolution: ConflictResolutionOption[];
}
```

### 17.4 Generated file drift

If a generated file content hash differs from `ownership.json`, report:

```text
Drift: generated_file_modified
File: src/generated/workflows/createPost.ts
Entity: workflow.CreatePost
Resolution: restore generated file, accept baseline explicitly, or repair from spec
```

V1 must not automatically accept generated file drift.

### 17.5 Generated region drift

If a generated region hash differs or markers are missing, report drift.

Rules:

```text
- Marker removal is blocking drift.
- Region content modification is blocking for apply if the region would be patched.
- Human-owned content outside the region is ignored by generated region hash checks.
```

### 17.6 Missing artifact drift

If `artifact-map.json` references a missing file:

```text
Drift: artifact_missing
Path: tests/generated/createPost.htmlSafety.test.ts
Entity: test.create_post_no_unsanitized_html_persisted
```

Repair may regenerate the file if it is fully generated and the owning entity still exists.

### 17.7 Guarantee test drift

If a testable guarantee lacks a mapped generated or declared test:

```text
Drift: guarantee_test_missing
Guarantee: guarantee.no_unsanitized_html_persisted
Expected: at least one generated integration/static test
```

### 17.8 V1 static guarantee drift checks

V1 supports a small set of static drift detectors.

Recommended V1 detectors:

```text
- notification failure does not rollback post creation:
  flag notification awaited inside Prisma transaction when guarantee requires non-rollback

- moderation precedes persistence:
  flag insert before moderation step in generated workflow implementation

- no unsanitized HTML persisted:
  flag insert using raw content without sanitizer call when guarantee is scoped to field

- auth required:
  flag generated route missing auth guard when policy/trigger requires auth
```

Static guarantee drift checks are conservative. They may report obvious violations; they must not claim full formal verification.

---

## 18. Initial Generation

### 18.1 Baseline absence

When `previous_ir` is missing, the sync engine enters `initial_generation` mode.

Rules:

```text
- Treat every current IR intent entity as added.
- Use generator default artifact mappings.
- Require no previous artifact map unless existing project files cause path conflicts.
- Existing files at generated target paths are conflicts unless empty, generated by Arch, or explicitly confirmed.
```

### 18.2 Initial generation plan

The plan should include:

```text
- target stack
- generated project structure
- Prisma schema and initial migration scaffold
- generated models and validators
- field-level model indexes from canonical `IndexIR`
- routes and workflows
- integration stubs
- custom extension stubs and contracts
- generated tests and guarantee coverage
- Docker Compose and runtime config
- ownership classifications
- verification commands
```

### 18.3 Initial generation conflicts

Initial generation blocks on:

```text
- target path already exists and is not known generated
- human-owned file would be overwritten
- unsupported target value
- unsupported workflow step
- unsupported guarantee outside diagnostics-only handling, or missing coverage for a testable guarantee
- missing integration referenced by workflow
```

### 18.4 Initial generation promotion

After verification succeeds:

```text
- current IR becomes previous IR
- artifact map records every generated file
- ownership map records generated files and extension stubs
- generated content hashes are stored
```

---

## 19. Incremental Sync

### 19.1 Incremental sync flow

```text
1. Load verified baseline IR.
2. Load current IR compiled from edited spec.
3. Compute typed diff.
4. Classify risk and confirmations.
5. Resolve affected entities and artifacts.
6. Validate ownership and drift state.
7. Generate patch plan.
8. Apply plan with preflight hash checks.
9. Stage metadata updates.
10. Hand off to verifier.
11. Promote metadata only after success.
```

### 19.2 Small change behavior

A small intent change should produce a small patch because:

```text
- canonical IDs identify the changed entity
- diff type captures semantic meaning
- dependency graph finds only dependent entities
- artifact map maps entities to files
- ownership map limits writable files
- agent tasks are allowlisted
```

### 19.3 Example: add `Post.visibility`

Spec change:

```arch
model Post {
  id: uuid primary
  content: string max 5000
  visibility: enum["public", "private", "followers"] default "public"
}
```

Diff:

```json
{
  "type": "model_field_added",
  "entity_id": "model.Post.field.visibility",
  "parent_entity_id": "model.Post",
  "change_class": "additive",
  "risk": "medium",
  "requires_confirmation": false
}
```

Affected artifacts:

```text
prisma/schema.prisma
prisma/migrations/*
src/generated/models/post.ts
src/generated/validators/post.ts
src/generated/routes/posts.ts, if route input/output uses Post
src/generated/workflows/createPost.ts, if workflow input/output uses Post
tests/generated/post.model.test.ts
tests/generated/createPost*.test.ts, if behavior depends on visibility
.arch/artifact-map.json
.arch/ownership.json
```

Planned actions:

```text
- Add Prisma enum or compatible field mapping.
- Add safe migration with default `public`.
- Update generated Post type.
- Update generated validator.
- Update workflow input mapping if CreatePost inserts Post.
- Generate visibility tests.
- Run Prisma validation, typecheck, and tests.
```

### 19.4 Example: add notification guarantee

Diff:

```json
{
  "type": "guarantee_added",
  "entity_id": "guarantee.notification_failure_does_not_rollback_post",
  "change_class": "additive",
  "risk": "medium"
}
```

Affected artifacts:

```text
src/generated/workflows/createPost.ts
tests/generated/createPost.notificationFailure.test.ts
```

Planned actions:

```text
- Ensure notification step is outside the persistence transaction.
- Generate integration test that forces notification failure.
- Assert post still persists.
- Add static drift check expectation.
```

### 19.5 Example: remove `Post.content`

Diff:

```json
{
  "type": "model_field_removed",
  "entity_id": "model.Post.field.content",
  "change_class": "destructive",
  "risk": "high",
  "requires_confirmation": true,
  "confirmation_kinds": ["confirm_destructive", "confirm_data_loss"]
}
```

Plan behavior:

```text
- Block by default.
- Show affected schema, validators, workflows, guarantees, and tests.
- Show that HTML safety guarantee and sanitize step may become invalid.
- Require destructive confirmation and migration review.
```

---

## 20. Current Codebase State Handling

### 20.1 Working tree policy

The CLI may support these policies:

```ts
type DirtyWorktreePolicy =
  | "allow_unrelated_dirty_files"
  | "block_any_dirty_worktree"
  | "block_dirty_affected_files";
```

V1 default should be:

```text
block_dirty_affected_files
```

Meaning:

```text
Unrelated modified files do not block apply, but affected write targets with uncommitted human edits or unexpected hashes do block.
```

### 20.2 Path safety

Before reading or writing:

```text
- Normalize path to repository-relative POSIX form.
- Reject absolute paths.
- Reject paths resolving outside repository.
- Reject unsafe symlink targets.
- Reject writes under `.git/`, `node_modules/`, dependency cache directories, or ignored external directories.
```

### 20.3 File hash model

Hashes must be computed over normalized file bytes.

Rules:

```text
- Generated file content hash covers entire file.
- Generated region hash covers only marker body, excluding marker lines unless ownership metadata says otherwise.
- Canonical IR hash is separate from file content hash.
- Artifact `generated_from_hash` is the hash of the IR fragment or generation input, not the generated file content hash.
```

### 20.4 Path collisions

A path collision occurs when a generated artifact would be written where an existing non-generated file exists.

Behavior:

```text
- Block by default.
- If the file is an unedited Arch stub, update according to ownership policy.
- If the file is human-owned, require developer relocation or explicit extension-point mapping.
```

---

## 21. Patch Planning Rules by Diff Type

### 21.1 Model added

Required actions:

```text
- create Prisma model
- create migration scaffold
- create generated TypeScript model
- create validator
- create model tests
- update artifact and ownership maps
```

Potential dependent actions:

```text
- update workflows that reference the model
- update route scaffolds if workflow input/output uses model
```

### 21.2 Model removed

Required actions:

```text
- destructive confirmation
- migration review
- delete or retire generated model artifacts
- remove dependent validators, routes, workflows, and tests only if their source entities are also removed or updated
- detect dangling references before apply
```

### 21.3 Field added

Required actions:

```text
- update Prisma schema
- create migration scaffold
- update model type
- update validator
- update affected workflow input/output mapping
- update tests
```

Special cases:

```text
- optional field: low/medium risk
- required field with default: medium risk
- required field without default: high/destructive
- enum field: update enum mapping and default validation
```

### 21.4 Field removed

Required actions:

```text
- destructive confirmation
- migration review
- remove field from generated schema/model/validator
- update workflows using the field
- update or retire guarantee tests that reference the field
```

Block if:

```text
- affected workflow or guarantee still references field
- generated file drift prevents safe deletion
- migration strategy is missing
```

### 21.5 Model index added, removed, or changed

Required actions:

```text
- update Prisma schema for field-level index IR
- create or update migration scaffold
- update query-related tests if generated behavior depends on the index
- block if the change implies named or composite source indexes unsupported in V1
```

Uniqueness changes require manual migration review and may require destructive confirmation.

### 21.6 Workflow step added

Required actions:

```text
- update workflow implementation
- update affected integrations or stubs
- update tests for the new behavior
- update guarantee coverage if applicable
```

If the step has external side effects, plan must specify failure behavior and transaction boundary.

### 21.7 Workflow step removed

Required actions:

```text
- classify risk based on step operation
- ensure no guarantee or policy depends on the step
- update workflow implementation
- update generated tests
```

Removing validation, sanitization, moderation, persistence, auth, or guarantee-supporting steps is high risk.

### 21.8 Guarantee added

Required actions:

```text
- classify guarantee category and verifiability
- generate or update tests
- add runtime assertion if applicable
- patch implementation if current generated behavior violates guarantee
- update verification coverage
```

If V1 cannot fully verify the guarantee, the plan must report `partially_covered` or `manual`. If the guarantee is unsupported, `unsupported` may appear only in diagnostics and normal apply must block.

### 21.9 Guarantee removed

Required actions:

```text
- classify as destructive/high risk
- require weakening confirmation
- retire generated tests only if exclusively tied to removed guarantee
- remove runtime assertions only if exclusively tied to removed guarantee
```

### 21.10 Integration added

Required actions:

```text
- generate typed integration interface/stub
- update runtime config if provider/config requires it
- generate mocks/tests if used by workflows
```

### 21.11 Integration removed

Required actions:

```text
- verify no workflow, policy, or guarantee references it
- if referenced, block unless references are removed in the same plan
- delete generated integration artifacts only with confirmation when destructive
```

### 21.12 Custom extension added, removed, or changed

Required actions:

```text
- create `src/custom/**` stub only if missing
- update generated extension contract/interface artifacts
- update workflow call sites that invoke the extension
- update ownership metadata with `write_scope: stub_only` for stubs and `none` after human implementation
- treat existing custom implementation files as read-only context unless explicit developer confirmation is supplied
```

Block if:

```text
- the extension path collides with a generated artifact
- the extension is removed while workflows, policies, guarantees, or tests still reference it
- `custom kind: test_generator` appears; this is reserved and must be rejected in V1
```

### 21.13 Target changed

Rules:

```text
- database, ORM, runtime, or language changes are critical and normally unsupported in V1 sync.
- cache changes require checking workflow cache steps.
- auth changes affect routes, policies, runtime config, and tests.
```

Target rewrite is outside normal incremental sync unless an explicit future target migration flow is implemented.

---

## 22. Verification and Repair Integration

### 22.1 Verification stages

The sync engine should request these stages when relevant:

| Stage | Trigger |
|---|---|
| metadata validation | every apply |
| ownership validation | every apply/check |
| Prisma schema validation | schema or migration changed |
| migration validation | migration changed |
| TypeScript typecheck | any TypeScript changed |
| lint | lint configured and source changed |
| generated unit tests | generated models/validators/policies changed |
| generated integration tests | workflows/routes/integrations/guarantees changed |
| generated guarantee tests | guarantees changed or scoped implementation changed |
| drift checks | every check and final apply verification |

### 22.2 Repair handoff

When verification fails, the sync engine may create:

```ts
interface RepairPlanSeed {
  failed_verification_report_id: string;
  original_plan_id: string;
  failure_class:
    | "syntax_error"
    | "type_error"
    | "prisma_schema_error"
    | "migration_error"
    | "lint_error"
    | "unit_test_failure"
    | "integration_test_failure"
    | "guarantee_test_failure"
    | "ownership_violation"
    | "drift_violation"
    | "missing_dependency"
    | "unsupported_behavior";
  related_entity_ids: string[];
  related_files: string[];
  allowed_paths: string[];
  forbidden_paths: string[];
  acceptance_criteria: string[];
}
```

Repair remains subject to the same patch validation and ownership rules.

### 22.3 Full verification required after repair

Targeted reruns are allowed during repair, but final success requires the full required verification handoff to pass.

---

## 23. Machine-Readable Examples

### 23.1 Diff set example: add field

```json
{
  "schema_version": "arch.diff.v1",
  "base_ir_hash": "sha256:prev",
  "next_ir_hash": "sha256:next",
  "diff_hash": "sha256:diff",
  "mode": "incremental_sync",
  "changes": [
    {
      "id": "diff.model_field_added.model_Post_field_visibility.2f5a9c",
      "type": "model_field_added",
      "entity_id": "model.Post.field.visibility",
      "entity_kind": "model_field",
      "parent_entity_id": "model.Post",
      "change_class": "additive",
      "risk": "medium",
      "after": {
        "type": { "kind": "enum", "values": ["public", "private", "followers"] },
        "constraints": { "required": true, "default": "public" }
      },
      "requires_confirmation": false,
      "confirmation_kinds": [],
      "affected_entity_hints": ["model.Post", "workflow.CreatePost"],
      "reason": "Post.visibility was added with a safe default."
    }
  ],
  "diagnostics": [],
  "summary": {
    "total": 1,
    "additive": 1,
    "modifying": 0,
    "destructive": 0,
    "ambiguous": 0,
    "max_risk": "medium"
  }
}
```

### 23.2 Plan excerpt: add field

```json
{
  "schema_version": "arch.sync_plan.v1",
  "plan_id": "plan.incremental.sha256prev.sha256next.sha256diff",
  "mode": "incremental_sync",
  "base_ir_hash": "sha256:prev",
  "next_ir_hash": "sha256:next",
  "summary": "Add Post.visibility and update dependent generated artifacts.",
  "risk": "medium",
  "change_class": "additive",
  "required_confirmations": [],
  "affected_artifacts": [
    {
      "path": "prisma/schema.prisma",
      "artifact_kind": "prisma_schema",
      "entity_ids": ["model.Post", "model.Post.field.visibility"],
      "impact": "update",
      "ownership_decision": { "writable": true, "owner": "arch", "update_policy": "patch_allowed", "requires_confirmation": false },
      "risk": "medium",
      "reason": "Prisma schema implements Post fields."
    },
    {
      "path": "src/generated/validators/post.ts",
      "artifact_kind": "validator",
      "entity_ids": ["model.Post"],
      "impact": "replace_generated_file",
      "ownership_decision": { "writable": true, "owner": "arch", "update_policy": "overwrite_allowed", "requires_confirmation": false },
      "risk": "low",
      "reason": "Post input validator must accept visibility."
    }
  ]
}
```

### 23.3 Conflict example: generated file drift

```json
{
  "id": "conflict.generated_file_drift.src_generated_workflows_createPost_ts",
  "type": "generated_file_drift",
  "severity": "blocking",
  "entity_ids": ["workflow.CreatePost"],
  "paths": ["src/generated/workflows/createPost.ts"],
  "message": "Generated workflow file has changed since the last verified Arch apply.",
  "details": {
    "expected_hash": "sha256:abc",
    "actual_hash": "sha256:def"
  },
  "resolution_options": [
    "restore_generated_file",
    "accept_generated_drift_as_new_baseline",
    "manual_fix_then_rerun"
  ]
}
```

---

## 24. CLI Behavior Contract

### 24.1 `arch plan`

Expected sync-engine behavior:

```text
- load previous IR if present
- validate current IR hash
- compute typed diff
- classify risk
- resolve affected artifacts
- detect ownership conflicts
- detect destructive changes
- generate plan JSON and summary
- write `.arch/ir.current.json`
- write `.arch/plans/<plan-id>.plan.json`
```

Exit behavior:

```text
0: valid plan created with no blocking conflicts
1: valid diagnostic but plan blocked
2: invalid input or metadata corruption
```

### 24.2 `arch apply`

Expected sync-engine behavior:

```text
- load selected plan
- receive freshly compiled current canonical IR from CLI/compiler pipeline and validate hash
- validate baseline hash
- validate metadata hashes
- check drift in affected files
- verify confirmations
- apply patch operations
- stage metadata updates
- create verification handoff
- invoke verifier through CLI orchestration
- promote metadata on success
```

Exit behavior:

```text
0: apply, verification, and metadata promotion succeeded
1: apply or verification failed; no metadata promotion
2: unsafe/stale/corrupt input; no writes or partial write stopped with report
```

### 24.3 `arch check`

Expected sync-engine behavior:

```text
- receive current canonical IR compiled outside sync engine
- compare current IR hash to baseline and report pending intent changes if any
- inspect artifact map and ownership map
- compute generated file and region drift
- check generated guarantee test coverage
- run static guarantee drift detectors where supported
- write `.arch/drift.json`
```

### 24.4 `arch repair`

Expected sync-engine behavior:

```text
- load latest failed verification or drift report
- create repair plan seed
- enforce allowlist and ownership
- create deterministic or agent repair actions
- apply validated repair patches
- hand off to verification
- stop after max attempts
```

---

## 25. Implementation Notes

### 25.1 Deterministic hashing

The sync engine should compute these hashes:

| Hash | Input | Purpose |
|---|---|---|
| `canonical_hash` | canonical IR without `canonical_hash` field | IR identity. |
| `diff_hash` | canonical diff set without `diff_hash` | Plan stability. |
| `plan_hash` | canonical plan without volatile run fields | Apply validation. |
| `content_hash` | file bytes or generated region bytes | Drift detection. |
| `generated_from_hash` | IR fragment + generator version + template ID | Artifact provenance. |
| `metadata_hash` | canonical metadata JSON | Plan staleness detection. |

### 25.2 Volatile fields

Runtime fields such as timestamps and run IDs may appear in plan and run records, but must not affect canonical IR or semantic diffing.

If a timestamp appears in a deterministic plan hash, it must be excluded from hash computation.

### 25.3 Generator rule registry

The implementation should maintain a registry:

```ts
interface GeneratorRule {
  id: string;
  version: string;
  entity_kinds: string[];
  artifact_kind: string;
  default_path: (entity: ComparableEntity, ir: ArchIR) => string;
  supports_diff_types: DiffTypeV1[];
  deterministic: boolean;
  requires_agent_when?: (diff: IntentDiffV1) => boolean;
}
```

The registry is used for:

```text
- default artifact mapping
- deterministic template selection
- detecting unsupported changes
- deciding when agent synthesis is needed
```

### 25.4 Artifact map recovery

If artifact-map metadata is missing but generated files contain Arch headers, V1 may offer a diagnostic recovery command. Normal sync should not infer a full artifact map from file headers during apply.

### 25.5 Metadata schema migrations

Every metadata file must include `schema_version`.

If schema versions are incompatible:

```text
- block normal apply
- require metadata migration command or restore from Git
- never silently reinterpret old metadata
```

### 25.6 Dependency additions

Agents may not add package dependencies unless the plan includes a deterministic dependency update action.

Dependency changes should be generated from target, integration, policy, or guarantee requirements and recorded in artifact mapping for `package.json`.

### 25.7 Migrations and databases

V1 should generate or validate Prisma migrations but avoid applying destructive migrations automatically.

Local integration tests should use isolated test databases when available. The sync engine must not assume production database access.

---

## 26. Acceptance Criteria

The sync engine implementation is acceptable for V1 if it satisfies these criteria.

### 26.1 Snapshot storage

```text
- Stores current and previous IR snapshots.
- Verifies canonical hashes before diffing.
- Promotes baseline only after verification succeeds.
- Detects stale plans and metadata hash mismatches.
```

### 26.2 Diff computation

```text
- Ignores formatting-only source changes.
- Emits typed diffs for supported V1 changes.
- Emits minimal leaf diffs for localized changes.
- Handles explicit aliases for renames.
- Blocks ambiguous suspected renames where unsafe.
```

### 26.3 Risk classification

```text
- Classifies changes as additive, modifying, destructive, or ambiguous.
- Assigns low, medium, high, or critical risk.
- Requires explicit confirmations for destructive changes.
- Blocks unsupported critical target changes in V1.
```

### 26.4 Affected artifact resolution

```text
- Builds dependency graph from IR and artifact map.
- Maps changed entities to generated artifacts.
- Includes dependent workflows, policies, guarantees, and tests.
- Marks human-owned artifacts as read-only context.
- Detects missing mappings and orphaned artifacts.
```

### 26.5 Patch planning

```text
- Produces machine-readable sync plans.
- Produces human-readable summaries.
- Every diff has planned action or explicit blocked/no-op reason.
- Every write path is allowlisted.
- Every agent task has bounded context and output schema.
```

### 26.6 Patch application

```text
- Validates plan hashes before writing.
- Enforces ownership before writing.
- Applies deterministic patches where possible.
- Validates agent patch proposals.
- Blocks writes to human-owned files.
- Blocks generated file drift in affected write targets.
```

### 26.7 Metadata updates

```text
- Updates artifact map and ownership map in staging.
- Records generated file and region hashes.
- Does not promote metadata on failed verification.
- Preserves traceability from artifacts to IR entities and source IDs.
```

### 26.8 Conflict handling

```text
- Reports blocking conflicts with entity IDs, paths, and resolution options.
- Blocks stale plans, ownership conflicts, metadata corruption, unsafe paths, and destructive changes without confirmation.
- Does not hide failures behind repair.
```

### 26.9 Verification handoff

```text
- Produces verification handoff with commands, changed files, generated tests, guarantee coverage expectations, and repair constraints.
- Requires full verifier success before metadata promotion.
- Supports bounded repair without broadening plan intent.
```

### 26.10 V1 demonstration scenarios

The sync engine should support these demo changes:

```text
- initial generation from a valid `backend.arch`
- add model
- add model field with default
- add relation
- add workflow
- add workflow step
- add integration stub
- add guarantee and generated test
- detect generated file drift
- block destructive field removal without confirmation
- repair a generated workflow/test failure within 3 attempts
```

---

## 27. Summary

The Arch sync engine is a deterministic planning and patching system around canonical typed intent.

Its contract is:

```text
1. Compare previous and current canonical IR.
2. Emit typed intent diffs.
3. Classify risk and destructive behavior.
4. Resolve affected entities and artifacts.
5. Enforce ownership boundaries.
6. Produce an explicit patch plan.
7. Apply only validated deterministic or bounded agent patches.
8. Stage metadata updates.
9. Hand off to verification.
10. Promote IR and metadata only after verification passes.
```

The sync engine is what prevents Arch from becoming a prompt wrapper. It ensures that generated backend code changes because system intent changed, that each implementation edit is traceable, that human-owned code is protected, and that verification—not plausibility—decides whether the synchronized implementation is acceptable.
