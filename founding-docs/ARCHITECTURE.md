# ARCHITECTURE.md

# Arch V1 Technical Architecture

**Status:** Draft architecture for V1 implementation  
**Scope:** TypeScript backend workflow services  
**Default stack:** Node.js, Fastify, PostgreSQL, Prisma, Redis by default or `cache: none` / `cache:none`, Vitest, Docker Compose, pnpm
**Primary source file:** `backend.arch`  
**Canonical compiler boundary:** `arch.ir.v1`

---

## 1. Overview

Arch is a spec-to-code synchronization system for AI-generated TypeScript backend workflow services.

The central inversion is:

```text
Implementation code becomes the build artifact.
System intent becomes the source of truth.
```

Developers author a structured `.arch` specification that describes backend intent: target runtime, data models, relations, workflows, API triggers, integrations, policies, guarantees, custom extension points, and tests. Arch compiles that specification into canonical typed IR, computes typed intent diffs when the spec changes, maps those diffs to generated implementation artifacts, constrains LLM agents to patch only affected generated files or rare generated regions, and verifies the resulting backend against generated tests and declared guarantees.

Arch is not a prompt wrapper. The LLM is not responsible for discovering what changed, deciding ownership boundaries, choosing arbitrary architecture, or validating correctness. Those responsibilities belong to deterministic compiler components. LLM agents are used only inside bounded implementation tasks after the compiler has already produced typed diffs, affected artifacts, patch constraints, and acceptance criteria.

The V1 architecture proves this loop:

```text
backend.arch
   ↓
Parser
   ↓
AST
   ↓
Draft semantic model / draft IR
   ↓
Semantic validation
   ↓
Canonical IR
   ↓
IR schema validation
   ↓
IR Snapshot Store
   ↓
IR Diff Engine
   ↓
Dependency Graph
   ↓
Change Planner
   ↓
Patch Generator
   ↓
Constrained LLM Agents
   ↓
Generated Code + Tests
   ↓
Verifier
   ↓
Repair Loop
   ↓
Metadata promotion
   ↓
Reviewable Git diff
```

The output is a real backend project with readable TypeScript, Prisma schema and migrations, Fastify routes, generated workflow implementations, integration stubs, generated tests, local Docker Compose runtime configuration, Arch metadata, verification reports, and a reviewable Git diff.

---

## 2. V1 Scope

### 2.1 Supported V1 target

Arch V1 targets one backend stack:

```text
Language: TypeScript
Runtime: Node.js
Framework: Fastify
Database: PostgreSQL
ORM: Prisma
Cache: Redis by default, or none via `cache: none` / `cache:none`
Testing: Vitest
Local runtime: Docker Compose
Package manager: pnpm
Workflow: local CLI
```

V1 supports one primary spec file:

```text
backend.arch
```

V1 supports one generated backend service per Arch project.

### 2.2 Supported `.arch` primitives

V1 supports these source-level primitives:

```text
system
target
model
field
relation
workflow
trigger
step
integration
policy
guarantee
test
custom extension point
```

The canonical IR normalizes these into typed entities such as `SystemIR`, `TargetIR`, `ModelIR`, `FieldIR`, `RelationIR`, `WorkflowIR`, `TriggerIR`, `StepIR`, `IntegrationIR`, `PolicyIR`, `GuaranteeIR`, `TestIR`, `CustomExtensionIR`, `ArtifactIR`, `OwnershipIR`, `SourceLocationIR`, and `VerificationIR`.
The `custom` source primitive maps to first-class `CustomExtensionIR`, extension-point `ArtifactIR`, `OwnershipIR`, and to `StepIR` when a workflow calls it. The `custom kind: test_generator` form is reserved for post-V1 and must be rejected by semantic validation.

### 2.3 V1 non-goals

V1 intentionally excludes:

```text
frontend generation
mobile apps
arbitrary backend languages
arbitrary language or framework targets
multiple backend frameworks
arbitrary repo support
Kubernetes
production cloud deployment automation
multi-service orchestration
complex distributed systems
complex event streaming
implicit many-to-many relations
scalar array persistence
full formal verification
editing arbitrary legacy repositories
autonomous long-running agents
unconstrained autonomous agents
automatic destructive migrations
hidden no-code runtime
```

The goal is not universal app generation. The goal is to prove reliable initial generation and incremental synchronization for backend workflow services.

---

## 3. Architecture Principles

### 3.1 `.arch` is source; generated code is artifact

`backend.arch` is the durable system contract and source of truth for V1. Generated source code is inspectable, reviewable, testable, and deployable, but it is synchronized from the spec. Human-owned extension points remain source code controlled by developers.

### 3.2 Canonical IR is the compiler boundary

Arch never plans or generates directly from raw `.arch` text. It first parses source into AST, builds a draft semantic model or draft IR, validates semantics, then expands shorthand, resolves references, applies defaults, normalizes ordering, attaches source locations, emits canonical JSON IR, and validates that IR against the `arch.ir.v1` schema before storing or diffing it.

The IR is stable across formatting changes. Whitespace, comments, and declaration reordering must not produce implementation diffs unless the ordering is semantically meaningful, such as workflow step order or enum value order.

### 3.3 Determinism before agency

Parsing, validation, canonicalization, diffing, dependency analysis, ownership checks, plan validation, patch validation, and verification orchestration are deterministic.

LLM agents are used only for bounded synthesis tasks:

```text
implementation synthesis
adapting existing generated code
generating tests from structured guarantees
repairing failed generated patches
explaining ambiguous verification failures
```

An agent never receives an instruction like “update the app.” It receives a typed task such as:

```text
Apply model_field_added(model.Post.field.visibility) to this allowlisted set of artifacts.
Preserve ownership rules.
Do not edit unrelated files.
Produce structured patch operations.
Generated guarantee tests must pass.
```

### 3.4 Small intent change should produce small code patch

The diff engine compares canonical IR snapshots, not source text or generated code. A field addition should produce a `model_field_added` diff. The dependency graph maps that entity to affected artifacts. The planner converts the diff into a bounded patch plan. The patch generator updates only affected generated files or generated regions.
For V1, generated artifacts should prefer full files under `src/generated/**` and `tests/generated/**`. Generated regions are rare and avoided unless a shared file is unavoidable; human extension implementations under `src/custom/**` are human-owned after stub creation.

### 3.5 No destructive change is silent

Potentially destructive changes are blocked by default. Removing a model, removing a field, changing a persistent field type incompatibly, changing database provider, removing a workflow, or removing an integration requires explicit developer confirmation and a migration strategy.

### 3.6 Ownership is enforced before writing

Arch may update generated files and generated regions. It may create extension point stubs. It must not overwrite human-owned files or completed extension point implementations without explicit developer action.

### 3.7 Verification is a first-class gate

Generated code is not accepted because it looks plausible. It must pass deterministic verification: install checks, Prisma generation, migration validation, TypeScript typecheck, lint when configured, unit tests, integration tests, generated guarantee tests, ownership checks, drift checks, and repair bounds.

### 3.8 Traceability is required

Every generated artifact should be traceable to one or more IR entities and source locations. Every generated test should map to a model, workflow, policy, guarantee, or declared test requirement. Every plan should explain why each file is touched.

---

## 4. End-to-End System Pipeline

### 4.1 Initial generation

```text
backend.arch
   ↓ parse
AST with source spans
   ↓ build draft semantic model / draft IR
Draft semantic model / draft IR
   ↓ validate semantics
Canonical IR
   ↓ validate IR schema
Schema-valid canonical IR
   ↓ compare with empty baseline
Typed initial diff
   ↓ build dependency graph
Generation plan
   ↓ deterministic templates + bounded agents
Generated backend code + tests
   ↓ verify
Verification report
   ↓ persist metadata
Reviewable Git diff
```

### 4.2 Incremental sync

```text
changed backend.arch
   ↓ parse + compile
draft semantic model / draft IR
   ↓ semantic validation
new canonical IR
   ↓ IR schema validation
schema-valid canonical IR
   ↓ compare against last verified IR snapshot
Typed IR diff
   ↓ dependency graph expansion
Affected artifacts
   ↓ change planner
Patch plan
   ↓ patch generator + constrained agents
Minimal file changes
   ↓ verifier
Repair loop if needed
   ↓ metadata update after success
Reviewable Git diff
```

### 4.3 Drift check

```text
current backend.arch
   ↓ parse + draft model + semantic validation + canonicalize + schema validate
schema-valid current IR
last artifact map + ownership metadata
   ↓ inspect generated files / regions / tests
Drift report
   ↓ optional repair plan
Bounded repair
   ↓ verification
```

---

## 5. Main Components

The following components make up Arch V1.

### 5.1 Component summary table

| Component | Responsibility | Input | Output | Failure modes | Deterministic or LLM-assisted |
|---|---|---|---|---|---|
| CLI | User entrypoint and workflow orchestration | Commands, repo path, flags, spec path | Plans, applied patches, reports, exit codes | invalid command, dirty working tree policy, missing files, unsupported flags | Deterministic |
| Parser | Parse `.arch` syntax | `backend.arch` text | AST with source spans | syntax error, invalid token, unterminated block/string | Deterministic |
| AST Builder | Build typed source tree and symbol candidates | Parser tokens/parse tree | AST nodes, declaration index, source spans | duplicate source constructs, malformed blocks | Deterministic |
| Source Mapper | Preserve source locations and hashes | AST nodes, source file | `SourceLocationIR`, diagnostics ranges | missing span, invalid offsets, path normalization failure | Deterministic |
| Draft Semantic Builder | Build validation-ready semantic model or draft IR | AST, symbol candidates, source map | draft semantic model / draft IR, symbol table | malformed draft shape, duplicate candidate ID, missing source span | Deterministic |
| Semantic Validator | Validate references, types, unsupported constructs, conflicts | draft semantic model / draft IR, symbol table | validation diagnostics or accepted semantic model | missing reference, invalid relation, unsupported feature, conflicting policy/guarantee | Deterministic |
| IR Generator | Canonicalize validated source into `arch.ir.v1` | validated semantic model / draft IR | canonical IR JSON and hash | non-canonical ordering, unresolved default | Deterministic |
| IR Schema Validator | Validate canonical IR shape and metadata contracts | canonical IR JSON | schema-valid canonical IR or diagnostics | missing required field, invalid enum, bad ownership/artifact reference | Deterministic |
| IR Snapshot Store | Persist baseline and candidate IR snapshots | canonical IR, run metadata | `.arch/ir.current.json`, `.arch/ir.previous.json` | stale snapshot, hash mismatch, incompatible schema version | Deterministic |
| IR Diff Engine | Compare old and new IR | previous IR, current IR | `arch.diff.v1` typed diff set | ambiguous rename, schema mismatch, missing baseline | Deterministic |
| Dependency Graph | Map entity changes to dependent entities and artifacts | IR, diff set, artifact map | affected entity graph, affected artifacts | missing artifact mapping, cyclic dependency, unknown entity | Deterministic |
| Artifact Mapper | Maintain IR entity to artifact mapping | IR, generator templates, current metadata | `artifact-map.json`, artifact impacts | unmapped entity, stale path, duplicate artifact ownership | Deterministic |
| Ownership Manager | Enforce file and region write permissions | ownership metadata, file hashes, patch ops | allowed/rejected writes, drift records | human-owned conflict, generated hash mismatch, missing marker | Deterministic |
| Change Planner | Convert diffs to safe implementation plans | diff set, graph, ownership, policy | plan JSON + human summary | destructive change, unsupported change, missing info, ambiguous diff | Deterministic, may use LLM only for explanatory text |
| Patch Generator | Apply deterministic templates and create agent tasks | plan, IR fragments, affected files | structured patch operations, agent task specs | template failure, allowlist violation, invalid operation | Deterministic with LLM-assisted substeps |
| Agent Orchestrator | Dispatch bounded tasks to agents and validate outputs | agent tasks, file context, constraints | agent patch proposals | invalid output, unrelated edits, hallucinated files, timeout | LLM-assisted but deterministically constrained |
| Constrained LLM Agents | Synthesize or adapt implementation/test code | typed task, IR fragment, file context | structured file ops or bounded diffs | bad code, invalid patch, forbidden edit, failed tests | LLM-assisted |
| Verifier | Run generated project checks and summarize | repo state, verification config | verification report | missing dependency, Prisma failure, typecheck failure, test failure | Deterministic orchestration |
| Repair Loop | Classify failures and attempt bounded repair | verification failure, plan, allowed files | repair patches or final unresolved report | repeated failure, broad repair, destructive repair request | Deterministic control with LLM-assisted repair |
| Drift Detector | Detect divergence from spec and metadata | IR, artifact map, ownership, file contents, tests | drift report | missing artifact, modified generated file, guarantee violation not statically detectable | Deterministic plus optional LLM explanation |

---

## 6. Component Responsibilities

### 6.1 CLI

The CLI is the user-facing control plane.

V1 commands:

```bash
arch init
arch parse backend.arch
arch plan
arch apply
arch check
arch repair
```

Responsibilities:

```text
- locate project root
- locate backend.arch
- load .arch metadata
- coordinate compiler phases
- enforce command flags
- print diagnostics with source locations
- produce human-readable plans and reports
- control apply confirmation rules
- run verifier and repair loop
- exit with stable status codes
```

Inputs:

```text
- command name
- command flags
- repository path
- backend.arch
- .arch metadata directory
- Git status
```

Outputs:

```text
- stdout/stderr diagnostics
- plan files
- generated or patched source files
- verification reports
- repair reports
- local Git diff
```

Failure modes:

```text
- command run outside project
- missing backend.arch
- invalid .arch metadata
- dirty working tree when policy requires clean state
- unsupported target
- destructive change without confirmation
```

Determinism:

```text
Deterministic. The CLI may display LLM-generated explanatory text only after deterministic failure classification.
```

### 6.2 Parser

The parser reads `backend.arch` and produces a syntax tree with source spans.

Responsibilities:

```text
- lex `.arch` source
- parse grammar
- preserve source spans for every declaration and statement
- emit syntax diagnostics
- reject invalid tokens and malformed blocks
```

Inputs:

```text
- UTF-8 backend.arch source text
```

Outputs:

```text
- parse tree or AST precursor
- syntax diagnostics
```

Failure modes:

```text
- unterminated string
- invalid character
- unclosed block
- malformed field declaration
- unknown block where grammar does not permit it
```

Determinism:

```text
Deterministic.
```

### 6.3 AST Builder

The AST builder converts the parse tree into structured source-level declarations.

Responsibilities:

```text
- build typed AST nodes for system, target, models, fields, relations, integrations, workflows, policies, guarantees, tests, and custom declarations
- preserve source spans
- create initial declaration indexes
- normalize trivial syntactic aliases that are source-level only
```

Inputs:

```text
- parser output
```

Outputs:

```text
- AST
- declaration index
- source-span map
```

Failure modes:

```text
- duplicate target block
- invalid root declaration count
- malformed declaration body
- duplicate declaration keys where source syntax forbids them
```

Determinism:

```text
Deterministic.
```

### 6.3a Draft Semantic Builder

The draft semantic builder converts AST declarations into a validation-ready model before canonical IR is accepted.

Responsibilities:

```text
- build symbol tables for declarations and candidate generated entities
- preserve source spans and draft source IDs
- represent parsed but unsupported reserved constructs so semantic validation can reject them precisely
- produce draft relation, workflow, guarantee, test, and custom-extension shapes
- avoid canonical hashing, artifact generation, or implementation planning
```

Inputs:

```text
- AST
- declaration index
- source map
```

Outputs:

```text
- draft semantic model or draft IR
- symbol table
- draft diagnostics
```

Failure modes:

```text
- malformed draft shape
- duplicate candidate entity ID
- missing source location for validation error
```

Determinism:

```text
Deterministic.
```

### 6.4 Source Mapper

The source mapper records source locations for traceability and error reporting.

Responsibilities:

```text
- create source location entries for IR entities
- normalize file paths to repository-relative POSIX paths
- compute source span hashes
- map validation diagnostics to line, column, and byte offsets
- map generated artifacts back to source entity IDs
```

Inputs:

```text
- AST nodes
- source file contents
- repository root
```

Outputs:

```text
- SourceLocationIR entries
- source-map.json
- diagnostic locations
```

Failure modes:

```text
- invalid byte offsets
- non-normalized path
- missing source span for generated entity without synthetic source marker
```

Determinism:

```text
Deterministic.
```

### 6.5 Semantic Validator

The semantic validator rejects invalid or unsupported system intent before IR is accepted.

Responsibilities:

```text
- validate there is exactly one system and one target
- validate V1 target values
- validate model names, fields, types, defaults, constraints, relations, and indexes
- support field-level `indexed` / `index` while rejecting named or composite source index declarations in V1
- resolve model references, workflow references, integration references, policy scopes, guarantee scopes, and test scopes
- reject unsupported V1 syntax that was parsed as reserved
- validate workflow trigger uniqueness
- validate workflow step vocabulary and ordering
- validate integration kind and failure policy compatibility
- validate policy and guarantee conflicts
- validate guarantee verifiability and test mapping
- classify unsupported features as hard errors
- reject custom `test_generator` declarations in V1
```

Inputs:

```text
- draft semantic model / draft IR
- symbol table
- source map
```

Outputs:

```text
- validated semantic model
- diagnostics
```

Failure modes:

```text
- Workflow references undeclared integration
- Model field references undeclared model
- enum default not in enum values
- cache step declared while target cache is none
- unsupported trigger such as schedule.cron
- unsupported scalar array field
- implicit many-to-many relation
- named or composite source index declaration
- unknown short-form guarantee
- custom test_generator declaration
- policy contradicts guarantee
```

Determinism:

```text
Deterministic.
```

### 6.6 IR Generator

The IR generator creates canonical `arch.ir.v1` JSON.

Responsibilities:

```text
- expand target defaults
- expand field defaults and implied constraints
- canonicalize aliases such as datetime -> timestamp and index -> indexed
- resolve all references to fully qualified entity IDs
- represent inverse relation fields as `model_ref_list` with non-persisted `FieldStorageIR`
- produce stable semantic IDs
- sort unordered collections by ID
- preserve workflow step order and enum value order
- compute canonical hashes
- create verification metadata
- create initial artifact and ownership intent metadata, including artifact generation metadata and ownership `write_scope`
```

Inputs:

```text
- validated semantic model / draft IR
- source locations
- compiler version
```

Outputs:

```text
- canonical IR document
- canonical hash
```

Failure modes:

```text
- non-deterministic ordering
- duplicate entity ID
- unresolved source_id
- unsupported target emitted into IR
```

Determinism:

```text
Deterministic.
```

### 6.6a IR Schema Validator

The IR schema validator verifies the canonical JSON contract before snapshots, diffs, plans, or generation consume it.

Responsibilities:

```text
- validate required fields, enum values, and entity references
- validate `CustomExtensionIR`, `ArtifactIR`, `OwnershipIR`, source maps, and verification metadata
- ensure every artifact has generation metadata and ownership metadata
- ensure every ownership entry declares `write_scope`
- ensure guarantee coverage uses canonical statuses: covered, partially_covered, manual, or missing
- reject `unsupported` guarantee coverage during normal V1 apply; allow it only in diagnostics-only reporting
```

Inputs:

```text
- canonical IR JSON
```

Outputs:

```text
- schema-valid canonical IR
- schema diagnostics
```

Failure modes:

```text
- missing required metadata
- invalid ownership write_scope
- artifact references missing ownership
- unsupported guarantee status in normal apply
```

Determinism:

```text
Deterministic.
```

### 6.7 IR Snapshot Store

The snapshot store persists IR documents used for planning and sync.

Responsibilities:

```text
- load the last verified baseline IR
- write candidate current IR during plan/check
- atomically promote candidate IR after successful apply and verification
- preserve plan and run history by IR hash
- detect schema version incompatibility
```

Inputs:

```text
- canonical IR
- previous snapshot
- command mode
```

Outputs:

```text
.arch/ir.current.json
.arch/ir.previous.json
.arch/runs/<run-id>/ir.*.json
```

Failure modes:

```text
- missing baseline on incremental apply
- corrupt JSON
- canonical hash mismatch
- incompatible schema version
- plan references old hash that no longer matches metadata
```

Determinism:

```text
Deterministic.
```

### 6.8 IR Diff Engine

The diff engine compares canonical IR snapshots and emits typed intent diffs.

Responsibilities:

```text
- compare previous IR and current IR
- ignore formatting-only source changes
- emit typed changes such as model_field_added and workflow_step_reordered
- classify changes as additive, modifying, destructive, or ambiguous
- assign risk level
- identify confirmation requirements
- emit expected artifact impact hints
- detect rename suspicion where possible without silently treating it as a rename
```

Inputs:

```text
- base IR snapshot
- next IR snapshot
```

Outputs:

```text
- IRDiffSet
```

Failure modes:

```text
- missing previous IR for incremental plan
- schema version mismatch
- ambiguous rename
- incompatible target change
- corrupted snapshot hash
```

Determinism:

```text
Deterministic.
```

### 6.9 Dependency Graph

The dependency graph determines what entities and artifacts are affected by each diff.

Responsibilities:

```text
- build graph edges between models, fields, relations, workflows, steps, integrations, policies, guarantees, tests, artifacts, and ownership records
- propagate impacts from changed entities to dependent artifacts
- constrain edit sets to affected files
- support minimal patch planning
- detect dependency cycles that affect planning
```

Example edges:

```text
model.Post.field.content -> src/generated/validators/post.ts
model.Post.field.content -> workflow.CreatePost.step.sanitize_post_content
workflow.CreatePost -> src/generated/routes/posts.ts
workflow.CreatePost -> tests/generated/createPost.*.test.ts
guarantee.no_unsanitized_html_persisted -> tests/generated/createPost.htmlSafety.test.ts
integration.PushProvider -> src/generated/integrations/pushProvider.ts
```

Inputs:

```text
- current IR
- previous artifact map
- diff set
```

Outputs:

```text
- affected entity graph
- affected artifact list
- artifact impact records
```

Failure modes:

```text
- entity has no mapped artifact and no generator rule
- artifact points to missing entity
- dependency cycle prevents ordering
- stale artifact map entry
```

Determinism:

```text
Deterministic.
```

### 6.10 Artifact Mapper

The artifact mapper records which implementation files represent which IR entities.

Responsibilities:

```text
- map IR entities to generated files and regions
- map generated tests to guarantees
- map runtime files to target features
- preserve artifact hashes
- provide reverse lookup from file path to IR entities
- support source traceability, drift detection, ownership enforcement, and minimal patching
```

Inputs:

```text
- IR
- generator templates
- existing artifact-map.json
- generated file paths
```

Outputs:

```text
.arch/artifact-map.json
ArtifactIR entries
```

Failure modes:

```text
- duplicate artifact path with incompatible owners
- generated file missing from map
- mapped entity no longer exists
- path moved without metadata update
```

Determinism:

```text
Deterministic.
```

### 6.11 Ownership Manager

The ownership manager protects developer code.

Responsibilities:

```text
- classify files and regions as generated, human-owned, mixed/generated-region, extension point, or external
- enforce update policies
- compare file and region hashes for drift
- validate generated region markers
- block writes to human-owned files
- prevent overwriting completed extension point implementations
```

Inputs:

```text
- ownership.json
- file contents
- patch operations
- artifact map
```

Outputs:

```text
- ownership validation result
- drift findings
- rejected patch operations
- updated ownership metadata after successful apply
```

Failure modes:

```text
- generated file manually modified
- generated region marker missing
- human-owned file targeted by patch
- extension point stub already edited
- ownership metadata mismatch
```

Determinism:

```text
Deterministic.
```

### 6.12 Change Planner

The change planner converts typed diffs and dependencies into an implementation plan.

Responsibilities:

```text
- group related diffs into coherent plan steps
- identify deterministic template operations
- identify LLM-assisted tasks
- compute allowed file sets
- compute forbidden files
- classify risk and destructive operations
- define migration requirements
- define generated or updated tests
- define verification commands
- produce machine-readable plan JSON and human-readable summary
```

Inputs:

```text
- IRDiffSet
- current IR
- previous IR
- dependency graph
- artifact map
- ownership state
```

Outputs:

```text
.arch/plans/<plan-id>.plan.json
.arch/plans/<plan-id>.summary.md
```

Failure modes:

```text
- destructive change without confirmation
- missing integration provider
- unsupported diff type
- ambiguous rename
- target change outside V1 migration support
- affected artifact is human-owned
```

Determinism:

```text
Deterministic. Optional LLM explanation is allowed only after the plan exists and must not change plan semantics.
```

### 6.13 Patch Generator

The patch generator applies deterministic generation and prepares LLM tasks for non-trivial code synthesis.

Responsibilities:

```text
- generate new files from templates
- update fully generated files when safe
- update generated regions when used
- create structured agent task specs
- validate agent outputs against patch schema
- apply accepted patch operations
- update artifact and ownership metadata in staging
```

Inputs:

```text
- plan JSON
- IR fragments
- allowed files
- existing file contents
- generator templates
```

Outputs:

```text
- file operations
- agent tasks
- patched working tree
- staged metadata updates
```

Failure modes:

```text
- patch references non-allowlisted path
- generated region not found
- template output fails syntax validation
- agent output malformed
- patch cannot apply cleanly
```

Determinism:

```text
Deterministic orchestration with LLM-assisted substeps.
```

### 6.14 Agent Orchestrator

The orchestrator invokes specialized agents for bounded tasks.

Responsibilities:

```text
- build task prompts from typed diffs, IR fragments, affected files, ownership rules, and acceptance criteria
- route tasks to the correct agent role
- enforce allowed file lists
- request structured patch output
- validate patch schema
- reject unrelated edits
- record agent inputs and outputs in run metadata
```

Inputs:

```text
- agent task specs
- file context
- constraints
- verification expectations
```

Outputs:

```text
- structured patch proposals
- agent logs
- rejected patch reasons
```

Failure modes:

```text
- agent edits forbidden file
- agent returns prose instead of patch schema
- agent invents unsupported dependency
- agent removes unrelated code
- agent fails to satisfy syntax/type checks
```

Determinism:

```text
LLM-assisted, but bounded by deterministic task construction, output validation, ownership checks, and verification.
```

### 6.15 Verifier

The verifier determines whether generated implementation is acceptable.

Responsibilities:

```text
- install dependencies if needed
- run Prisma generation
- validate migrations
- run TypeScript typecheck
- run lint when configured
- run unit tests
- run integration tests
- run generated guarantee tests
- run drift and ownership checks
- produce verification report
```

Inputs:

```text
- working tree
- verification config from IR
- package manager metadata
- Docker Compose availability when integration tests require it
```

Outputs:

```text
.arch/runs/<run-id>/verification-report.json
.arch/runs/<run-id>/verification-report.md
```

Failure modes:

```text
- pnpm install failure
- Prisma schema invalid
- migration conflict
- typecheck failure
- lint failure
- unit test failure
- integration test failure
- guarantee test failure
- ownership drift
```

Determinism:

```text
Deterministic orchestration. Test outcomes may depend on environment health, but commands and interpretation are deterministic.
```

### 6.16 Repair Loop

The repair loop attempts bounded fixes after verification failures.

Responsibilities:

```text
- classify verification failures
- create targeted repair plan
- allow repair only on files related to the failing plan or failing generated artifacts
- invoke Repair Agent when synthesis is needed
- validate repair patch
- rerun verification
- stop after max attempts
- preserve unresolved failure report
```

Inputs:

```text
- verification report
- original plan
- patch history
- ownership metadata
```

Outputs:

```text
- repair patches
- repair-history entries
- final verification report
```

Failure modes:

```text
- max attempts exhausted
- repair patch violates ownership
- repair requires destructive migration
- repair touches unrelated file
- repaired code still fails verification
```

Determinism:

```text
Deterministic loop control with LLM-assisted repair patches.
```

### 6.17 Drift Detector

The drift detector checks whether implementation artifacts still match spec and metadata.

Responsibilities:

```text
- compare generated file hashes against ownership metadata
- compare generated region hashes inside mixed files
- detect missing artifacts
- detect missing generated guarantee tests
- detect artifact map and ownership mismatches
- run static guarantee drift checks where supported
- report drift with affected IR entities and suggested repair direction
```

Inputs:

```text
- current IR
- artifact-map.json
- ownership.json
- source-map.json
- file contents
- generated tests
```

Outputs:

```text
- drift report
- optional repair plan
```

Failure modes:

```text
- metadata missing
- generated file manually modified
- generated region markers removed
- artifact exists but no longer maps to IR
- guarantee violation not statically detectable
```

Determinism:

```text
Deterministic for V1 checks. Optional LLM explanation may summarize a deterministic finding.
```

---

## 7. Deterministic vs LLM-Assisted Boundary

### 7.1 Deterministic responsibilities

Arch V1 uses deterministic code for:

```text
parsing
AST construction
source location mapping
draft semantic model / draft IR construction
semantic validation
IR generation
IR canonical serialization
IR schema validation
IR diffing
risk classification
rename-suspicion diagnostics
dependency graph construction
artifact mapping
ownership checks
plan schema validation
patch schema validation
file allowlist enforcement
syntax validation
formatting invocation
Prisma schema validation orchestration
migration validation orchestration
TypeScript typecheck orchestration
lint orchestration
test execution
verification report generation
metadata update and promotion
Git diff production
```

### 7.2 LLM-assisted responsibilities

Arch V1 may use LLM agents for:

```text
implementation synthesis inside generated files
adapting existing generated code to typed diffs
generating tests from structured guarantees
repairing failed generated patches
explaining ambiguous test/typecheck failures in reports
```

### 7.3 Prohibited LLM responsibilities

Arch V1 must not rely on an LLM to:

```text
parse `.arch` source
resolve semantic references
decide semantic diffs
invent missing integrations or providers
infer unsupported behavior from vague prose
create sync plans from scratch
choose destructive migration behavior
bypass ownership rules
modify human-owned files
weaken guarantees or policies
mark verification as passed
silently delete generated artifacts
produce unvalidated patches
```

### 7.4 Why this boundary matters

The compiler must narrow the problem before any model writes code. The LLM receives structured, typed work items, not product requirements. This is the core difference between Arch and free-roaming coding agents.

---

## 8. State Model

Arch stores project metadata in `.arch/`. This directory is version-controlled unless a project explicitly decides to exclude volatile run logs. V1 should default to tracking stable metadata and may ignore verbose run logs through `.gitignore` if needed.

### 8.1 Directory layout

Recommended V1 state layout:

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
      plan.json
      diff.json
      patch.json
      verification-report.json
      verification-report.md
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

### 8.2 `ir.previous.json`

Represents the last successfully applied and verified baseline IR.

Purpose:

```text
- diff baseline for the next `arch plan`
- source of truth for currently synchronized generated implementation
- reference hash for artifact metadata
```

Update rules:

```text
- Created during successful first apply.
- Updated only after `arch apply` completes verification successfully.
- Not updated by failed plans, failed applies, or failed repairs.
- On successful apply, the candidate current IR is promoted to previous baseline for future diffs.
```

### 8.3 `ir.current.json`

Represents the latest canonical IR compiled from the current `backend.arch` during the most recent `arch plan`, `arch check`, or `arch apply`.

Purpose:

```text
- candidate IR for planning
- current source-state snapshot
- input to typed diff against `ir.previous.json`
```

Update rules:

```text
- Written during `arch plan` after parsing and validation succeed.
- Written during `arch check` as a candidate but not promoted.
- Recomputed during `arch apply` and must match the plan's `next_ir_hash` before applying.
- Promoted to `ir.previous.json` only after successful apply and verification.
```

### 8.4 `artifact-map.json`

Maps IR entities to generated artifacts.

Example shape:

```json
{
  "schema_version": "arch.artifact_map.v1",
  "ir_hash": "sha256:...",
  "artifacts": [
    {
      "id": "artifact.src_generated_models_post_ts",
      "path": "src/generated/models/post.ts",
      "artifact_kind": "typescript_model",
      "entity_ids": ["model.Post"],
      "ownership_id": "ownership.src_generated_models_post_ts",
      "generation": {
        "mode": "deterministic_template",
        "generator_id": "arch.templates.typescript.fastify.v1",
        "template_id": "model.typescript.v1",
        "ir_fragment_hash": "sha256:..."
      },
      "generated_from_hash": "sha256:..."
    }
  ]
}
```

Purpose:

```text
- minimal patch planning
- reverse lookup from file to IR entity
- drift detection
- guarantee test traceability
- generated artifact cleanup planning
- generator/template provenance and constrained-agent audit
```

Update rules:

```text
- Drafted during planning.
- Updated in staging during apply.
- Committed to `.arch/artifact-map.json` after successful verification.
```

### 8.5 `ownership.json`

Tracks file and region ownership.

Example shape:

```json
{
  "schema_version": "arch.ownership.v1",
  "entries": [
    {
      "id": "ownership.src_generated_workflows_createPost_ts",
      "path": "src/generated/workflows/createPost.ts",
      "owner": "arch",
      "ownership_kind": "generated_file",
      "update_policy": "overwrite_allowed",
      "write_scope": "whole_file",
      "entity_ids": ["workflow.CreatePost"],
      "content_hash": "sha256:..."
    }
  ]
}
```

Purpose:

```text
- distinguish generated, human-owned, mixed, extension, and external files
- record write scope: whole file, generated region, stub only, or none
- detect manual edits to generated artifacts
- prevent overwriting human-owned code
- identify extension stubs that became human-owned
```

Update rules:

```text
- Created on first generation.
- Hashes updated after successful apply.
- Extension point stubs are create-only after creation.
- If a generated file hash differs before apply, Arch reports drift before writing.
```

### 8.6 `source-map.json`

Stores source location mapping for diagnostics and traceability.

Purpose:

```text
- map IR entity IDs to backend.arch line/column ranges
- map generated files back to spec spans
- support meaningful plan and drift reports
```

Update rules:

```text
- Rebuilt whenever current IR is compiled.
- Promoted with successful apply.
```

### 8.7 `plans/`

Stores machine-readable and human-readable plans.

Plan files include:

```text
plan ID
base IR hash
next IR hash
typed diff set
affected entities
affected artifacts
ownership decisions
risk classification
confirmation requirements
planned deterministic operations
planned agent tasks
verification commands
expected generated tests
```

A plan is valid only if:

```text
- `ir.previous.json` hash still equals `base_ir_hash`
- current compiled IR hash equals `next_ir_hash`
- ownership metadata has not drifted in affected files
- plan schema validates
```

### 8.8 `runs/`

Stores apply and check execution details.

Run records include:

```text
- command
- timestamps
- compiler version
- base and current IR hashes
- plan ID
- patch operations
- agent task inputs and outputs
- verification results
- final status
```

Stable summaries should be version-controlled when useful. Large raw logs may be ignored.

### 8.9 `repair-history/`

Stores repair attempts.

Each record includes:

```text
- originating run ID
- failure classification
- repair attempt number
- allowed files
- patch operations
- verification result after repair
- unresolved failures if any
```

### 8.10 `drift.json`

Stores latest drift report from `arch check`.

Purpose:

```text
- expose generated file modifications
- expose missing artifacts
- expose guarantee coverage gaps
- provide repair input
```

This file is replaced on each check run.

### 8.11 `locks/` and `tmp/`

`locks/` prevents concurrent apply operations from writing the same metadata or generated artifacts.

`tmp/` stores metadata drafts during apply and promotion. Stable metadata files such as `ir.previous.json`, `artifact-map.json`, `ownership.json`, and `source-map.json` are replaced only after verification passes and metadata schemas and recorded hashes validate. Failed apply or repair runs must not promote drafts from `tmp/`.

---

## 9. First-Time Generation Flow

First-time generation happens when no verified baseline exists.

### 9.1 `arch init`

Responsibilities:

```text
- create `.arch/` metadata directory
- create starter `backend.arch` if missing
- optionally scaffold empty project directories
- initialize empty metadata files where useful
- add generated-code conventions and README notes
```

Recommended generated files:

```text
backend.arch
.arch/
  plans/
  runs/
  repair-history/
  locks/
  tmp/
src/custom/README.md
```

`arch init` should not generate the full backend unless explicitly requested. It prepares the project for planning.

### 9.2 `arch plan` on first generation

Flow:

```text
1. Load backend.arch.
2. Parse source into AST.
3. Build source map.
4. Build draft semantic model or draft IR.
5. Validate semantics.
6. Generate canonical IR.
7. Validate canonical IR schema.
8. Store candidate `.arch/ir.current.json`.
9. Detect no previous baseline.
10. Treat all IR entities as initial additions.
11. Build dependency graph from generator rules.
12. Produce initial generation plan.
13. Write plan files under `.arch/plans/`.
14. Print human-readable plan.
```

Initial plan should include:

```text
- target stack
- models and relations
- workflows and triggers
- integrations and extension points
- generated tests and guarantee coverage
- files to create
- ownership classifications
- migration strategy
- verification commands
- risk level
```

### 9.3 `arch apply` on first generation

Flow:

```text
1. Load selected plan.
2. Recompile backend.arch through draft model, semantic validation, canonical IR, and IR schema validation.
3. Confirm current IR hash matches plan next IR hash.
4. Confirm no conflicting existing files.
5. Scaffold project files.
6. Generate Prisma schema.
7. Generate initial migration or migration scaffold.
8. Generate TypeScript models and validators.
9. Generate Fastify app, routes, and workflow implementations.
10. Generate runtime config, db client, cache runtime when enabled, and Docker Compose.
11. Generate integration stubs.
12. Generate tests from models, workflows, and guarantees.
13. Create extension point stubs only if missing.
14. Write artifact map and ownership metadata in staging.
15. Run verifier.
16. Run bounded repair loop if enabled and needed.
17. On success, promote metadata and IR snapshot.
18. Print verification report and Git diff summary.
```

### 9.4 Initial generation success conditions

Initial generation succeeds only if:

```text
- all required generated files are present
- ownership metadata is valid
- generated code formats and typechecks
- Prisma schema validates
- migrations validate
- generated tests pass
- generated guarantee tests pass for `covered` guarantees, and `partially_covered` or `manual` guarantees report limitations
- no human-owned file was overwritten
```

### 9.5 Initial generation failure handling

If initial generation fails:

```text
- do not promote `ir.current.json` to `ir.previous.json`
- leave working tree changes for inspection unless `--rollback-on-failure` is provided
- write run report
- write unresolved verification report
- include exact failed commands and affected files
```

---

## 10. Incremental Sync Flow

Incremental sync keeps generated code aligned with a changed `.arch` spec.

### 10.1 Flow

```text
1. Developer edits backend.arch.
2. Developer runs `arch plan`.
3. Arch parses the new spec and builds a draft semantic model or draft IR.
4. Arch validates semantics.
5. Arch generates and schema-validates new canonical IR.
6. Arch loads `.arch/ir.previous.json` as baseline.
7. Diff engine computes typed diff.
8. Dependency graph expands changes to affected entities and artifacts.
9. Change planner creates patch plan.
10. Developer reviews plan.
11. Developer runs `arch apply`.
12. Arch validates plan hashes and ownership state.
13. Patch generator applies deterministic changes and invokes agents for bounded tasks.
14. Verifier runs checks.
15. Repair loop attempts bounded fixes if needed.
16. On success, metadata and IR snapshot are promoted.
17. Developer reviews Git diff.
```

### 10.2 Why small changes produce small patches

Small patches are possible because:

```text
- canonical IR stable IDs identify the changed entity
- typed diffs classify the exact intent change
- dependency graph maps changed entities to affected artifacts
- artifact map avoids scanning the whole repo for possible edits
- ownership metadata blocks unrelated or unsafe writes
- agent tasks are file-allowlisted
- patch validation rejects unrelated edits
```

### 10.3 Example: adding a field

Spec change:

```arch
model Post {
  id: uuid primary
  content: string max 5000
  visibility: enum["public", "private", "followers"] default "public"
}
```

Typed diff:

```text
model_field_added
entity: model.Post.field.visibility
parent: model.Post
class: additive
risk: low or medium depending on existing persisted data
```

Affected artifacts:

```text
prisma/schema.prisma
prisma/migrations/*
src/generated/models/post.ts
src/generated/validators/post.ts
src/generated/routes/posts.ts
src/generated/workflows/createPost.ts, if workflow input/output uses Post
tests/generated/post*.test.ts
tests/generated/createPost*.test.ts, if behavior changes
```

Plan actions:

```text
- add Prisma enum or compatible field mapping
- add column migration with default
- update generated Post type
- update validator to accept visibility
- update route/workflow input mapping
- add visibility tests
```

Expected patch size:

```text
Only artifacts that represent `model.Post`, `model.Post.field.visibility`, and dependent workflows/tests are modified.
```

### 10.4 Example: adding a workflow step

Spec change:

```arch
workflow CreatePost {
  steps {
    validate input as Post
    sanitize Post.content as html_safe
    insert Post
    notify mentioned_users via PushProvider best_effort
  }
}
```

Typed diff:

```text
workflow_step_added
entity: workflow.CreatePost.step.notify_mentioned_users
class: additive or modifying
risk: medium if external side effect is introduced
```

Affected artifacts:

```text
src/generated/workflows/createPost.ts
src/generated/integrations/pushProvider.ts, if missing
tests/generated/createPost.notification*.test.ts
```

Plan actions:

```text
- update workflow implementation after insert step
- ensure notification runs outside transaction when required by guarantee
- generate or update integration stub
- add failure behavior tests
```

### 10.5 Example: adding an integration

Spec change:

```arch
integration PushProvider {
  kind: push
  required: false
  failure_policy: best_effort
}
```

Typed diff:

```text
integration_added
entity: integration.PushProvider
class: additive
risk: low unless immediately required by a workflow
```

Affected artifacts:

```text
src/generated/integrations/pushProvider.ts
src/runtime/config.ts
.env.example
tests/generated/integrations/pushProvider.test.ts, if generated
```

Plan actions:

```text
- generate typed interface
- generate provider stub
- update config schema
- add tests or mocks if used by a workflow
```

### 10.6 Example: adding a guarantee

Spec change:

```arch
guarantees {
  notification_failure_does_not_rollback_post
}
```

Typed diff:

```text
guarantee_added
entity: guarantee.notification_failure_does_not_rollback_post
class: additive
risk: medium if existing workflow behavior conflicts
```

Affected artifacts:

```text
src/generated/workflows/createPost.ts, if behavior must change
tests/generated/createPost.notificationFailure.test.ts
.arch/artifact-map.json
.arch/ownership.json
```

Plan actions:

```text
- generate integration test that forces notification failure
- assert post still persists
- statically check notification step is outside transaction when possible
- patch workflow if existing generated code violates guarantee
```

### 10.7 Example: changing a policy

Spec change:

```arch
policy RequireAuthForApi {
  kind: auth
  scope: all api routes
  enforcement: generated_code

  rules {
    auth.required == true
  }
}
```

Typed diff:

```text
policy_changed or policy_added
entity: policy.RequireAuthForApi
class: additive or modifying
risk: medium
```

Affected artifacts:

```text
src/generated/routes/*.ts
src/generated/policies/*.ts
src/runtime/config.ts
tests/generated/auth*.test.ts
```

Plan actions:

```text
- generate route guard or policy helper
- update generated routes
- add auth contract tests
```

### 10.8 Example: changing database provider

Spec change:

```arch
target {
  database: mysql
}
```

V1 result:

```text
target_changed
class: destructive or unsupported
risk: critical
requires confirmation: yes
V1 normal apply: blocked
```

Plan output:

```text
- PostgreSQL is the only V1 supported database.
- This change cannot be applied automatically.
- Existing Prisma schema, migrations, Docker Compose, and generated runtime would need target replacement.
```

---

## 11. Destructive Changes

### 11.1 Destructive change examples

Arch treats these as destructive or potentially destructive:

```text
model removed
field removed
required field removed
persistent field type changed incompatibly
relation removed
workflow removed
workflow step removed when it writes data, enforces safety, or supports a guarantee
integration removed while referenced
policy enforcement weakened
guarantee removed
database provider changed
ORM changed
runtime changed
language changed
```

### 11.2 Risk classification

Risk levels:

| Risk | Meaning | Example | Default apply behavior |
|---|---|---|---|
| `low` | Local generated-code change, low data/API risk | add optional field with default | allowed |
| `medium` | Behavior or schema changes with bounded impact | add required integration step | allowed with clear plan, may warn |
| `high` | Data loss, API breakage, or guarantee risk | remove field, remove workflow | block without confirmation |
| `critical` | Target/runtime architecture change | change database provider | block; V1 may reject |

Change classes:

```text
additive
modifying
destructive
ambiguous
```

### 11.3 Confirmation requirements

Destructive changes require explicit CLI confirmation, for example:

```bash
arch apply --confirm-destructive
```

For critical changes, V1 may require a more specific flag:

```bash
arch apply --confirm-target-rewrite
```

The plan must show:

```text
- exact destructive diff
- files that would be deleted or rewritten
- data that may be dropped
- migration implications
- tests that would be removed
- guarantees that would lose coverage
- rollback recommendation
```

### 11.4 Migration strategy

V1 migration handling is conservative.

Allowed without destructive confirmation:

```text
- create table for added model
- add optional column
- add column with safe default
- add enum with safe default
- add index
```

Requires confirmation:

```text
- drop table
- drop column
- rename without explicit alias/hint
- change type with possible data loss
- add non-null column without default to existing model
- remove enum value
- change relation FK behavior destructively
```

V1 should produce migration scaffolds but should not silently execute destructive database changes.

### 11.5 Rollback considerations

Arch should not claim full rollback of external side effects. For local generated code, rollback options are:

```text
- use Git to revert working tree diff
- use saved run snapshots to inspect before/after files
- use Prisma migration down scripts only when explicitly generated and reviewed
```

For destructive migrations, the plan must warn that database rollback may require manual backup and restore.

### 11.6 Destructive plan output example

```text
Destructive change detected: model_field_removed
Entity: model.Post.field.content
Risk: high

Potential effects:
- Drop column Post.content from PostgreSQL
- Remove field from generated Post type
- Remove validation rules
- Invalidate workflow CreatePost.sanitize_post_content
- Remove or rewrite guarantee no_unsanitized_html_persisted
- Remove generated tests that assert HTML safety

Default action:
- Blocked

Required action:
- Revise spec, or rerun with --confirm-destructive after reviewing migration plan.
```

---

## 12. Artifact Mapping

Artifact mapping is the bridge between IR entities and generated files.

### 12.1 Purpose

Artifact mapping enables:

```text
minimal patches
drift detection
source traceability
ownership enforcement
guarantee-to-test mapping
safe cleanup of removed generated artifacts
```

### 12.2 Example mappings

| IR entity | Generated artifacts |
|---|---|
| `target.primary` | `package.json`, `docker-compose.yml`, `src/runtime/config.ts`, `src/runtime/db.ts`, `src/runtime/cache.ts` when Redis is enabled |
| `model.Post` | `prisma/schema.prisma`, `src/generated/models/post.ts`, `src/generated/validators/post.ts`, `tests/generated/post.model.test.ts` |
| `model.Post.field.visibility` | `prisma/schema.prisma`, `prisma/migrations/*`, `src/generated/models/post.ts`, `src/generated/validators/post.ts`, dependent route/workflow tests |
| `relation.Post.author.User` | `prisma/schema.prisma`, `src/generated/models/post.ts`, `src/generated/validators/post.ts`, tests for relation persistence |
| `workflow.CreatePost` | `src/generated/workflows/createPost.ts`, `src/generated/routes/posts.ts`, `tests/generated/createPost.test.ts` |
| `workflow.CreatePost.trigger.api_post_posts` | `src/generated/routes/posts.ts`, API contract tests |
| `workflow.CreatePost.step.sanitize_post_content` | `src/generated/workflows/createPost.ts`, HTML safety tests |
| `integration.PushProvider` | `src/generated/integrations/pushProvider.ts`, `src/runtime/config.ts`, integration mocks/tests |
| `policy.RequireAuthForApi` | `src/generated/policies/requireAuthForApi.ts`, generated routes, auth tests |
| `guarantee.no_unsanitized_html_persisted` | `tests/generated/createPost.htmlSafety.test.ts`, runtime assertion metadata, workflow implementation |
| `test.create_post_notification_failure_does_not_rollback` | `tests/generated/createPost.notificationFailure.test.ts` |

### 12.3 Artifact map entry

```json
{
  "id": "artifact.src_generated_workflows_createPost_ts",
  "artifact_kind": "workflow",
  "path": "src/generated/workflows/createPost.ts",
  "entity_ids": ["workflow.CreatePost"],
  "ownership_id": "ownership.src_generated_workflows_createPost_ts",
  "generation": {
    "mode": "deterministic_template",
    "generator_id": "arch.templates.typescript.fastify.v1",
    "template_id": "workflow.fastify.v1",
    "ir_fragment_hash": "sha256:..."
  },
  "generated_from_hash": "sha256:...",
  "source_id": "source.generated.artifact.src_generated_workflows_createPost_ts"
}
```

### 12.4 Reverse mapping

The artifact map supports reverse lookup:

```text
src/generated/workflows/createPost.ts
  -> workflow.CreatePost
  -> workflow.CreatePost.step.*
  -> guarantees scoped to workflow.CreatePost
  -> tests generated for workflow.CreatePost
```

This is used when:

```text
- a file drifts
- a verifier failure names a file
- a repair agent needs a bounded context
- a plan needs to explain why a file will be touched
```

### 12.5 Mapping lifecycle

```text
Plan: compute expected artifact impacts.
Apply: create/update artifacts and draft map entries.
Verify: validate artifacts exist and pass checks.
Success: persist artifact-map.json.
Failure: preserve draft in run directory, do not promote.
```

---

## 13. Ownership Model

Ownership prevents Arch from overwriting developer work.

### 13.1 Ownership categories

| Category | Owner | Update policy | Examples |
|---|---|---|---|
| `generated` | Arch | overwrite or patch allowed | `src/generated/models/post.ts`, generated tests |
| `human-owned` | Human | read-only | `src/custom/postRankingStrategy.ts`, custom tests |
| `mixed/generated-region` | Shared file, Arch region | patch only inside markers | generated code inside a file that also has custom code |
| `extension point` | Human after creation | create-only or requires confirmation | custom strategy stubs, integration implementations |
| `external` | Neither Arch nor project source | read-only/reference only | installed dependencies, external services |

Ownership metadata also records `write_scope`: `whole_file` for generated files, `generated_region` for rare generated regions, `stub_only` for extension points, and `none` for human-owned files.

### 13.2 Rules

```text
- Generated files may be updated according to update policy.
- Human-owned files must not be overwritten.
- Generated regions may be updated only inside explicit markers.
- Extension point stubs may be created if missing.
- Extension point stubs must not be overwritten after user edits.
- External files are never modified.
- Any patch operation must pass ownership validation before writing.
```

### 13.3 Generated file headers

Fully generated files should include a header:

```ts
// Generated by Arch. Do not edit directly.
// Source: backend.arch#workflow.CreatePost
// IR: workflow.CreatePost
// Ownership: generated_file
```

The header is advisory. Enforcement depends on `ownership.json` and content hashes, not only comments.

### 13.4 Generated region markers

Generated regions are avoided where possible. If required, use explicit markers:

```ts
// <arch-generated id="post-validator" entity="model.Post">
export const PostInputSchema = z.object({
  content: z.string().max(5000)
})
// </arch-generated>
```

Rules:

```text
- markers must be paired
- region ID must match ownership metadata
- Arch may patch only marker contents
- marker removal is drift
```

### 13.5 Extension points

Arch should prefer extension points over mixed files.

Example source:

```arch
custom PostRankingStrategy {
  kind: function
  input: Post
  file: "src/custom/postRankingStrategy.ts"
  export: "postRankingStrategy"
}
```

Generated workflow imports the extension:

```ts
import { postRankingStrategy } from "../../custom/postRankingStrategy"
```

Arch may create `src/custom/postRankingStrategy.ts` if missing. After creation, if content hash differs from the generated stub hash, the file becomes human-owned and read-only unless the developer explicitly asks Arch to regenerate the stub.

### 13.6 Ownership metadata entry

```json
{
  "id": "ownership.src_custom_postRankingStrategy_ts",
  "path": "src/custom/postRankingStrategy.ts",
  "owner": "human",
  "ownership_kind": "extension_point",
  "update_policy": "create_only",
  "write_scope": "stub_only",
  "entity_ids": ["custom_extension.PostRankingStrategy"],
  "content_hash": "sha256:..."
}
```

### 13.7 Human modification detection

Arch detects manual edits by comparing:

```text
- generated file content hash
- generated region content hash
- extension stub hash
- artifact-map entity hash
- ownership metadata path and region IDs
```

If a generated file was manually edited, `arch check` reports drift. `arch apply` blocks or requires explicit repair strategy rather than overwriting silently.

---

## 14. Generated Project Structure

Recommended V1 structure:

```text
.
├── backend.arch
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── docker-compose.yml
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── generated/
│   │   ├── models/
│   │   ├── validators/
│   │   ├── routes/
│   │   ├── workflows/
│   │   ├── integrations/
│   │   └── policies/
│   ├── custom/
│   │   └── README.md
│   └── runtime/
│       ├── db.ts
│       ├── cache.ts
│       └── config.ts
├── tests/
│   ├── generated/
│   └── custom/
└── .arch/
    ├── ir.previous.json
    ├── ir.current.json
    ├── artifact-map.json
    ├── ownership.json
    ├── source-map.json
    ├── drift.json
    ├── plans/
    ├── runs/
    ├── repair-history/
    ├── locks/
    └── tmp/
```

### 14.1 `src/generated/`

Contains Arch-owned generated implementation:

```text
models/        TypeScript model types and generated DTO helpers
validators/    Zod or equivalent validators derived from models and constraints
routes/        Fastify route registration and handlers
workflows/     workflow implementations derived from ordered steps
integrations/  typed interfaces and generated stubs/mocks
policies/      generated policy enforcement helpers
```

### 14.2 `src/custom/`

Contains developer-owned extension implementations.

Arch may create starter stubs. After user edits, these files are treated as human-owned.

### 14.3 `src/runtime/`

Contains generated runtime support for the chosen target:

```text
db.ts       Prisma client setup
cache.ts    Redis client setup when `cache: redis`; omitted or generated as a no-op boundary when `cache: none` / `cache:none`
config.ts   environment config parsing
```

These are usually generated files, but some may become mixed if V1 chooses to support generated regions. Prefer fully generated runtime files plus custom extension hooks.

### 14.4 `tests/generated/`

Contains Arch-owned tests:

```text
model tests
validator tests
workflow tests
API contract tests
integration stub tests
guarantee tests
latency/load scaffolds when partially verifiable
```

### 14.5 `tests/custom/`

Contains developer-owned tests. Arch may include them in verification but must not overwrite them.

### 14.6 Why this structure supports safe sync

```text
- generated files are isolated under `src/generated` and `tests/generated`
- custom code is isolated under `src/custom` and `tests/custom`
- runtime infrastructure is separated from workflow logic
- artifact map can target predictable paths
- ownership boundaries are visible in the repo tree
- minimal patches can avoid human-owned code
```

---

## 15. Agent Orchestration

### 15.1 Agent task contract

Every agent task uses a typed contract.

```json
{
  "schema_version": "arch.agent_task.v1",
  "task_id": "task.workflow.CreatePost.visibility",
  "agent": "WorkflowAgent",
  "diffs": ["diff.model.Post.field.visibility.added"],
  "ir_fragments": ["model.Post", "workflow.CreatePost"],
  "allowed_files": [
    "src/generated/workflows/createPost.ts",
    "tests/generated/createPost.visibility.test.ts"
  ],
  "forbidden_files": ["src/custom/**", "tests/custom/**"],
  "ownership_rules": ["generated files only"],
  "acceptance_criteria": [
    "preserve existing CreatePost behavior",
    "validate visibility input",
    "generated tests must pass"
  ],
  "output_format": "arch.patch.v1"
}
```

Agents receive:

```text
- typed diffs
- relevant IR fragments
- current allowed file contents
- affected artifact list
- ownership rules
- expected tests
- verification constraints
- output schema
```

Agents do not receive:

```text
- authority to edit arbitrary files
- full repo write permissions
- vague product requirements
- permission to invent unsupported architecture
```

### 15.2 Agent output contract

Agents must return structured patch operations or bounded unified diffs.

They must also return a summary:

```json
{
  "schema_version": "arch.patch.v1",
  "task_id": "task.workflow.CreatePost.visibility",
  "operations": [],
  "summary": "Updated CreatePost workflow to pass visibility through validated input.",
  "assumptions": [],
  "requires_followup": []
}
```

Any prose outside the schema is ignored or rejected.

### 15.3 Schema Agent

Responsibility:

```text
- update Prisma schema for model, field, relation, and enum changes
- create safe migration scaffolds
- update generated model types when deterministic templates are insufficient
```

Input contract:

```text
- model/relation diffs
- relevant ModelIR, FieldIR, RelationIR
- current prisma/schema.prisma
- migration policy
- allowed files
```

Output contract:

```text
- structured file operations for Prisma schema
- migration file creation or migration scaffold
- summary of migration risk
```

Allowed files:

```text
prisma/schema.prisma
prisma/migrations/**
src/generated/models/**
```

Forbidden files:

```text
src/custom/**
tests/custom/**
workflow files unless explicitly included
```

Constraints:

```text
- no destructive migrations without confirmation
- preserve existing schema entities not in diff
- do not change database provider
- emit valid Prisma syntax
```

Validation:

```text
- Prisma schema validation
- migration validation
- TypeScript typecheck for generated model files
```

Failure handling:

```text
- reject patch if destructive without plan approval
- repair with Schema Agent only on schema/migration failures
```

### 15.4 API Agent

Responsibility:

```text
- update Fastify route handlers and registration
- adapt request/response wiring
- enforce route-level policies
- update API contract tests when needed
```

Input contract:

```text
- workflow trigger diffs
- policy diffs affecting routes
- route artifacts
- validators and workflow interfaces
```

Output contract:

```text
- route file patch operations
- generated API contract test updates when included
```

Allowed files:

```text
src/generated/routes/**
src/generated/policies/**
tests/generated/**/*contract*.test.ts
tests/generated/**/*auth*.test.ts
```

Forbidden files:

```text
src/custom/**
src/runtime/db.ts unless explicitly included
tests/custom/**
```

Constraints:

```text
- no unrelated route rewrites
- preserve existing route method/path contracts unless diff changes them
- use generated validators and workflow functions
```

Validation:

```text
- TypeScript typecheck
- API contract tests
- policy tests
```

Failure handling:

```text
- route patch rejected if method/path changes without matching trigger diff
```

### 15.5 Workflow Agent

Responsibility:

```text
- synthesize workflow step implementation
- adapt generated workflow code to step, guarantee, and policy diffs
- preserve transaction and failure behavior
```

Input contract:

```text
- workflow diffs
- StepIR list with order
- guarantee and policy scope
- integration interfaces
- current workflow file
```

Output contract:

```text
- workflow file patch operations
- optional generated helper updates when allowlisted
```

Allowed files:

```text
src/generated/workflows/**
src/generated/policies/** when policy-scoped
tests/generated/**/*workflow*.test.ts when included
```

Forbidden files:

```text
src/custom/**
prisma/** unless schema task explicitly includes it
```

Constraints:

```text
- preserve workflow step order
- preserve declared transaction boundaries
- preserve declared failure behavior
- do not place best-effort notifications inside transaction when guarantee forbids rollback
- call custom extension points through generated typed boundary
```

Validation:

```text
- typecheck
- workflow tests
- guarantee tests
- static drift checks for supported guarantees
```

Failure handling:

```text
- repair task includes exact failing test/typecheck output and only workflow-related allowlist
```

### 15.6 Integration Agent

Responsibility:

```text
- generate or update typed integration interfaces and stubs
- update generated mocks for tests
- update config schema for integration requirements
```

Input contract:

```text
- IntegrationIR diffs
- workflow steps using integrations
- config schema
- failure policy
```

Output contract:

```text
- integration stub file operations
- test mock updates
- config updates when allowlisted
```

Allowed files:

```text
src/generated/integrations/**
src/runtime/config.ts
tests/generated/**/mocks/**
tests/generated/**/*integration*.test.ts
```

Forbidden files:

```text
src/custom/** unless creating a declared extension stub and file is missing
```

Constraints:

```text
- never place secret values in source
- generate config schema, not config secrets
- failure policy must match IR
```

Validation:

```text
- typecheck
- integration tests
- config parser tests
```

Failure handling:

```text
- missing provider-specific details become explicit custom extension requirements, not invented SDK code
```

### 15.7 Test Agent

Responsibility:

```text
- generate tests from structured models, workflows, policies, and guarantees
- update tests after spec diffs
- ensure guarantee tests map to GuaranteeIR and TestIR
```

Input contract:

```text
- TestIR expectations
- GuaranteeIR verification strategies
- model/workflow artifacts
- fixtures
```

Output contract:

```text
- generated test file operations
- fixture updates
- coverage mapping updates when included
```

Allowed files:

```text
tests/generated/**
```

Forbidden files:

```text
tests/custom/**
src/custom/**
```

Constraints:

```text
- tests must be deterministic
- test names must map to TestIR IDs
- partially verifiable guarantees must be labeled as such
- unsupported guarantees must not get fake tests that claim full proof
```

Validation:

```text
- Vitest execution
- guarantee coverage check
```

Failure handling:

```text
- invalid tests are repaired through Test Agent or Repair Agent with generated-test allowlist
```

### 15.8 Repair Agent

Responsibility:

```text
- patch generated code to fix verification failures
- preserve original plan intent
- avoid unrelated edits
```

Input contract:

```text
- verification failure classification
- failing command output
- original typed diff and plan
- allowed files derived from failing artifacts
- current file contents
```

Output contract:

```text
- minimal structured patch operations
- explanation of failure cause
```

Allowed files:

```text
Only files related to failing verification and original plan.
```

Forbidden files:

```text
human-owned files
unrelated generated files
destructive migrations unless already confirmed
```

Constraints:

```text
- max 3 attempts by default
- no new architecture decisions
- no destructive changes
- no unrelated edits
```

Validation:

```text
- patch schema validation
- ownership validation
- rerun failing verifier stage
- rerun full verifier on final attempt or after targeted pass
```

Failure handling:

```text
- unresolved final report with failure logs and suggested manual next step
```

---

## 16. Patch Format

### 16.1 V1 patch strategy

V1 uses a hybrid patch format:

```text
- structured file operations for generated files
- full file replacement for fully generated files only
- bounded unified diffs for generated regions or small generated edits
- no direct writes to human-owned files
```

AST-level patches are not required for V1, though deterministic generators may internally use AST manipulation for TypeScript or Prisma.

### 16.2 Structured patch schema

```json
{
  "schema_version": "arch.patch.v1",
  "plan_id": "plan.2026-05-03.visibility",
  "operations": [
    {
      "op": "replace_file",
      "path": "src/generated/models/post.ts",
      "ownership": "generated_file",
      "entity_ids": ["model.Post"],
      "content": "..."
    },
    {
      "op": "create_file",
      "path": "tests/generated/createPost.visibility.test.ts",
      "ownership": "generated_file",
      "entity_ids": ["test.create_post_visibility"],
      "content": "..."
    },
    {
      "op": "apply_unified_diff",
      "path": "src/generated/workflows/createPost.ts",
      "ownership": "generated_file",
      "entity_ids": ["workflow.CreatePost"],
      "diff": "@@ ..."
    }
  ]
}
```

### 16.3 Supported operations

| Operation | Allowed for | Notes |
|---|---|---|
| `create_file` | generated files, missing extension stubs | extension stubs become create-only |
| `replace_file` | fully generated files | rejected for human-owned files |
| `apply_unified_diff` | generated files or generated regions | must apply cleanly and stay in allowlist |
| `replace_region` | generated regions only | requires valid region markers |
| `delete_file` | generated files only | destructive when tied to removed entity; requires plan approval |
| `move_file` | generated files only | V1 should avoid except rename-confirmed cases |

### 16.4 Patch validation

Before any operation writes to disk, Arch validates:

```text
- patch schema is valid
- path is repository-relative
- path is in plan allowlist
- path is not in forbidden list
- ownership policy allows operation
- generated region markers exist if region operation
- entity IDs exist in current IR or approved removal set
- operation corresponds to planned diff
- no unrelated files are modified
- resulting syntax is valid where parser is available
- generated file hashes are updated only after verification success
```

### 16.5 Full file replacement rules

Full file replacement is allowed only when:

```text
- file is fully generated
- ownership update policy permits overwrite
- file path is allowlisted
- replacement content is generated from relevant IR fragment
- verifier accepts result
```

Full file replacement is forbidden for:

```text
- human-owned files
- custom extension implementations
- mixed files outside generated regions
- external files
```

### 16.6 Rejected patch examples

Rejected:

```text
Agent changes src/custom/postRankingStrategy.ts.
Reason: human-owned extension point.
```

Rejected:

```text
Agent modifies package.json while applying model_field_added.
Reason: package manifest not in affected artifacts.
```

Rejected:

```text
Agent deletes tests/generated/createPost.htmlSafety.test.ts after guarantee remains declared.
Reason: guarantee test missing and unrelated deletion.
```

---

## 17. Verification Model

### 17.1 Verifier pipeline

V1 verifier stages:

```text
1. Preflight
2. Dependency install check
3. Generated artifact and ownership check
4. Prisma generate
5. Migration validation
6. TypeScript typecheck
7. Lint, if configured
8. Unit tests
9. Integration tests
10. Generated guarantee tests
11. Drift checks
12. Verification report
```

### 17.2 Preflight

Checks:

```text
- package manager available
- Node version compatible
- Docker available when integration tests require services
- required files exist
- metadata files parse
- plan hashes still match
```

### 17.3 Dependency install

If dependencies are missing or lockfile changed:

```bash
pnpm install --frozen-lockfile
```

For initial generation, `pnpm install` may run without `--frozen-lockfile` if lockfile does not exist, then generated lockfile becomes part of the diff.

### 17.4 Artifact and ownership check

Checks:

```text
- all artifacts in artifact map exist unless planned for creation/deletion
- generated file hashes match or drift is acknowledged in plan
- generated regions are intact
- human-owned files are untouched by patch
```

### 17.5 Prisma generate

Command:

```bash
pnpm prisma generate
```

Checks:

```text
- Prisma schema parses
- generated Prisma client can be produced
```

### 17.6 Migration validation

V1 should validate migration safety before execution.

Possible commands:

```bash
pnpm prisma migrate diff
pnpm prisma migrate dev --create-only
```

V1 local apply may create migrations but should not silently apply destructive migrations to a developer database without explicit command behavior.

### 17.7 Typecheck

Command:

```bash
pnpm typecheck
```

Checks:

```text
- generated TypeScript compiles
- route/workflow interfaces align
- integration stubs implement required interfaces
```

### 17.8 Lint

Command:

```bash
pnpm lint
```

Lint is required only when lint config is generated or declared in verification config. If no lint config exists, verifier records lint as `not_configured` rather than failing.

### 17.9 Unit tests

Command:

```bash
pnpm test:unit
```

or, if V1 uses one test command:

```bash
pnpm test
```

Generated unit tests cover validators, pure helpers, policies, and small workflow units.

### 17.10 Integration tests

Command:

```bash
pnpm test:integration
```

Integration tests may require Docker Compose services:

```bash
docker compose up -d postgres redis
# with cache: none
docker compose up -d postgres
```

Redis is included only when the target uses Redis. With `cache: none` / `cache:none`, integration tests should start PostgreSQL without Redis unless a declared custom extension requires it. V1 should keep this local and explicit.

### 17.11 Generated guarantee tests

Guarantee tests are generated from `GuaranteeIR` and `TestIR`.

Examples:

```text
no_unsanitized_html_persisted
  -> submit unsafe HTML
  -> verify persisted field is sanitized

notification_failure_does_not_rollback_post
  -> mock PushProvider failure
  -> call CreatePost
  -> verify Post exists

post_creation_p95_latency <= 200ms
  -> generate load scaffold
  -> mark partially verifiable locally
```

### 17.12 Pass/fail behavior

Verification passes only if all required stages pass.

Stage statuses:

```text
passed
failed
skipped
not_configured
```

A skipped required stage fails verification. A non-required stage may be reported as skipped.

Guarantee coverage statuses:

```text
covered
partially_covered
manual
missing
```

`unsupported` is diagnostics-only in V1 and is rejected during normal apply. `missing` fails validation or planning for testable guarantees.

### 17.13 Verification report

Report fields:

```json
{
  "schema_version": "arch.verification_report.v1",
  "run_id": "run.2026-05-03T10-00-00Z",
  "plan_id": "plan.visibility",
  "status": "failed",
  "stages": [
    {
      "name": "typecheck",
      "command": "pnpm typecheck",
      "status": "failed",
      "exit_code": 2,
      "summary": "Type mismatch in createPost workflow",
      "affected_files": ["src/generated/workflows/createPost.ts"]
    }
  ],
  "guarantee_coverage": [],
  "drift": [],
  "repair_attempts": 1
}
```

Human-readable report should include:

```text
- command status table
- failing files
- failing tests
- related IR entities
- related spec source locations
- whether repair was attempted
- final unresolved actions
```

---

## 18. Repair Loop

### 18.1 Repair flow

```text
verification failure
   ↓
failure classification
   ↓
repair plan
   ↓
repair agent or deterministic fix
   ↓
patch validation
   ↓
rerun targeted verification
   ↓
rerun full verification if targeted checks pass
```

### 18.2 Failure classification

Classes:

```text
syntax_error
type_error
prisma_schema_error
migration_error
lint_error
unit_test_failure
integration_test_failure
guarantee_test_failure
ownership_violation
drift_violation
missing_dependency
unsupported_behavior
```

### 18.3 Repair plan

A repair plan includes:

```text
- failure class
- related IR entities
- related files
- allowed files
- forbidden files
- original plan ID
- acceptance criteria
- max attempt count
```

### 18.4 Constraints

Repair loop constraints:

```text
- default maximum attempts: 3
- no destructive changes
- no unrelated files
- no human-owned files
- no broad regeneration unless file is fully generated and allowlisted
- preserve original plan intent
- every repair patch must be validated
```

### 18.5 Targeted reruns

After a repair patch, Arch may rerun the smallest relevant verification stage first:

```text
- typecheck for type errors
- Prisma validation for schema errors
- specific Vitest file for test failures
```

Before final success, Arch must run the full required verifier pipeline.

### 18.6 Unresolved repair

If repair fails after max attempts:

```text
- leave working tree for inspection unless rollback requested
- do not promote IR or metadata
- write final unresolved report
- identify failing checks and files
- include exact allowed manual next steps
```

### 18.7 Repair must not hide failures

Arch must not delete failing tests, weaken guarantees, loosen policies, or remove verification stages to make the build pass unless those changes are explicitly present in the spec diff and plan.

---

## 19. Drift Detection

### 19.1 Drift categories

V1 drift detection should report:

```text
generated file modified manually
generated region changed manually
artifact missing
artifact no longer matches IR hash
guarantee test missing
obvious guarantee violation
ownership metadata mismatch
artifact map mismatch
source map mismatch
extension point overwritten by Arch or targeted incorrectly
```

### 19.2 Generated file drift

If `ownership.json` records:

```text
src/generated/workflows/createPost.ts -> sha256:abc
```

and current file hash is different outside an active plan, `arch check` reports:

```text
Drift: generated_file_modified
File: src/generated/workflows/createPost.ts
Entity: workflow.CreatePost
Action: restore, accept as generated baseline, or repair from spec
```

V1 should not automatically accept manual edits to generated files.

### 19.3 Generated region drift

For mixed files, Arch hashes only region contents. Marker removal or changed region contents are drift.

### 19.4 Missing artifact drift

If an artifact map entry exists but file is missing:

```text
Drift: artifact_missing
Path: tests/generated/createPost.htmlSafety.test.ts
Entity: test.create_post_no_unsanitized_html_persisted
```

### 19.5 Guarantee test drift

If a testable guarantee exists but no generated test maps to it:

```text
Drift: guarantee_test_missing
Guarantee: guarantee.no_unsanitized_html_persisted
Expected test: test.create_post_no_unsanitized_html_persisted
```

### 19.6 Obvious guarantee violation

V1 supports limited static pattern checks for certain guarantees.

Example guarantee:

```arch
guarantees {
  notification_failure_does_not_rollback_post
}
```

Spec intent:

```text
Push notification failure must not rollback persisted post creation.
```

Obvious violating generated code pattern:

```ts
await prisma.$transaction(async tx => {
  const post = await tx.post.create(...)
  await pushProvider.notify(...)
  return post
})
```

V1 drift detector can flag this when:

```text
- workflow has insert_model step for Post
- workflow has notify_users step using PushProvider
- guarantee requires notification failure not to rollback Post
- generated code awaits notification inside Prisma transaction callback
```

Report:

```text
Drift detected:
- Guarantee: notification_failure_does_not_rollback_post
- File: src/generated/workflows/createPost.ts
- Issue: notification appears awaited inside transaction after Post insert
- Suggested repair: dispatch notification after transaction commit or through generated best-effort queue boundary
```

### 19.7 What V1 can detect

V1 can detect:

```text
- file and region hash drift
- missing generated artifacts
- missing guarantee tests
- ownership metadata mismatches
- some static guarantee patterns
- failed generated tests that represent declared guarantees
- policy/guarantee conflicts visible in IR
```

### 19.8 What V1 cannot fully detect

V1 cannot fully prove:

```text
- arbitrary semantic equivalence between code and spec
- production latency guarantees
- behavior inside human-owned extension code
- external provider reliability
- distributed transaction correctness
- all security properties
- all possible guarantee violations in arbitrary custom code
```

When a guarantee is only partially verifiable, runtime-only, or manual, Arch must say so explicitly. Unsupported guarantees are diagnostics-only and must be rejected in normal V1 apply.

---

## 20. Guarantee-to-Test Pipeline

Guarantees are first-class behavior contracts. They must map to tests, static checks, runtime assertions, manual review, or explicit coverage gaps. Unsupported guarantee handling is diagnostics-only in V1 and must not be treated as an implementation task.

### 20.1 Pipeline

```text
guarantee declaration
   ↓
parse guarantee pattern or long-form predicate
   ↓
GuaranteeIR
   ↓
verifiability classification
   ↓
TestIR and/or runtime assertion metadata
   ↓
artifact mapping
   ↓
Test Agent or deterministic test generator
   ↓
generated test file
   ↓
verification report coverage
```

### 20.2 Verifiability levels

V1 user-facing levels:

| Level | Meaning | Coverage status |
|---|---|---|
| `verifiable` | Arch can generate a local deterministic test or static check with meaningful coverage | `covered` |
| `partially_verifiable` | Arch can generate a scaffold or partial local check but cannot prove full behavior | `partially_covered` |
| `runtime_only` | Behavior can be asserted at runtime but not fully tested locally | `covered` or `partially_covered`, with limitations |
| `manual` | Developer must review or validate outside generated checks | `manual` |
| `missing` | A testable guarantee lacks required generated or declared coverage | `missing`; validation or planning fails |

`unsupported` is not a normal coverage status for V1 apply. It may appear only in diagnostics-only output.

### 20.3 Example: HTML safety

Source:

```arch
guarantees {
  no_unsanitized_html_persisted
}
```

Pipeline:

```text
no_unsanitized_html_persisted
   ↓
GuaranteeIR category: security_safety
   ↓
predicate: persisted(Post.content) satisfies html_safe
   ↓
verifiability: verifiable/testable
   ↓
TestIR: create_post_no_unsanitized_html_persisted
   ↓
tests/generated/createPost.htmlSafety.test.ts
```

Generated test behavior:

```text
- send unsafe HTML in CreatePost request
- run workflow/API handler
- read persisted Post content
- assert persisted value is sanitized
```

### 20.4 Example: notification failure does not rollback

Source:

```arch
guarantees {
  notification_failure_does_not_rollback_post
}
```

Pipeline:

```text
guarantee pattern
   ↓
scope: CreatePost insert Post + notify step + PushProvider
   ↓
integration test with failing PushProvider mock
   ↓
assert Post exists after notification failure
```

### 20.5 Example: latency

Source:

```arch
guarantees {
  post_creation_p95_latency <= 200ms
}
```

Pipeline:

```text
latency threshold
   ↓
load-test scaffold
   ↓
partially_verifiable
   ↓
verification report states local limitation
```

Arch must not claim local tests prove production p95 latency.

### 20.6 Unsupported guarantee handling

Unknown short-form guarantee:

```arch
guarantees {
  users_should_probably_like_the_feed
}
```

V1 behavior:

```text
- reject during semantic validation
- suggest long-form guarantee with scope, category, predicate, verification strategy
- if the long-form guarantee is explicitly manual or partially verifiable, represent that status with limitations
- if it remains unsupported, report diagnostics and block normal apply
```

---

## 21. Git Interaction

### 21.1 Working tree policy

V1 should prefer a clean working tree before `arch apply`.

Recommended behavior:

```text
- `arch plan` may run on dirty tree because it does not write implementation files.
- `arch apply` warns or blocks when unrelated uncommitted changes exist.
- If affected files are dirty, apply blocks unless `--allow-dirty` is provided.
- Human-owned dirty files are never overwritten.
```

### 21.2 Diff output

After apply, Arch prints:

```text
- files created
- files modified
- files deleted
- generated tests added
- migrations added
- verification status
- risk/destructive summary
```

Arch should leave a normal local Git diff for developer review.

### 21.3 Commit and branch behavior

V1 default:

```text
- do not auto-commit
- do not automatically create a PR
- optionally create a branch if user passes a flag
```

Possible flags:

```bash
arch apply --branch arch/add-post-visibility
arch apply --commit
```

If `--commit` is supported in V1, it should commit only after verification passes and should include plan ID and IR hashes in commit message.

### 21.4 PR behavior

Automatic PR creation is not required for V1. Future versions may add:

```text
arch apply --create-pr
```

V1 should focus on producing a clean local diff.

---

## 22. CLI Command Behavior

### 22.1 `arch init`

Creates project scaffolding and metadata directories.

Expected behavior:

```text
- create backend.arch starter if missing
- create .arch directories
- create src/custom/README.md if project scaffold requested
- do not overwrite existing files
```

### 22.2 `arch parse backend.arch`

Parses and validates the spec.

Expected behavior:

```text
- validate syntax
- build draft semantic model or draft IR
- validate semantics
- emit AST optionally with --emit-ast
- emit canonical IR optionally with --emit-ir only after semantic and IR schema validation pass
- report source-location errors
```

### 22.3 `arch plan`

Creates a sync plan.

Expected behavior:

```text
- compile current spec through draft model, semantic validation, canonical IR, and IR schema validation
- load previous IR if present
- compute typed intent diff
- build dependency graph
- classify risk
- identify affected artifacts
- identify ownership conflicts
- identify generated tests
- identify destructive changes
- write plan JSON and summary
```

### 22.4 `arch apply`

Applies a plan.

Expected behavior:

```text
- recompile spec through schema-valid canonical IR and validate hashes
- verify baseline hash still matches plan
- check ownership and drift before writing
- apply deterministic operations
- invoke constrained agents for bounded tasks
- validate patches
- run verifier
- run repair loop if configured
- promote metadata on success
- print final diff summary
```

### 22.5 `arch check`

Checks conformance without applying new generated changes.

Expected behavior:

```text
- compile current spec through schema-valid canonical IR
- compare to baseline
- inspect generated artifacts and ownership
- run selected verification checks
- detect drift
- report guarantee coverage
```

### 22.6 `arch repair`

Attempts to repair failed checks.

Expected behavior:

```text
- load latest failed verification or drift report
- create repair plan
- enforce allowlist and ownership rules
- invoke Repair Agent or deterministic fixer
- rerun verification
- stop after bounded attempts
- do not broaden the original plan, weaken guarantees, touch human-owned files, or promote metadata unless verification passes
```

---

## 23. Failure Modes and Handling

| Failure mode | Where detected | Handling |
|---|---|---|
| Invalid spec syntax | Parser | Print source error, stop before IR generation |
| Invalid semantic reference | Semantic validator | Print referenced entity and source location, stop |
| Unsupported feature | Semantic validator | Print V1 limitation and suggested supported alternative, stop |
| Unknown guarantee | Guarantee validator | Require supported pattern or long-form guarantee, stop |
| Ambiguous diff | Diff engine | Emit ambiguity diagnostic, require rename hint or developer decision |
| Destructive change | Diff engine / planner | Block apply unless explicit confirmation provided |
| Missing integration | Semantic validator / planner | Stop; require declared integration or custom extension |
| Human-owned file conflict | Ownership manager | Reject patch; print file, owner, attempted operation |
| Generated file drift | Drift detector / apply preflight | Block apply or require explicit drift resolution |
| Artifact missing | Drift detector | Report missing artifact; repair may regenerate if generated |
| Agent output invalid | Patch generator | Reject output; retry task or fail plan |
| Patch rejected | Patch validator | Print rejected operation and reason; no metadata promotion |
| Prisma schema invalid | Verifier | Run repair if generated files allowlisted; otherwise fail |
| Migration conflict | Verifier | Block destructive execution; require developer review |
| Typecheck failed | Verifier | Classify errors, run bounded repair |
| Tests failed | Verifier | Classify failing tests, run bounded repair |
| Guarantee test failed | Verifier | Treat as behavior failure; repair generated workflow/tests only when appropriate |
| Repair failed | Repair loop | Stop after max attempts; preserve report; do not promote metadata |
| Missing dependency | Verifier preflight | Run install if allowed; otherwise fail with command hint |
| Git dirty conflict | CLI preflight | Warn or block depending on affected files and flags |
| Metadata corrupt | Snapshot store | Stop; require metadata repair or restore from Git |
| Plan stale | Apply preflight | Re-run plan because IR hash or baseline hash changed |

---

## 24. V1 Limitations

V1 does not provide:

```text
full formal verification
arbitrary application generation
frontend generation
multi-agent autonomous runtime
production cloud deployment
Kubernetes support
multiple backend languages
multiple backend frameworks
arbitrary legacy repo editing
automatic destructive migrations
complete semantic drift detection for arbitrary TypeScript
proof of production latency or external service behavior
```

V1 can provide:

```text
canonical typed intent
stable IR diffs
safe generated-code ownership boundaries
minimal patch planning for supported changes
bounded LLM-assisted implementation
local verification
generated tests from structured guarantees
limited drift detection
bounded repair loop
reviewable Git diffs
```

---

## 25. Open Questions

These decisions should be finalized before production implementation.

### 25.1 Parser implementation

Options:

```text
- hand-written recursive descent parser
- PEG parser
- Tree-sitter grammar
```

Recommendation:

```text
Use a parser technology that preserves precise source spans and can produce useful diagnostics. Tree-sitter may be useful later for editor tooling, but a hand-written or PEG parser may be faster for V1.
```

### 25.2 Code generation templates

Open questions:

```text
- Should V1 use deterministic templates for most generated files and agents only for workflows/tests?
- Should templates be embedded in the CLI or external versioned assets?
- How are template versions recorded in artifact metadata?
```

Recommendation:

```text
Use deterministic templates wherever practical. Record generator version and IR fragment hash in artifact metadata.
```

### 25.3 Migration execution policy

Open questions:

```text
- Should `arch apply` create migrations only, or also run them locally?
- Should destructive migrations always be manual?
- Should local test databases use reset flows independent of developer databases?
```

Recommendation:

```text
V1 should create or validate migration scaffolds and use isolated test databases for verification. Destructive migrations require explicit confirmation and should not be silently applied.
```

### 25.4 LLM provider abstraction

Open questions:

```text
- Single provider or pluggable providers?
- How are model/version choices recorded in run metadata?
- What context limits and retry policies are used?
```

Recommendation:

```text
Keep provider abstraction simple. Record provider, model, and task hash in run metadata. Do not make provider flexibility a core V1 feature.
```

### 25.5 Generated region usage

Open questions:

```text
- Should V1 avoid mixed files entirely?
- Are generated regions needed in package.json, app.ts, or route registration?
```

Recommendation:

```text
Prefer fully generated files plus human-owned extension points. Use generated regions only when unavoidable.
```

### 25.6 Guarantee language coverage

Open questions:

```text
- Which short-form guarantees are supported in V1?
- Which static patterns are safe enough for drift detection?
- How should custom guarantees be represented without overpromising verification?
```

Recommendation:

```text
Start with a small guarantee catalog: HTML safety, notification failure non-rollback, moderation before persistence, auth-required, audit-log for LLM moderation, and latency scaffold. Mark limitations explicitly.
```

### 25.7 Metadata versioning

Open questions:

```text
- How are `.arch/` metadata schema migrations handled?
- Can old plans be replayed after compiler upgrades?
```

Recommendation:

```text
Version every metadata file. Plans are valid only for the compiler and IR schema version that produced them unless a migration tool updates them.
```

---

## 26. Implementation Milestones

### Milestone 1: Parser and IR

Deliverables:

```text
- `.arch` parser
- AST builder
- semantic validator
- canonical IR generator
- source map
- IR schema validation
```

### Milestone 2: Initial deterministic generator

Deliverables:

```text
- Fastify project scaffold
- Prisma schema generation
- runtime config
- generated models and validators
- route and workflow templates
- integration stubs
- generated tests
- Docker Compose
```

### Milestone 3: Snapshot, diff, and plan

Deliverables:

```text
- IR snapshot store
- typed diff engine
- dependency graph
- artifact map
- ownership map
- human-readable plan output
```

### Milestone 4: Incremental apply

Supported changes:

```text
- add model
- add model field
- add relation
- add workflow
- add workflow step
- add integration stub
- add guarantee
- add generated test
```

Deliverables:

```text
- patch format
- patch validation
- deterministic updates
- bounded agent tasks
```

### Milestone 5: Verification and repair

Deliverables:

```text
- verifier pipeline
- verification reports
- failure classifier
- repair agent task contract
- bounded repair loop
```

### Milestone 6: Drift detection

Deliverables:

```text
- generated file hash checks
- generated region checks
- missing artifact checks
- guarantee test coverage checks
- at least one static guarantee drift detector
```

---

## 27. Summary

Arch V1 is a compiler-oriented devtool for synchronizing generated TypeScript backend services from structured intent.

The architecture depends on a strict separation:

```text
Deterministic compiler:
  parse, validate, canonicalize, diff, plan, map, enforce ownership, verify

Constrained agents:
  synthesize bounded implementation and tests from typed tasks

Verifier:
  decide whether generated code satisfies the declared contract
```

The result is not “AI updates the code.” The result is:

```text
Arch detected these intent changes.
Arch mapped them to these artifacts.
Arch planned these edits.
Arch constrained agents to these files.
Arch generated or patched this code.
Arch generated these tests.
Arch verified these guarantees.
Arch produced this reviewable diff.
```

That is the V1 architecture required to make AI-generated backend code durable, synchronized, inspectable, and repairable.
