# IMPLEMENTATION_PLAN.md

# Arch Implementation Plan

**Status:** V1 build roadmap  
**Scope:** first working prototype through V1  
**Primary source file:** `backend.arch`  
**Canonical compiler boundary:** `arch.ir.v1`  
**Default generated backend stack:** TypeScript, Node.js, Fastify, PostgreSQL, Prisma, Redis by default or `cache: none` / `cache:none`, Vitest, Docker Compose, pnpm
**Recommended Arch implementation stack:** TypeScript, Node.js, pnpm workspace

---

## 1. Objective

This plan turns the Arch specification pack into an executable engineering roadmap.

Arch is a spec-to-code synchronization system for AI-generated TypeScript backend workflow services. In V1, `backend.arch` is the source of truth and generated implementation code is an inspectable build artifact for one generated backend service.

Arch V1 should prove one narrow but meaningful loop:

```text
backend.arch
   ↓
parse
   ↓
canonical IR v1
   ↓
generate backend project
   ↓
run tests
   ↓
developer edits backend.arch
   ↓
canonical IR v2
   ↓
compute typed diff
   ↓
produce sync plan
   ↓
apply minimal patch
   ↓
run verification
```

The first working prototype should demonstrate that a structured system spec can generate a real backend service and then incrementally patch that service after a small intent change without regenerating the entire codebase.

The V1 release should demonstrate that the same workflow is reliable enough for a small backend workflow service, including metadata persistence, ownership protection, generated tests, limited drift detection, and a bounded repair path.

---

## 2. Product Cutline

### 2.1 V1 will build

V1 builds one CLI-driven local developer tool that supports:

```text
- one backend.arch source file
- one generated backend service per project
- TypeScript Arch CLI/compiler implementation
- TypeScript/Node/Fastify generated backend projects
- PostgreSQL with Prisma
- Redis by default or cache:none / cache: none
- Vitest generated tests
- Docker Compose local runtime
- pnpm package management
- canonical arch.ir.v1 generation
- typed IR diffs
- sync plans
- deterministic generated code templates
- constrained patch-task interface for LLM-assisted or deterministic agents
- generated/human ownership metadata
- generated guarantee tests for supported guarantee patterns
- local verification
- limited drift detection
- bounded repair attempts
```

### 2.2 First prototype cutline

The first working prototype should be narrower than V1:

```text
- parse one SocialFeed-style backend.arch file
- compile to canonical IR
- generate a backend project from scratch
- generate Prisma schema, Fastify route, workflow implementation, integration stubs, and Vitest tests
- run generated typecheck/tests
- modify the spec by adding Post.visibility
- compute model_field_added(Post.visibility)
- produce a readable sync plan
- patch only affected generated files
- run verification again
```

The prototype does not need full LLM integration. It should implement the agent task protocol and use deterministic template patching or a deterministic mock agent for the first field-addition vertical slice.

### 2.3 V1 will not build

V1 deliberately excludes:

```text
- frontend generation
- mobile apps
- multiple backend languages
- backend frameworks other than Fastify
- databases other than PostgreSQL
- ORMs other than Prisma
- arbitrary legacy repository synchronization
- multi-service orchestration
- Kubernetes or production cloud deployment automation
- production OAuth provider completeness
- complex event streaming
- complex distributed transactions
- implicit many-to-many relations
- advanced formal verification
- proof of production latency or external service behavior
- automatic destructive migrations
- unconstrained autonomous agents
- full-codebase rewrites after spec changes
- hidden no-code runtime behavior
```

---

## 3. Source Spec Reconciliation

The source documents are consistent on the main architecture, but a few details need explicit implementation choices.

### 3.1 Semantic validation and IR generation order

The final specification pack requires semantic validation before canonical IR is accepted.

**V1 implementation invariant:**

```text
Parser
  → AST
  → draft semantic model / draft IR
  → semantic validation
  → canonical IR
  → IR schema validation
```

The full implementation pipeline is:

```text
Parser -> AST -> draft semantic model/draft IR -> semantic validation -> canonical IR -> IR schema validation -> IR snapshot store -> typed diff -> dependency graph -> sync plan -> deterministic templates/constrained agents -> verification -> metadata promotion
```

Rationale:

```text
- The parser should not need to resolve references.
- The draft model gives validation a typed structure to inspect.
- Canonical IR should only be emitted after unsupported constructs and unresolved references are rejected.
- The final canonical IR must be valid, deterministic, and hashable.
```

### 3.2 Agents versus deterministic templates

The product requires constrained patch agents, but the safest build order is deterministic first.

**V1 implementation decision:**

```text
- Build templates and deterministic patch operations first.
- Build an agent task protocol early.
- Use a deterministic mock agent in tests.
- Add real LLM-provider integration only after deterministic patching, patch validation, ownership/write_scope enforcement, and verification are stable.
```

The agent must never parse `.arch`, decide semantic diffs, create sync plans from scratch, bypass ownership/write_scope checks, modify human-owned files, weaken guarantees, or mark verification passed. Agents can only propose structured patches for allowlisted files after the diff and plan already exist.

### 3.3 Authentication scope

Examples include `auth: oauth.github`, but production OAuth implementation is not central to the sync loop.

**V1 implementation decision:**

```text
- Fully support auth:none for local demos and tests.
- Generate a typed auth middleware boundary for auth:oauth.github and auth:custom.
- Treat provider-specific OAuth flows as extension points unless explicit V1 templates exist.
- Do not block the sync loop on production OAuth completeness.
```

### 3.4 Guarantees and partial verification

Guarantees are first-class, but not every guarantee can be proven locally.

**V1 implementation decision:**

```text
- Supported short-form guarantees must compile to structured GuaranteeIR.
- Unknown short-form guarantees are errors.
- no_unsanitized_html_persisted is testable.
- notification_failure_does_not_rollback_post is testable for generated workflows.
- post_creation_p95_latency <= N is partially verifiable; generate a load-test scaffold or warning, not a production proof.
```

### 3.5 Migration execution policy

The specs require Prisma schema and migrations while warning against silent destructive migrations.

**V1 implementation decision:**

```text
- Generate Prisma schema deterministically.
- Generate migration files or migration scaffolds for supported additive changes.
- Validate migrations in an isolated test database when Docker Compose is available.
- Never silently apply destructive migrations.
- Block destructive migrations unless explicit confirmation and a manual migration strategy are provided.
```

---

## 4. Implementation Strategy

### 4.1 Build the compiler before the agent

The core product is not that an LLM writes backend code. The core product is that Arch narrows system changes into typed diffs, affected artifacts, ownership constraints, and verification obligations.

Build order:

```text
1. CLI skeleton
2. parser
3. draft semantic model and validator
4. canonical IR
5. initial generator
6. verifier
7. snapshot store
8. diff engine
9. dependency graph and artifact mapper
10. sync planner
11. deterministic patching
12. ownership/drift checks
13. agent task protocol
14. bounded repair loop
15. full V1 demo polish
```

The first prototype should work without a real LLM provider. Real LLM calls should be introduced after patch schemas, allowlist enforcement, ownership/write_scope checks, and verification exist.

### 4.2 Use the IR as the only compiler boundary

Generation, planning, diffing, artifact mapping, tests, verification, and repair must operate on canonical IR, not raw `.arch` text.

Required behavior:

```text
- formatting-only changes produce no intent diff
- declaration reordering produces no intent diff unless order is semantic
- workflow step order remains semantic
- enum order remains semantic
- every first-class entity has a stable ID
- every generated artifact maps back to one or more IR entity IDs
```

### 4.3 Prefer full-file generation under `src/generated/`

V1 should avoid mixed generated regions unless necessary.

Preferred pattern:

```text
src/generated/**     fully Arch-owned
src/custom/**        human-owned extension points
src/runtime/**       generated runtime support, Arch-owned unless explicitly marked otherwise
```

This keeps ownership simple and makes incremental patches safer.

### 4.4 Optimize for one excellent demo path

V1 should not generalize early. The first strong demo path is:

```text
SocialFeed backend
  User model
  Post model
  CreatePost workflow
  moderation stub
  sanitization
  insert Post
  FeedCache update
  push notification stub
  three guarantees
  add Post.visibility
  minimal patch
```

Every module should be judged by whether it helps this path become deterministic, reviewable, and verified.

### 4.5 Enforce stop conditions early

Unsupported or unsafe cases should stop before writing implementation files.

Examples:

```text
- unsupported target stack
- implicit many-to-many relation
- schedule trigger
- unsupported workflow step
- undeclared integration reference
- unknown guarantee short form
- destructive migration without confirmation
- human-owned file write attempt
- generated file drift before apply
- stale plan hash
```

### 4.6 Treat verification as the promotion gate

`arch apply` may write files, but metadata promotion must only happen after required verification passes.

Required invariant:

```text
Failed apply may leave inspectable working tree changes.
Failed apply must not promote ir.current.json to ir.previous.json.
Failed apply must not update artifact ownership hashes as if the patch succeeded.
```

---

## 5. Recommended Repository Structure

This section defines the repository for the Arch tool itself, not the generated backend project.

```text
.
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
├── README.md
├── docs/
│   ├── IMPLEMENTATION_PLAN.md
│   └── decisions/
│       ├── 0001-parser-strategy.md
│       ├── 0002-agent-boundary.md
│       └── 0003-migration-policy.md
├── packages/
│   ├── arch-cli/
│   │   ├── package.json
│   │   └── src/
│   │       ├── main.ts
│   │       ├── commands/
│   │       │   ├── init.ts
│   │       │   ├── parse.ts
│   │       │   ├── plan.ts
│   │       │   ├── apply.ts
│   │       │   ├── check.ts
│   │       │   └── repair.ts
│   │       ├── output/
│   │       │   ├── diagnostics-printer.ts
│   │       │   ├── plan-printer.ts
│   │       │   └── report-printer.ts
│   │       └── project-root.ts
│   │
│   ├── arch-language/
│   │   ├── package.json
│   │   └── src/
│   │       ├── lexer.ts
│   │       ├── parser.ts
│   │       ├── ast.ts
│   │       ├── spans.ts
│   │       ├── diagnostics.ts
│   │       └── formatter.ts
│   │
│   ├── arch-ir/
│   │   ├── package.json
│   │   └── src/
│   │       ├── schema.ts
│   │       ├── draft-ir.ts
│   │       ├── semantic-validator.ts
│   │       ├── canonicalize.ts
│   │       ├── canonical-json.ts
│   │       ├── hash.ts
│   │       ├── entity-ids.ts
│   │       ├── source-map.ts
│   │       └── ir-validator.ts
│   │
│   ├── arch-sync/
│   │   ├── package.json
│   │   └── src/
│   │       ├── snapshots.ts
│   │       ├── diff/
│   │       │   ├── diff-engine.ts
│   │       │   ├── comparators.ts
│   │       │   ├── classification.ts
│   │       │   └── diff-schema.ts
│   │       ├── graph/
│   │       │   ├── dependency-graph.ts
│   │       │   ├── graph-builder.ts
│   │       │   └── artifact-resolution.ts
│   │       ├── planner/
│   │       │   ├── plan-builder.ts
│   │       │   ├── plan-schema.ts
│   │       │   ├── plan-summary.ts
│   │       │   └── stale-plan.ts
│   │       ├── ownership/
│   │       │   ├── ownership-map.ts
│   │       │   ├── ownership-checks.ts
│   │       │   ├── generated-markers.ts
│   │       │   └── drift-preflight.ts
│   │       └── patch/
│   │           ├── patch-schema.ts
│   │           ├── patch-validator.ts
│   │           ├── patch-applier.ts
│   │           └── metadata-update.ts
│   │
│   ├── arch-generator/
│   │   ├── package.json
│   │   └── src/
│   │       ├── generator.ts
│   │       ├── naming.ts
│   │       ├── templates/
│   │       │   ├── package-json.ts
│   │       │   ├── docker-compose.ts
│   │       │   ├── prisma-schema.ts
│   │       │   ├── fastify-app.ts
│   │       │   ├── runtime-config.ts
│   │       │   ├── runtime-db.ts
│   │       │   ├── runtime-cache.ts
│   │       │   ├── model.ts
│   │       │   ├── validator.ts
│   │       │   ├── route.ts
│   │       │   ├── workflow.ts
│   │       │   ├── integration-stub.ts
│   │       │   ├── custom-extension-stub.ts
│   │       │   ├── policy.ts
│   │       │   └── test.ts
│   │       ├── guarantee-tests/
│   │       │   ├── html-safety.ts
│   │       │   ├── notification-nonrollback.ts
│   │       │   └── latency-scaffold.ts
│   │       └── migrations/
│   │           ├── migration-planner.ts
│   │           └── prisma-migration-writer.ts
│   │
│   ├── arch-agents/
│   │   ├── package.json
│   │   └── src/
│   │       ├── agent-task.ts
│   │       ├── orchestrator.ts
│   │       ├── roles/
│   │       │   ├── schema-agent.ts
│   │       │   ├── api-agent.ts
│   │       │   ├── workflow-agent.ts
│   │       │   ├── test-agent.ts
│   │       │   └── repair-agent.ts
│   │       ├── providers/
│   │       │   ├── deterministic-provider.ts
│   │       │   └── llm-provider-interface.ts
│   │       └── output-validation.ts
│   │
│   ├── arch-verifier/
│   │   ├── package.json
│   │   └── src/
│   │       ├── verifier.ts
│   │       ├── commands.ts
│   │       ├── command-runner.ts
│   │       ├── reports.ts
│   │       ├── drift-detector.ts
│   │       ├── guarantee-coverage.ts
│   │       └── repair-loop.ts
│   │
│   ├── arch-common/
│   │   ├── package.json
│   │   └── src/
│   │       ├── fs.ts
│   │       ├── paths.ts
│   │       ├── json.ts
│   │       ├── stable-sort.ts
│   │       ├── diagnostics.ts
│   │       ├── result.ts
│   │       └── errors.ts
│   │
│   └── arch-test-fixtures/
│       ├── package.json
│       └── fixtures/
│           ├── social-feed-v1/
│           │   └── backend.arch
│           ├── social-feed-v2-visibility/
│           │   └── backend.arch
│           ├── invalid-undelared-integration/
│           ├── invalid-many-to-many/
│           ├── invalid-unknown-guarantee/
│           └── drift-notification-transaction/
│
├── examples/
│   └── social-feed/
│       ├── v1/
│       │   └── backend.arch
│       ├── v2-visibility/
│       │   └── backend.arch
│       └── README.md
└── scripts/
    ├── run-e2e.ts
    └── update-goldens.ts
```

### 5.1 Why this structure

The package boundaries mirror the compiler pipeline:

```text
language → IR → sync → generator → agents → verifier → CLI
```

This keeps deterministic compiler logic separate from agent logic and makes it possible to test each stage independently.

### 5.2 Alternative for faster prototype

For the first prototype, the team may start with fewer packages:

```text
packages/arch-cli
packages/arch-core
packages/arch-test-fixtures
```

If this shortcut is used, keep internal source folders aligned with the package plan above so the code can split cleanly later.

---

## 6. Recommended Generated Backend Structure

Arch V1 should generate this project shape:

```text
.
├── backend.arch
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── docker-compose.yml
├── .env.example
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── generated/
│   │   ├── models/
│   │   │   ├── user.ts
│   │   │   └── post.ts
│   │   ├── validators/
│   │   │   ├── user.ts
│   │   │   └── post.ts
│   │   ├── routes/
│   │   │   └── posts.ts
│   │   ├── workflows/
│   │   │   └── createPost.ts
│   │   ├── integrations/
│   │   │   ├── llmModeratorGuardrail.ts
│   │   │   └── pushProvider.ts
│   │   └── policies/
│   ├── custom/
│   │   ├── README.md
│   │   └── .gitkeep
│   └── runtime/
│       ├── config.ts
│       ├── db.ts
│       ├── cache.ts
│       └── auth.ts
├── tests/
│   ├── generated/
│   │   ├── post.model.test.ts
│   │   ├── createPost.test.ts
│   │   ├── createPost.htmlSafety.test.ts
│   │   └── createPost.notificationFailure.test.ts
│   └── custom/
└── .arch/
    ├── ir.previous.json
    ├── ir.current.json
    ├── artifact-map.json
    ├── ownership.json
    ├── source-map.json
    ├── drift.json
    ├── plans/
    │   ├── <plan-id>.plan.json
    │   └── <plan-id>.summary.md
    ├── runs/
    │   └── <run-id>/
    ├── repair-history/
    ├── locks/
    └── tmp/
```

Generated file headers should include:

```text
- generated by Arch
- artifact ID
- IR entity IDs
- IR fragment hash
- ArtifactIR generation metadata: mode, generator_id, template_id when applicable
- ownership kind
- write_scope
- instruction not to edit directly
```

Human extension points should include:

```text
- generated stub marker only on first creation
- clear notice that the file becomes human-owned after modification
- stable exported function/interface expected by generated code
```

---

## 7. Module Breakdown

### 7.1 CLI module

**Package:** `packages/arch-cli`

Responsibilities:

```text
- expose arch init, parse, plan, apply, check, repair
- locate project root and backend.arch
- coordinate compiler phases
- load and write .arch metadata
- print source-location diagnostics
- print plan summaries and verification reports
- enforce command flags and confirmation gates
- return stable exit codes
```

Likely files:

```text
src/main.ts
src/project-root.ts
src/commands/init.ts
src/commands/parse.ts
src/commands/plan.ts
src/commands/apply.ts
src/commands/check.ts
src/commands/repair.ts
src/output/diagnostics-printer.ts
src/output/plan-printer.ts
src/output/report-printer.ts
```

Acceptance requirements:

```text
- arch --help works
- each command has stable flags and exit codes
- commands never directly parse or generate outside core modules
- errors include code, message, file, line, column when source-related
```

### 7.2 Language parser module

**Package:** `packages/arch-language`

Responsibilities:

```text
- lex .arch source
- parse V1 grammar into AST
- preserve source spans
- report lexical and syntax diagnostics
- recognize reserved but unsupported syntax to produce helpful V1 errors
```

Implementation recommendation:

```text
Use a hand-written lexer and recursive-descent parser for V1.
```

Rationale:

```text
- The V1 grammar is bounded.
- Precise diagnostics matter more than parser abstraction.
- A parser generator can be adopted later if editor tooling requires it.
```

Acceptance requirements:

```text
- parses SocialFeed fixture
- parses target, model, field, relation, integration, policy, workflow, steps, guarantees, tests, custom blocks
- parses field-level `indexed` / `index` modifiers
- recognizes named/composite source index declarations and `custom kind: test_generator` so semantic validation can reject them with precise diagnostics
- preserves byte offsets and line/column spans
- fails cleanly on invalid tokens, unterminated strings, and unclosed blocks
```

### 7.3 Draft IR and semantic validator module

**Package:** `packages/arch-ir`

Responsibilities:

```text
- convert AST into typed draft semantic model
- resolve references
- validate target values
- validate models, fields, constraints, relations, and defaults
- validate workflows, API triggers, step operations, step references, and step ordering
- validate integrations and failure policies
- validate policies and guarantee conflicts
- validate supported guarantee patterns
- compile `custom` declarations to first-class `CustomExtensionIR`
- validate custom extension file/export/input/output contracts
- reject `custom kind: test_generator` as reserved for post-V1
- validate field-level indexes and reject named/composite source indexes in normal V1
- represent inverse relation fields as `model_ref_list` with non-persisted storage
- reject unsupported V1 constructs before canonical IR is emitted
```

Likely files:

```text
src/draft-ir.ts
src/semantic-validator.ts
src/source-map.ts
src/entity-ids.ts
src/schema.ts
```

Acceptance requirements:

```text
- undeclared model references fail
- undeclared integration references fail
- missing primary key fails
- invalid default value fails
- unsupported many-to-many fails
- unsupported schedule trigger fails
- unsupported query/enqueue/if steps fail; custom behavior must use declared `custom` blocks plus supported `call custom` workflow steps
- unknown short-form guarantee fails
- unsupported long-form guarantees produce diagnostics-only output and block normal apply
- named or composite source indexes fail; field-level indexes compile
- custom test_generator declarations fail as reserved
- inverse one-to-many relation views do not create independent persisted columns
```

### 7.4 Canonical IR module

**Package:** `packages/arch-ir`

Responsibilities:

```text
- expand defaults
- normalize aliases such as datetime → timestamp
- assign stable entity IDs
- produce SourceLocationIR entries
- produce VerificationIR defaults
- produce CustomExtensionIR entries
- produce model index IR from field-level index modifiers
- produce ArtifactIR generation metadata
- produce OwnershipIR write_scope values
- produce GuaranteeCoverageIR statuses: covered, partially_covered, manual, missing
- sort unordered collections deterministically
- preserve workflow step order
- preserve enum value order
- serialize canonical JSON
- compute canonical_hash
- validate final arch.ir.v1 schema
```

Likely files:

```text
src/canonicalize.ts
src/canonical-json.ts
src/hash.ts
src/ir-validator.ts
```

Acceptance requirements:

```text
- equivalent formatting produces identical canonical_hash
- comments do not affect canonical_hash
- non-semantic declaration reordering does not affect canonical_hash
- workflow step reordering affects canonical_hash
- enum value reordering affects canonical_hash
- every entity has id, kind, name, aliases, source_id
- every generated artifact has generation.mode, generator_id, optional template_id, and ir_fragment_hash
- every ownership entry has write_scope matching ownership kind
- unsupported guarantees are not normal coverage entries
```

### 7.5 Snapshot store module

**Package:** `packages/arch-sync`

Responsibilities:

```text
- read and validate .arch/ir.previous.json
- write .arch/ir.current.json during plan/check/apply preflight
- atomically promote current IR after successful verification
- preserve run records
- detect corrupt metadata and hash mismatches
```

Likely files:

```text
src/snapshots.ts
src/metadata-store.ts
src/atomic-write.ts
```

Acceptance requirements:

```text
- first generation works without previous IR
- incremental plan requires valid previous IR
- apply fails if selected plan hashes do not match current state
- failed verification does not promote baseline
```

### 7.6 Diff engine module

**Package:** `packages/arch-sync`

Responsibilities:

```text
- compare previous and current canonical IR
- flatten comparable entities
- ignore non-semantic source metadata
- use explicit aliases for rename-aware comparison
- emit typed diffs
- classify change class and risk
- flag destructive and ambiguous changes
- emit deterministic diff ordering
```

Likely files:

```text
src/diff/diff-engine.ts
src/diff/comparators.ts
src/diff/classification.ts
src/diff/diff-schema.ts
```

Required V1 diff types:

```text
initial_generation
target_changed
model_added
model_removed
model_field_added
model_field_removed
model_field_type_changed
model_field_constraint_changed
relation_added
relation_removed
relation_changed
model_index_added
model_index_removed
model_index_changed
workflow_added
workflow_removed
workflow_step_added
workflow_step_removed
workflow_step_reordered
workflow_step_changed
integration_added
integration_removed
integration_changed
custom_extension_added
custom_extension_removed
custom_extension_changed
policy_added
policy_removed
policy_changed
guarantee_added
guarantee_removed
guarantee_changed
test_added
test_removed
test_changed
```

`system` and trigger changes are not standalone V1 diffs. Implementation-affecting changes in those areas must block with an unsupported-diff diagnostic unless a future taxonomy adds explicit supported diff types.

Acceptance requirements:

```text
- adding Post.visibility emits model_field_added
- removing Post emits model_removed destructive
- changing field type emits model_field_type_changed
- changing max length emits model_field_constraint_changed
- adding or removing a field-level index emits model_index_added or model_index_removed
- named/composite source indexes have already failed semantic validation
- custom extension contract/path/export changes emit custom_extension_changed
- reordering workflow steps emits workflow_step_reordered
- formatting-only source change emits no diff
- suspected rename emits remove/add plus rename_suspected diagnostic unless alias exists
```

### 7.7 Dependency graph and artifact resolver module

**Package:** `packages/arch-sync`

Responsibilities:

```text
- build graph nodes for IR entities, artifacts, and ownership records
- create edges: contains, references, reads, writes, uses, verifies, implements, owned_by, scoped_to, depends_on
- compute affected entities for each diff
- compute affected artifacts
- identify tests related to guarantees
- classify artifacts as writable, read-context-only, create-only, blocked, or requires confirmation
```

Likely files:

```text
src/graph/dependency-graph.ts
src/graph/graph-builder.ts
src/graph/artifact-resolution.ts
```

Acceptance requirements:

```text
- model field change reaches Prisma schema, model file, validator file, dependent workflow, dependent route, dependent tests
- workflow step change reaches workflow file, integration stub if needed, and generated tests
- guarantee change reaches guarantee test file and affected workflow/policy files
- human-owned extension point files are read-only context by default
```

### 7.8 Artifact mapper and ownership manager module

**Package:** `packages/arch-sync`

Responsibilities:

```text
- maintain .arch/artifact-map.json
- maintain .arch/ownership.json
- assign generated files and extension points to ownership classes
- persist ArtifactIR generation metadata in artifact-map entries
- persist OwnershipIR write_scope in ownership entries
- hash generated files or regions
- detect generated file drift
- block writes to human-owned files
- prevent overwriting completed extension points
```

Likely files:

```text
src/ownership/ownership-map.ts
src/ownership/ownership-checks.ts
src/ownership/generated-markers.ts
src/ownership/drift-preflight.ts
```

Acceptance requirements:

```text
- Arch can overwrite src/generated/** when ownership allows
- Arch cannot modify src/custom/** after stub creation
- drifted generated file blocks apply unless repair/confirmation path is selected
- missing generated region markers block patching
- every patch operation has an ownership decision
- generated files use write_scope: whole_file
- generated regions use write_scope: generated_region
- extension points use write_scope: stub_only until explicitly confirmed
- human-owned files use write_scope: none
```

### 7.9 Change planner module

**Package:** `packages/arch-sync`

Responsibilities:

```text
- create SyncPlanV1
- group diffs into action groups
- choose deterministic template actions when possible
- create agent task specs when synthesis is needed
- list affected artifacts and allowed paths
- list forbidden paths
- classify risk and required confirmations
- produce machine-readable JSON and human-readable Markdown summary
```

Likely files:

```text
src/planner/plan-builder.ts
src/planner/plan-schema.ts
src/planner/plan-summary.ts
src/planner/stale-plan.ts
```

Acceptance requirements:

```text
- arch plan is read-only for implementation files
- initial generation plan lists all files to create
- incremental plan lists typed diff and affected artifacts
- destructive changes are blocked without confirmation
- unsupported changes produce clear diagnostics and no patch plan
```

### 7.10 Patch generator module

**Packages:** `packages/arch-sync`, `packages/arch-generator`

Responsibilities:

```text
- apply deterministic template operations
- apply structured patch operations
- validate patch operations before writing
- enforce file allowlists
- reject forbidden paths and unrelated edits
- stage metadata updates
```

Likely files:

```text
packages/arch-sync/src/patch/patch-schema.ts
packages/arch-sync/src/patch/patch-validator.ts
packages/arch-sync/src/patch/patch-applier.ts
packages/arch-sync/src/patch/metadata-update.ts
packages/arch-generator/src/generator.ts
packages/arch-generator/src/templates/*
```

Acceptance requirements:

```text
- patch cannot write absolute paths
- patch cannot escape repo root
- patch cannot target .git or node_modules
- patch cannot modify files outside allowed_paths
- patch cannot update human-owned files
- patch application is deterministic for deterministic actions
```

### 7.11 Backend generator module

**Package:** `packages/arch-generator`

Responsibilities:

```text
- generate package.json
- generate tsconfig and Vitest config
- generate docker-compose.yml
- generate Prisma schema
- generate migrations or migration scaffolds
- generate Fastify app/server
- generate runtime config/db/cache/auth files
- generate model types
- generate validators
- generate routes
- generate workflow implementations
- generate integration stubs
- generate declared custom extension stubs only when missing
- generate policy stubs
- generate generated tests
- generate guarantee tests
```

Acceptance requirements:

```text
- generated project installs and typechecks
- generated tests pass for SocialFeed V1
- generated code is readable and inspectable
- generated tests map to IR TestIR and GuaranteeIR entities
- generated files include traceability headers
- generated artifact-map entries include ArtifactIR generation metadata
- custom extension stubs are created under declared paths and become human-owned after modification
- generated code calls custom extensions through typed boundaries instead of editing `src/custom/**`
```

### 7.12 Agent orchestrator module

**Package:** `packages/arch-agents`

Responsibilities:

```text
- define AgentTaskSpec
- route tasks to agent roles
- build constrained task context from typed diffs, IR fragments, file contents, allowed paths, forbidden paths, and acceptance criteria
- require structured patch output
- validate proposed patch operations
- record task inputs and outputs in run metadata
```

V1 agent roles:

```text
Schema Agent
API Agent
Workflow Agent
Integration Agent
Test Agent
Repair Agent
```

First prototype behavior:

```text
- deterministic provider only
- no network or LLM provider required
```

V1 behavior:

```text
- optional LLM provider behind explicit configuration
- deterministic patch validation remains mandatory
```

Acceptance requirements:

```text
- agent cannot parse .arch or infer source semantics
- agent cannot decide typed diffs
- agent cannot create sync plans from scratch
- agent cannot alter plan semantics
- agent cannot bypass ownership or write_scope checks
- agent cannot add files outside allowlist
- agent cannot modify human-owned files or completed extension points
- agent cannot weaken guarantees
- agent cannot mark verification as passed
- invalid agent output is rejected
```

### 7.13 Verifier module

**Package:** `packages/arch-verifier`

Responsibilities:

```text
- run generated project verification commands
- run Prisma validation/generation
- run migration validation where available
- run typecheck
- run tests
- run lint if configured
- run generated guarantee tests
- run ownership checks
- run drift checks
- produce JSON and Markdown reports
```

V1 verification commands:

```bash
pnpm typecheck
pnpm test
```

Optional but recommended when configs exist:

```bash
pnpm lint
pnpm prisma:validate
```

Acceptance requirements:

```text
- verification report records commands, status, stdout/stderr summary, and failed tests
- failed verification blocks metadata promotion
- generated guarantee test failure is treated as behavior failure
- guarantee coverage uses only covered, partially_covered, manual, and missing statuses
- latency guarantees are reported as partially_covered with limitations
- unsupported guarantees are diagnostics-only and block normal apply
```

### 7.14 Drift detector module

**Package:** `packages/arch-verifier`

Responsibilities:

```text
- detect modified generated files from ownership hashes
- detect missing generated artifacts
- detect stale or orphaned artifacts
- detect missing generated tests for declared guarantees
- run static drift checks for supported guarantee patterns
```

First static guarantee detector:

```text
notification_failure_does_not_rollback_post
```

The detector should flag generated workflow code where notification is awaited inside the same transaction that inserts the post.

Acceptance requirements:

```text
- manual edit to src/generated/workflows/createPost.ts is reported as drift
- deletion of tests/generated/createPost.htmlSafety.test.ts is reported as drift
- notification inside insert transaction is reported as guarantee drift when pattern is detected
```

### 7.15 Repair loop module

**Package:** `packages/arch-verifier`

Responsibilities:

```text
- read failed verification reports or drift reports
- create targeted repair plans
- invoke deterministic fixer or Repair Agent
- enforce allowlists and ownership
- rerun verification
- stop after max attempts
- preserve unresolved failure report
```

V1 limits:

```text
max_attempts: 3
no destructive edits
no human-owned file edits
no unrelated file edits
no guarantee weakening
```

Acceptance requirements:

```text
- repair can fix a generated type error in allowlisted generated files
- repair can regenerate a missing generated test
- repair stops after three failed attempts
- repair does not promote metadata unless verification succeeds
```

---

## 8. Build Order

Use this order even if multiple engineers work in parallel. Later work depends on stable contracts from earlier work.

```text
1. CLI skeleton
2. Parser
3. Draft semantic model and validator
4. Canonical IR
5. Initial generator
6. Verifier
7. Snapshot store
8. Diff engine
9. Dependency graph and artifact mapper
10. Sync planner
11. Deterministic patching
12. Ownership/drift checks
13. Agent task protocol
14. Bounded repair loop
15. Full V1 demo polish
```

Parallelizable work:

```text
- generated backend templates can begin after canonical IR entity shapes stabilize, but initial generator is still the first write path
- verifier can begin once generated project shape is known and must land before snapshot promotion
- snapshot plumbing can be prototyped early, but it should not drive roadmap order ahead of generator and verifier
- CLI output formatting can begin once plan/report schemas exist
- agent protocol can begin after patch schema and ownership contracts exist
- fixtures can be authored from day one and hardened as modules land
```

Do not begin real LLM provider integration before deterministic patching, ownership/write_scope checks, and verification are implemented.

---

## 9. Milestone Breakdown

These milestones intentionally follow the required roadmap order. A team may parallelize implementation behind stable interfaces, but acceptance gates should land in this order.

### M1 — CLI skeleton

**Goal:** Create the executable TypeScript workspace, command shell, and shared contracts without implementing compiler behavior yet.

```text
- pnpm workspace
- package skeletons
- TypeScript configs
- Vitest setup
- shared Result/Diagnostic types
- path normalization utilities
- hash utilities
- initial fixtures directory
- CLI executable stub
- command stubs for init, parse, plan, apply, check, repair
```

Acceptance criteria:

```text
- pnpm install, pnpm typecheck, and pnpm test succeed
- arch --help prints the six V1 commands
- each command returns a stable not-implemented result
- arch init can create backend.arch and required .arch directories without overwriting existing files
- path utilities reject absolute paths and paths escaping repo root
```

### M2 — Parser

**Goal:** Parse V1 `.arch` source into a typed AST with precise source locations.

Produces:

```text
- lexer
- recursive-descent parser
- AST node types
- source span tracking
- syntax diagnostics
- parser fixtures
```

Supported syntax for this milestone:

```text
system
target
model
field declarations
inline model references
integration
workflow
API trigger
steps block
supported step forms
guarantees block
tests block syntax enough to parse or reject cleanly
custom block syntax enough to parse or reject cleanly
field-level indexed/index modifiers
reserved named/composite index syntax for precise semantic rejection
reserved custom kind test_generator for precise semantic rejection
```

Acceptance criteria:

```text
- parses SocialFeed V1 fixture
- parser records source spans for system, target, models, fields, integrations, workflows, triggers, steps, guarantees
- parser handles //, #, and /* */ comments
- parser handles strings, numbers, booleans, durations, qualified identifiers, enum arrays
- invalid strings, unclosed braces, invalid tokens, and malformed declarations produce stable diagnostics
- reserved unsupported step syntax is parsed enough to produce semantic V1 errors later
```

Test strategy:

```text
- golden AST snapshots for valid fixtures
- syntax error fixtures for each diagnostic family
- span tests that assert line/column/offset ranges
- fuzz-like tests for unterminated string/block/comment edge cases
```

Done when:

```text
arch parse backend.arch can print a useful parse summary or syntax diagnostics without semantic validation.
```

---

### M3 — Draft semantic model and validator

**Goal:** Convert AST into a typed draft semantic model and reject unsupported or invalid V1 intent before canonical IR exists.

Produces:

```text
- draft IR builder
- symbol table
- semantic validator
- source map generator
- entity ID generator
- guarantee pattern compiler
- custom extension validator
- model index validator
```

Acceptance criteria:

```text
- missing primary key fails
- invalid field modifier fails
- invalid enum default fails
- undeclared model reference fails
- undeclared integration reference fails
- unsupported many-to-many fails
- unsupported trigger fails
- unsupported reserved step fails
- unknown short-form guarantee fails
- unsupported long-form guarantee is diagnostics-only and blocks normal apply
- custom declarations compile to draft CustomExtensionIR anchors
- custom kind test_generator fails as reserved
- field-level indexed/index is accepted
- named/composite source indexes fail as reserved
- inverse relation views are represented as model_ref_list with non-persisted storage
```

Test strategy:

```text
- semantic validation error fixtures
- source map offset tests
- entity ID stability tests
```

Done when:

```text
arch parse backend.arch rejects invalid source intent with source-location diagnostics and produces a validated draft model for valid fixtures.
```

---

### M4 — Canonical IR

**Goal:** Emit deterministic schema-valid `arch.ir.v1` from a validated draft model.

Produces:

```text
- canonical JSON serializer
- canonical hash implementation
- final IR schema validator
- SourceLocationIR entries
- ArtifactIR entries with generation metadata
- OwnershipIR entries with write_scope
- VerificationIR with guarantee coverage statuses
- arch parse --emit-ir
```

Acceptance criteria:

```text
- SocialFeed V1 compiles to arch.ir.v1
- canonical IR includes system, target, models, fields, relations, model indexes, workflows, triggers, steps, integrations, custom_extensions, policies, guarantees, tests, artifacts, ownership, sources, verification
- equivalent formatting produces the same canonical_hash
- comments do not affect canonical_hash
- non-semantic declaration reordering does not affect canonical_hash
- workflow step reordering changes canonical_hash
- enum value reordering changes canonical_hash
- latency guarantee coverage is partially_covered with limitations
- every artifact has generation.mode, generator_id, optional template_id, and ir_fragment_hash
- every ownership entry has write_scope matching ownership kind
- unsupported guarantees do not become normal GuaranteeCoverageIR entries
```

Test strategy:

```text
- golden canonical IR snapshots
- hash stability tests
- source map offset tests
- schema validation tests
- ArtifactIR and OwnershipIR validation tests
- guarantee coverage status tests
```

Done when:

```text
arch parse backend.arch --emit-ir outputs canonical IR for valid fixtures and rejects unsupported V1 features before planning.
```

---

### M5 — Initial generator

**Goal:** Generate a working TypeScript/Fastify/Prisma backend from canonical IR using deterministic templates, before introducing incremental sync or real agents.

Produces:

```text
- deterministic file templates
- package.json template
- tsconfig and Vitest config
- docker-compose.yml
- .env.example
- Prisma schema generator
- migration scaffold writer
- Fastify app/server generator
- runtime config/db/cache/auth generator
- model type generator
- validator generator
- route generator
- workflow generator
- integration stub generator
- custom extension stub generator
- generated test generator
- generated guarantee test generator
- local initial-generation write path for generated files
```

Minimum generated SocialFeed behavior:

```text
- POST /posts route exists
- request body validation exists
- Post.content is sanitized before persistence
- moderation integration stub is called before insert when declared
- Post record is inserted through Prisma
- FeedCache update is represented when Redis is enabled
- PushProvider is called after persistence with best-effort behavior
- notification failure does not rollback post persistence
```

Acceptance criteria:

```text
- local initial-generation write path creates generated backend files from canonical IR
- existing human-owned files are not overwritten
- generated code compiles
- generated tests pass
- Prisma schema is valid
- generated artifacts include traceability headers with generation metadata
- custom extension stubs are create-only and imported through typed generated boundaries
- cache:none generation omits Redis runtime requirements unless a declared custom extension requires them
- generated files include traceability headers
```

Test strategy:

```text
- template unit tests
- generated file snapshot tests
- generated project typecheck test
- generated project Vitest test run
- Prisma schema validation test
- ownership metadata tests
```

Done when:

```text
SocialFeed V1 can be generated from scratch and local verification passes at least pnpm typecheck and pnpm test.
```

---

### M6 — Verifier

**Goal:** Run local verification and produce reports. Promotion is not implemented until the snapshot store milestone.

Produces:

```text
- verifier command runner
- verification report JSON and Markdown
- failed-apply behavior
- run records under .arch/runs/<run-id>/
- guarantee coverage report renderer
```

Acceptance criteria:

```text
- verifier runs pnpm typecheck and pnpm test
- verification report records command outcomes
- generated guarantee test failure is behavior failure
- guarantee coverage uses covered, partially_covered, manual, missing
- latency guarantees are partially_covered with explicit limitations
- unsupported guarantees block normal apply before verifier handoff
```

Test strategy:

```text
- integration test where generated project passes verification
- integration test where an injected type error fails verification
- generated guarantee failure test
- report snapshot tests
```

Done when:

```text
The generated backend can be verified repeatably, and failures are reported without claiming metadata promotion.
```

---

### M7 — Snapshot store

**Goal:** Persist candidate and verified IR/metadata safely, with verification as the promotion gate.

Produces:

```text
- .arch/ir.current.json writer
- .arch/ir.previous.json promotion
- .arch/artifact-map.json writer
- .arch/ownership.json writer
- .arch/source-map.json writer
- atomic tmp-to-final metadata writes
- run records
```

Acceptance criteria:

```text
- first generation works without previous IR
- plan/check/apply preflight can write ir.current.json
- successful verification promotes ir.current.json to ir.previous.json
- successful verification updates artifact-map and ownership hashes
- failed verification does not promote baseline or ownership hashes
- corrupt metadata and hash mismatches block apply
- stable metadata files/directories match the spec-required .arch layout
```

Done when:

```text
The tool has a reliable first-generation lifecycle: generate -> verify -> promote, with failed verification safely contained.
```

---

### M8 — Diff engine

**Goal:** Compare previous and current IR snapshots and produce typed, classified diffs.

Produces:

```text
- entity flattening
- typed comparators
- alias-aware rename handling
- risk classification
- destructive/ambiguous diagnostics
- arch.diff.v1 output
- model_index_* diffs
- custom_extension_* diffs
- unsupported-diff diagnostics for system/trigger changes
```

Acceptance criteria:

```text
- adding optional field emits model_field_added additive low risk
- adding required field with default emits model_field_added additive medium risk
- adding required field without default emits destructive or ambiguous high risk when baseline may contain data
- removing field emits model_field_removed destructive high risk
- changing field type emits model_field_type_changed
- adding enum value emits a modifying model_field_type_changed diff because enum values are part of field type
- adding field-level index emits model_index_added
- removing field-level index emits model_index_removed
- removing enum value emits destructive high risk
- adding workflow step emits workflow_step_added
- reordering workflow steps emits workflow_step_reordered
- workflow trigger changes block as unsupported unless a future explicit diff type is added
- system changes block as unsupported unless a future explicit diff type is added
- adding guarantee emits guarantee_added
- weakening guarantee emits destructive high risk
- custom extension add/change/remove emits custom_extension_added/custom_extension_changed/custom_extension_removed
- custom test_generator never reaches diff because validation rejects it
- formatting-only source changes emit no diffs
```

Test strategy:

```text
- before/after IR fixture pairs
- diff golden snapshots
- risk classification table tests
- no-op diff tests
- rename alias tests
- rename suspected diagnostic tests
```

Done when:

```text
arch plan after editing backend.arch can explain exactly what changed in intent before planning implementation changes.
```

---

### M9 — Dependency graph and artifact mapper

**Goal:** Map typed diffs to affected IR entities, generated artifacts, and ownership records.

Produces:

```text
- dependency graph builder
- affected artifact resolver
- artifact-map updater
- ownership-map updater
- custom extension artifact rules
- guarantee-to-test mapping rules
```

Acceptance criteria:

```text
- model field change reaches Prisma schema, model, validator, dependent route/workflow, tests, and metadata
- model index change reaches Prisma schema, migration scaffold, and model/index tests
- custom extension change reaches generated call sites and extension metadata but not completed src/custom files
- guarantee change reaches guarantee tests and affected generated workflow/policy files
- inverse relation fields do not create independent persisted columns
- ArtifactIR generation metadata is preserved in artifact-map entries
- OwnershipIR write_scope is preserved in ownership entries
```

Done when:

```text
Every supported V1 diff category can be resolved to a deterministic affected-artifact set.
```

---

### M10 — Sync planner

**Goal:** Convert typed diffs and affected artifacts into read-only sync plans.

Produces:

```text
- SyncPlanV1 schema
- initial_generation mode
- incremental_sync mode
- risk and confirmation policy
- human-readable plan summary
- arch plan command
```

Acceptance criteria:

```text
- arch plan writes .arch/ir.current.json and .arch/plans/<plan-id>.*
- arch plan does not write implementation files
- initial generation plan lists all generated files, ownership classes, generation modes, tests, guarantee coverage, and verification commands
- incremental plan lists typed diffs and affected artifacts only
- unsupported system/trigger changes produce diagnostics and no patch plan
- unsupported guarantees are diagnostics-only and block normal apply
- plan IDs and diff hashes are deterministic for same inputs
```

Done when:

```text
A developer can review exactly what Arch intends to change before running apply.
```

---

### M11 — Deterministic patching

**Goal:** Demonstrate the core V1 sync loop with a minimal field-addition patch.

Spec change:

```arch
model Post {
  id: uuid primary
  author: User required
  content: string max 5000
  visibility: enum["public", "private", "followers"] default "public" indexed
  created_at: timestamp default now immutable
}
```

Expected typed diff:

```text
model_field_added
entity: model.Post.field.visibility
parent: model.Post
change_class: additive
risk: medium
```

Expected affected artifacts:

```text
prisma/schema.prisma
prisma/migrations/*
src/generated/models/post.ts
src/generated/validators/post.ts
src/generated/routes/posts.ts
src/generated/workflows/createPost.ts
tests/generated/post.model.test.ts
tests/generated/createPost.test.ts
.arch/artifact-map.json
.arch/ownership.json
```

Produces:

```text
- field-addition patch actions
- migration scaffold for field addition
- generated tests for enum validation/default behavior
- patch validator and applier
```

Acceptance criteria:

```text
- arch plan shows the typed diff and affected artifacts
- arch plan does not include unrelated files
- arch apply validates plan hashes before writing
- arch apply updates only allowlisted generated files and metadata
- PostVisibility enum or equivalent Prisma representation is added
- visibility column migration or scaffold is created
- generated validators accept allowed values and reject invalid values
- generated workflow persists visibility or applies default
- generated tests pass
- final Git diff is small and reviewable
```

Test strategy:

```text
- full e2e fixture: social-feed-v1 → apply → social-feed-v2-visibility → plan → apply → verify
- touched-file assertion test
- generated Prisma schema assertion
- generated validator test
- generated workflow test
- artifact map update test
- ownership update test
```

Done when:

```text
The first meaningful vertical slice works end to end: spec change → typed diff → sync plan → minimal patch → verification.
```

---

### M12 — Ownership and drift checks

**Goal:** Enforce ownership/write_scope boundaries and detect generated-code drift.

Produces:

```text
- ownership preflight
- generated artifact hash drift detection
- generated region hash drift detection, only if generated regions are used
- missing artifact detection
- missing guarantee test detection
- first static guarantee drift detector
- .arch/drift.json
```

Supported guarantee patterns:

```text
no_unsanitized_html_persisted
notification_failure_does_not_rollback_post
post_creation_p95_latency <= Nms or Ns, partially verifiable
```

Acceptance criteria:

```text
- no_unsanitized_html_persisted generates tests proving persisted content is sanitized
- notification_failure_does_not_rollback_post generates an integration test where notification fails but Post persists
- latency guarantee is reported as partially_covered and produces a scaffold or warning
- arch check detects manual edits to generated files by hash
- arch check detects missing generated tests for declared guarantees
- arch check reports generated file drift with artifact ID and entity ID
- arch check enforces write_scope: whole_file, generated_region, stub_only, none
- completed src/custom extension files are read-only context
- static detector flags notification inside insert transaction when pattern is detectable
```

Test strategy:

```text
- generated guarantee test snapshots
- generated project tests for guarantee behavior
- drift fixture with modified generated file
- drift fixture with deleted generated test
- drift fixture with notification awaited inside transaction
- coverage report snapshot tests
```

Done when:

```text
A developer can see which guarantees are covered, partially covered, or drifted, and arch check can detect at least one meaningful implementation drift.
```

---

### M13 — Agent task protocol

**Goal:** Define and validate bounded agent task contracts without requiring real LLM integration.

Produces:

```text
- AgentTaskSpec
- deterministic provider for tests
- role allowlists
- forbidden path handling
- structured patch output validation
- run metadata for task inputs/outputs
```

Acceptance criteria:

```text
- agents receive typed diffs, IR fragments, affected artifacts, allowlists, forbidden paths, ownership/write_scope decisions, and acceptance criteria
- agents cannot parse .arch, decide semantic diffs, create plans from scratch, bypass ownership, modify human-owned files, weaken guarantees, or mark verification passed
- invalid output is rejected before writing
- deterministic mock agent can satisfy one planned generated-file task in tests
- real LLM provider remains optional and disabled by default
```

Done when:

```text
The agent boundary is testable independently from provider integration.
```

---

### M14 — Bounded repair loop

**Goal:** Implement bounded repair without allowing free-roaming code edits.

Produces:

```text
- repair plan schema
- repair failure classifier
- Repair Agent task protocol
- deterministic repair provider for tests
- allowlisted repair patch path
- repair history records
- max-attempt enforcement
```

Supported V1 repair cases:

```text
- generated TypeScript type error in allowlisted generated file
- generated test expectation mismatch caused by generated code
- missing generated file or test
- generated artifact hash drift where repair can regenerate from IR
```

Acceptance criteria:

```text
- arch repair reads latest failed verification or drift report
- repair creates a constrained patch plan
- repair only touches allowlisted generated files
- repair never modifies src/custom/**
- repair reruns verification after each attempt
- repair stops after 3 attempts
- successful repair promotes metadata only after verification succeeds
- failed repair preserves unresolved report
```

Test strategy:

```text
- induced type error repair test
- missing generated test repair test
- failed repair max attempts test
- forbidden human-owned file repair rejection test
- agent output validation tests
```

Done when:

```text
V1 has a bounded repair loop that demonstrates constrained agentic patching without autonomous behavior.
```

---

### M15 — Full V1 demo polish

**Goal:** Stabilize the V1 experience and ship the complete demo loop.

Produces:

```text
- polished CLI output
- stable JSON schemas
- stable exit codes
- example SocialFeed project
- README/demo instructions
- implementation docs
- compatibility checks
- failure-mode tests
- CI pipeline for unit, integration, and e2e fixtures
```

Acceptance criteria:

```text
- arch init creates backend.arch starter and .arch directory
- arch parse validates syntax/semantics and can emit IR
- arch plan produces readable and machine-readable plans
- arch apply generates and patches code safely
- arch check runs verification and drift checks
- arch repair attempts bounded repair
- full SocialFeed demo runs end to end
- unsupported features are rejected with clear diagnostics
- destructive changes are blocked by default
- human-owned files are preserved
- final diffs are reviewable
```

Test strategy:

```text
- full CLI e2e tests
- golden snapshots for diagnostics/plans/reports
- generated backend verification tests
- destructive-change blocking tests
- ownership conflict tests
- stale plan tests
- corrupt metadata tests
- repair-loop tests
```

Done when:

```text
A developer can run the documented demo from a clean checkout and observe initial generation, incremental sync, drift detection, and bounded repair.
```

---

## 10. First Vertical Slice Plan

This is the first implementation thread that should be made to work end to end.

### 10.1 Fixture: `backend.arch`

Use this fixture as the initial source:

```arch
system SocialFeed {
  target {
    language: typescript
    runtime: node.fastify
    database: postgres
    orm: prisma
    cache: redis
    auth: none
    test_framework: vitest
    local_runtime: docker_compose
    package_manager: pnpm
  }

  model User {
    id: uuid primary
    username: string unique required
    bio: string max 280 optional
    created_at: timestamp default now immutable
  }

  model Post {
    id: uuid primary
    author: User required
    content: string max 5000 required
    created_at: timestamp default now immutable
  }

  integration LLMModeratorGuardrail {
    kind: llm_moderation
    required: true
    failure_policy: fail_workflow
  }

  integration PushProvider {
    kind: push
    required: false
    failure_policy: best_effort
  }

  workflow CreatePost {
    trigger: api.POST("/posts")

    steps {
      validate input as Post
      moderate Post.content using LLMModeratorGuardrail
      sanitize Post.content as html_safe
      insert Post
      update FeedCache for author.followers
      notify mentioned_users via PushProvider best_effort
      return Post
    }

    guarantees {
      no_unsanitized_html_persisted
      notification_failure_does_not_rollback_post
      post_creation_p95_latency <= 200ms
    }
  }
}
```

Use `auth: none` in the first vertical slice to avoid making OAuth provider behavior part of the initial demo. Keep `auth: oauth.github` supported as a generated middleware boundary later.

### 10.2 Step A — Parse

Required output:

```text
- AST with source spans
- parse summary:
  System: SocialFeed
  Target: node.fastify/postgres/prisma/redis
  Models: User, Post
  Workflows: CreatePost
  Integrations: LLMModeratorGuardrail, PushProvider
  Guarantees: 3
```

Pass condition:

```text
arch parse examples/social-feed/v1/backend.arch succeeds.
```

### 10.3 Step B — Compile canonical IR

Required output:

```text
.arch/ir.current.json
```

Must include:

```text
schema_version: arch.ir.v1
system.SocialFeed
target.primary
model.User
model.Post
model.Post.field.content
relation.Post.author.User
integration.LLMModeratorGuardrail
integration.PushProvider
workflow.CreatePost
workflow.CreatePost.step.sanitize_post_content
guarantee.no_unsanitized_html_persisted
guarantee.notification_failure_does_not_rollback_post
guarantee.post_creation_p95_latency
verification.primary
```

Pass condition:

```text
Repeated compiles produce identical canonical_hash.
```

### 10.4 Step C — Plan first generation

Required command:

```bash
arch plan --spec examples/social-feed/v1/backend.arch
```

Required plan summary:

```text
Plan: Initial generation for SocialFeed
Risk: medium
Destructive: false
Files to create:
- package.json
- docker-compose.yml
- prisma/schema.prisma
- src/app.ts
- src/server.ts
- src/runtime/config.ts
- src/runtime/db.ts
- src/runtime/cache.ts
- src/generated/models/user.ts
- src/generated/models/post.ts
- src/generated/validators/user.ts
- src/generated/validators/post.ts
- src/generated/routes/posts.ts
- src/generated/workflows/createPost.ts
- src/generated/integrations/llmModeratorGuardrail.ts
- src/generated/integrations/pushProvider.ts
- tests/generated/createPost.test.ts
- tests/generated/createPost.htmlSafety.test.ts
- tests/generated/createPost.notificationFailure.test.ts
```

Pass condition:

```text
Plan writes .arch/ir.current.json and .arch/plans/<plan-id>.*, but writes no implementation files.
```

### 10.5 Step D — Apply first generation

Required command:

```bash
arch apply
```

Required behavior:

```text
- validate plan hashes
- scaffold generated backend
- write artifact map
- write ownership map
- run verification
- promote IR and metadata after success
```

Pass condition:

```text
Generated project passes pnpm typecheck and pnpm test.
```

### 10.6 Step E — Modify `backend.arch` to the visibility fixture

Apply this change:

```arch
model Post {
  id: uuid primary
  author: User required
  content: string max 5000 required
  visibility: enum["public", "private", "followers"] default "public" indexed
  created_at: timestamp default now immutable
}
```

### 10.7 Step F — Plan incremental sync

Required typed diff:

```text
model_field_added
entity: model.Post.field.visibility
type: enum
values: public, private, followers
default: public
indexed: true
```

Required affected artifacts:

```text
- prisma/schema.prisma
- prisma/migrations/*
- src/generated/models/post.ts
- src/generated/validators/post.ts
- src/generated/routes/posts.ts
- src/generated/workflows/createPost.ts
- tests/generated/post.model.test.ts
- tests/generated/createPost.test.ts
```

Pass condition:

```text
Plan includes only relevant generated artifacts plus metadata updates.
```

### 10.8 Step G — Apply minimal patch

Required behavior:

```text
- add Prisma enum or compatible field mapping
- add visibility field with default
- add migration scaffold
- update generated Post model
- update validator enum validation
- update route/workflow input mapping
- add tests for valid/invalid visibility
- update artifact-map and ownership hashes
```

Pass condition:

```text
Verification passes and final diff excludes unrelated files.
```

### 10.9 Step H — Drift demonstration

Manually edit a generated workflow file:

```text
src/generated/workflows/createPost.ts
```

Then run:

```bash
arch check
```

Pass condition:

```text
Arch reports generated_file_modified drift with artifact ID and related workflow entity ID.
```

### 10.10 Step I — Repair demonstration

Use one controlled failure, such as deleting a generated guarantee test.

Required command:

```bash
arch repair
```

Pass condition:

```text
Arch regenerates the missing generated test, reruns verification, and stops after success.
```

---

## 11. Acceptance Criteria by Command

### 11.1 `arch init`

Must:

```text
- create backend.arch starter file if missing
- create .arch/ directory
- create plans, runs, repair-history, locks, tmp directories
- create src/custom/README.md when initializing an empty generated project
- avoid overwriting existing backend.arch unless explicitly requested
```

Should:

```text
- support --template social-feed
- support --empty
```

Done when:

```text
Running arch init in an empty directory creates a valid starter project that can immediately run arch plan.
```

### 11.2 `arch parse backend.arch`

Must:

```text
- validate syntax
- validate semantics
- report source-location errors
- optionally emit AST
- optionally emit canonical IR
- reject unknown short-form guarantees
- reject custom kind test_generator
- reject named/composite source indexes while accepting field-level indexes
- never write implementation files
```

Done when:

```text
Valid specs produce summaries and invalid specs produce actionable diagnostics.
```

### 11.3 `arch plan`

Must:

```text
- compile current spec
- load previous IR if present
- compute typed intent diff
- build dependency graph
- classify risk
- identify affected artifacts
- identify ownership conflicts
- include ArtifactIR generation metadata and OwnershipIR write_scope decisions
- identify generated tests
- report guarantee coverage as covered, partially_covered, manual, or missing
- block unsupported guarantees and unsupported system/trigger changes before patch planning
- identify destructive changes
- write plan JSON and summary
- avoid writing implementation files
```

Done when:

```text
A developer can review exactly what will change before running apply.
```

### 11.4 `arch apply`

Must:

```text
- load selected/latest valid plan
- recompile current spec
- validate current IR hash matches plan
- validate baseline IR hash matches plan
- check affected generated files for drift
- enforce ownership and write_scope boundaries
- reject unsupported/destructive changes without confirmations
- apply deterministic template operations
- invoke constrained agents only for planned tasks
- reject agent attempts to parse .arch, alter diffs/plans, modify human-owned files, weaken guarantees, or mark verification passed
- validate patches before writing
- run verifier
- run bounded repair when enabled
- promote metadata only on success
- print final diff summary
```

Done when:

```text
Initial generation and field-addition incremental sync both work end to end.
```

### 11.5 `arch check`

Must:

```text
- compile current spec
- compare current IR with verified baseline
- inspect generated artifacts and ownership metadata
- run selected verification checks
- detect generated file drift
- enforce ownership write_scope
- detect missing generated tests
- report guarantee coverage as covered, partially_covered, manual, or missing
- report unsupported guarantees as diagnostics-only blockers
- avoid applying patches
```

Done when:

```text
At least one generated artifact drift and one guarantee-related drift are detected and reported clearly.
```

### 11.6 `arch repair`

Must:

```text
- load latest failed verification or drift report
- create repair plan
- enforce allowlist, ownership, and write_scope
- invoke deterministic fixer or Repair Agent
- rerun verification
- stop after max attempts
- avoid modifying human-owned files
- avoid weakening guarantees or deleting verification coverage
- avoid destructive edits
```

Done when:

```text
A controlled generated-code failure can be repaired and verified without broad codebase edits.
```

---

## 12. Test Strategy

### 12.1 Test pyramid

Use four layers:

```text
1. Unit tests for pure compiler and planner logic
2. Golden snapshot tests for AST, IR, diffs, plans, generated files, reports
3. Integration tests for command flows and metadata behavior
4. End-to-end tests that generate and verify complete backend projects
```

### 12.2 Required fixture categories

```text
valid/social-feed-v1
valid/social-feed-v2-visibility
valid/cache-none
valid/auth-none
valid/custom-extension-point
valid/field-level-index
invalid/syntax-unclosed-block
invalid/model-missing-primary
invalid/model-duplicate-field
invalid/relation-many-to-many
invalid/model-named-index
invalid/model-composite-index
invalid/integration-undeclared
invalid/trigger-schedule
invalid/step-query-unsupported
invalid/custom-test-generator
invalid/guarantee-unknown-short-form
invalid/guarantee-unsupported-normal-apply
invalid/enum-default-not-in-values
diff/model-field-added
diff/model-field-removed
diff/model-index-added
diff/custom-extension-added
diff/custom-extension-changed
diff/workflow-step-reordered
diff/guarantee-added
diff/system-change-unsupported
diff/trigger-change-unsupported
diff/formatting-noop
drift/generated-file-modified
drift/generated-test-deleted
drift/notification-inside-transaction
repair/type-error-generated-file
repair/missing-generated-test
```

### 12.3 Parser tests

Must verify:

```text
- all V1 declarations parse
- comments are ignored
- strings and escapes work
- durations parse
- qualified identifiers parse
- source spans are correct
- syntax errors are stable
```

### 12.4 Semantic validation tests

Must verify:

```text
- exactly one system
- exactly one target
- target values are supported
- models have one primary field
- relations resolve
- defaults are compatible with field types
- workflow integration references resolve
- workflow API paths are valid
- unsupported triggers fail
- unsupported steps fail
- unsupported many-to-many fails
- unknown guarantees fail
- unsupported guarantees block normal apply as diagnostics-only
- custom kind test_generator fails
- named/composite source indexes fail
- field-level indexes compile
- inverse relation views use model_ref_list with non-persisted storage
- supported guarantees compile
```

### 12.5 Canonical IR tests

Must verify:

```text
- stable entity IDs
- stable canonical JSON
- stable canonical hash
- semantic no-op formatting changes produce identical IR
- source locations are present
- verification metadata is present
- guarantee coverage statuses are covered, partially_covered, manual, or missing
- ArtifactIR generation metadata is present
- OwnershipIR write_scope is present and valid
- all EntityRef values resolve
```

### 12.6 Diff tests

Must verify:

```text
- each supported diff type has fixture coverage
- diff ordering is deterministic
- risk classification is correct
- destructive changes require confirmation
- ambiguous renames are not silently accepted
- model_index_* and custom_extension_* diffs are covered
- system/trigger changes produce unsupported diagnostics rather than unsupported free-form diffs
- source-only changes are ignored
```

### 12.7 Planner tests

Must verify:

```text
- initial generation plans all required files
- incremental field addition plans only affected artifacts
- action groups are ordered correctly
- human-owned conflicts block plans or apply
- destructive changes block apply
- plan IDs are deterministic
- plan stale detection works
- unsupported guarantees and unsupported system/trigger changes block patch planning
- ArtifactIR generation metadata and OwnershipIR write_scope appear in plan metadata decisions
```

### 12.8 Generator tests

Must verify:

```text
- generated files match snapshots
- generated code compiles
- generated Prisma schema validates
- generated validators enforce field constraints
- generated workflow order follows IR steps
- generated tests map to TestIR IDs
- generated guarantee tests map to GuaranteeIR IDs
- custom extension stubs are create-only and generated call sites use typed boundaries
- field-level indexes affect Prisma schema and migration scaffolds
```

### 12.9 Verifier tests

Must verify:

```text
- command results are captured
- failed typecheck blocks promotion
- failed tests block promotion
- partially_covered and manual guarantees are reported explicitly
- unsupported guarantees are diagnostics-only blockers
- report JSON and Markdown are stable
```

### 12.10 Ownership and drift tests

Must verify:

```text
- generated file hash drift is detected
- missing generated artifacts are detected
- missing generated tests are detected
- src/custom files are read-only after creation
- write_scope is enforced for whole_file, generated_region, stub_only, and none
- generated region markers are required if regions are used
- patch operations cannot escape repo root
```

### 12.11 Repair tests

Must verify:

```text
- repair respects max_attempts
- repair only touches allowlisted files
- repair can regenerate missing generated artifacts
- repair cannot modify human-owned files
- successful repair reruns verification
- failed repair does not promote metadata
```

### 12.12 End-to-end demo test

The final V1 CI test should run:

```bash
arch init --template social-feed
arch plan
arch apply
pnpm test
cp examples/social-feed/v2-visibility/backend.arch backend.arch
arch plan
arch apply
arch check
```

Assertions:

```text
- initial apply passes
- incremental apply passes
- final generated backend passes tests
- final .arch/ir.previous.json hash equals current spec hash
- final artifact-map contains expected entries
- final ownership map contains expected hashes
- final Git diff is limited to expected files
```

---

## 13. V1 Feature Matrix

| Feature | Prototype | V1 | Notes |
|---|---:|---:|---|
| One `backend.arch` file | yes | yes | Required. |
| Parser with source spans | yes | yes | Precise diagnostics required. |
| Formatter | no | optional | Helpful but not required for V1. |
| Canonical `arch.ir.v1` | yes | yes | Required. |
| Stable canonical hash | yes | yes | Required. |
| Semantic validation | yes | yes | Required. |
| Initial generation plan | yes | yes | Required. |
| Initial apply | yes | yes | Required. |
| TypeScript/Fastify generation | yes | yes | Required. |
| Prisma schema generation | yes | yes | Required. |
| Prisma migration scaffolds | yes | yes | Required for field changes. |
| Docker Compose | yes | yes | Required for local runtime. |
| Redis runtime | yes | yes | Support `cache: redis`; `cache:none` also useful. |
| OAuth production flow | no | no | Generate boundary/stub only. |
| Model fields | yes | yes | Required. |
| Field-level indexes | visibility index | yes | Named/composite source indexes are reserved and rejected. |
| Relations | many-to-one first | many-to-one, one-to-many inverse, one-to-one | No implicit many-to-many. |
| Inverse relation fields | no or fixture-only | yes | Use model_ref_list with non-persisted storage. |
| API triggers | POST first | GET/POST/PUT/PATCH/DELETE | API only in V1. |
| Schedule triggers | no | no | Reserved unsupported. |
| Workflow steps | core subset | supported V1 subset | Unsupported reserved steps fail. |
| Integrations | llm_moderation, push | llm_moderation, push, email, custom stubs | Provider completeness postponed. |
| Custom extensions | stub first | first-class CustomExtensionIR | custom test_generator is reserved/rejected. |
| Policies | parse/reject or basic | basic generated/manual metadata | Keep narrow. |
| Guarantees | 3 patterns | supported patterns plus long-form custom manual/partial | Unknown short forms fail; unsupported guarantees are diagnostics-only blockers. |
| Guarantee coverage statuses | partial report | covered, partially_covered, manual, missing | No unsupported status in normal apply. |
| Generated tests | yes | yes | Required. |
| Typed diffs | field add first | listed V1 diff set | Includes model_index_* and custom_extension_*; system/trigger changes block unless taxonomy expands. |
| Dependency graph | minimal | full V1 entity/artifact graph | Required for minimal patches. |
| Minimal patch apply | field addition | supported additive/modifying changes | Required. |
| Destructive migration apply | no | no | Block by default. |
| Ownership metadata | yes | yes | Required, including write_scope. |
| Artifact generation metadata | yes | yes | Required in ArtifactIR and artifact-map. |
| Drift detection | hash drift first | hash drift, missing artifact/test, limited guarantee drift | Required. |
| Repair loop | no or stub | bounded max 3 | Required for V1 success criteria. |
| Real LLM provider | no | optional/configured | Agent protocol required; provider may be optional. |
| Legacy repo sync | no | no | Non-goal. |

---

## 14. V1 Supported Change Types

V1 should support planning for all listed diff types, but applying should start conservative.

### 14.1 Apply automatically when ownership is safe

```text
- initial_generation
- model_added
- model_field_added optional
- model_field_added required with safe default
- model_field_constraint_changed when widening or non-destructive
- model_field_type_changed when only adding enum values
- model_index_added for field-level indexes
- relation_added when supported by templates
- custom_extension_added when creating a missing extension stub
- workflow_added
- workflow_step_added for supported step operations
- integration_added
- policy_added when enforcement template exists or manual warning is acceptable
- guarantee_added when guarantee pattern is supported
- test_added generated
```

### 14.2 Plan but require confirmation

```text
- trigger path/method changes block as unsupported until a future explicit diff type is added
- workflow_step_reordered affecting persistence, safety, transaction, or side effects
- integration_changed provider/failure-policy changes
- custom_extension_changed for contract/path/export changes
- auth target changes
- cache redis ↔ none changes when workflows use cache
- stricter field constraints that might reject existing data
- stricter guarantees that require implementation changes
```

### 14.3 Block or require explicit destructive path

```text
- model_removed
- model_field_removed
- model_field_type_changed incompatible
- model_index_removed when dropping an index affects generated query behavior
- enum value removal
- relation_removed
- workflow_removed
- integration_removed while referenced
- custom_extension_removed while referenced or with existing human implementation
- policy_removed
- policy_changed when enforcement is weakened
- guarantee_removed
- guarantee weakening
- target language/runtime/database/orm change
```

V1 may produce a plan summary for these changes, but apply should stop unless an explicit confirmation path and safe manual migration strategy exist. Some critical target changes should remain unsupported entirely.

---

## 15. Data and Metadata Contracts

### 15.1 `.arch/ir.previous.json`

Represents last successfully applied and verified IR.

Rules:

```text
- created after successful first apply
- updated only after successful apply and verification
- never updated after failed apply/check/repair
- used as baseline for next plan
```

### 15.2 `.arch/ir.current.json`

Represents latest candidate IR compiled from current source.

Rules:

```text
- written during plan/check/apply preflight
- not considered verified
- promoted only after verification succeeds
```

### 15.3 `.arch/artifact-map.json`

Maps IR entities to implementation artifacts.

Must include:

```text
- schema_version
- ir_hash
- generator_version
- artifact id
- path
- artifact_kind
- entity_ids
- ownership_id
- generation.mode
- generation.generator_id
- generation.template_id when applicable
- generation.ir_fragment_hash
- generated_from_hash
- source_ids
```

### 15.4 `.arch/ownership.json`

Tracks file and region ownership.

Ownership kinds:

```text
generated_file
generated_region
extension_point
human_file
```

Update policies:

```text
overwrite_allowed
patch_allowed
create_only
read_only
requires_confirmation
```

Write scopes:

```text
whole_file
generated_region
stub_only
none
```

Rules:

```text
- generated_file uses write_scope: whole_file
- generated_region uses write_scope: generated_region
- extension_point uses write_scope: stub_only until explicit confirmation
- human_file uses write_scope: none
```

### 15.5 `.arch/source-map.json`

Maps IR entities to `.arch` source spans.

Must support:

```text
- validation diagnostics
- plan traceability
- generated file headers
- drift reports
```

### 15.6 `.arch/drift.json`

Stores the latest drift report from `arch check` or failed apply/repair preflight.

Must include:

```text
- schema_version
- checked_ir_hash
- artifact_hash findings
- ownership_boundary findings
- missing_artifact findings
- missing_guarantee_test findings
- supported guarantee_static_pattern findings
```

### 15.7 `.arch/plans/<plan-id>.plan.json`

A plan is valid only while:

```text
- compiler version is compatible
- baseline IR hash matches
- current compiled IR hash matches
- artifact-map hash matches
- ownership-map hash matches
- affected generated files have not drifted
- required confirmations are supplied
```

### 15.8 `.arch/runs/<run-id>/`

Stores command execution records:

```text
input.json
diff.json
plan.json
patch.json
metadata-update.json
verification-handoff.json
verification-report.json
verification-report.md
agent-tasks/
agent-results/
files-before/
files-after/
```

Stable metadata should be version-controlled. Large volatile logs may be ignored by project policy.

### 15.9 `.arch/repair-history/`, `.arch/locks/`, `.arch/tmp/`

Rules:

```text
- repair-history stores bounded repair attempts and outcomes
- locks stores apply/repair lock files
- tmp stores draft metadata writes before atomic promotion
- failed apply or repair runs must not promote drafts from tmp
```

---

## 16. Generated Code Rules

### 16.1 Generated files

Arch may overwrite fully generated files when ownership allows.

Required header:

```ts
// Generated by Arch. Do not edit directly.
// Artifact: artifact.src_generated_workflows_createPost_ts
// Entities: workflow.CreatePost
// Ownership: generated_file overwrite_allowed
// Write scope: whole_file
// Generation: deterministic_template arch.templates.typescript.fastify.v1 workflow.fastify.v1
// IR fragment hash: sha256:...
```

### 16.2 Human-owned files

Arch must not write human-owned files by default.

Examples:

```text
src/custom/**
tests/custom/**
```

### 16.3 Extension points

Arch may create extension point stubs if missing.

After creation:

```text
- if unchanged from stub, Arch may update only with create-only/stub policy
- if changed by user, treat as human-owned read-only context
- generated code should import stable exported functions/interfaces from extension points
```

### 16.4 Mixed files

Avoid mixed files in V1. If unavoidable, use generated markers:

```ts
// <arch-generated id="post-validator" entities="model.Post">
...
// </arch-generated>
```

Patch rules:

```text
- patch only inside balanced markers
- marker absence is drift
- marker mismatch blocks apply
```

### 16.5 Formatting

Generated code should be deterministic.

Rules:

```text
- stable import ordering
- stable model/field ordering from canonical IR
- stable generated test names
- stable whitespace and line endings
- no timestamps in generated files unless explicitly excluded from hashes
```

---

## 17. Migration Policy

### 17.1 First generation

For first generation:

```text
- generate prisma/schema.prisma
- generate initial migration scaffold or run Prisma migration generation in isolated environment
- do not require a developer database to exist before planning
```

### 17.2 Additive field changes

For supported additive field changes:

```text
- optional field: safe migration scaffold
- required field with default: safe migration scaffold with default
- required field without default: block or require manual migration strategy
- enum field: generate enum and default when required
```

### 17.3 Destructive changes

Block by default:

```text
- model removal
- field removal
- incompatible field type change
- enum value removal
- relation removal
- database/ORM change
```

Required confirmation kinds may include:

```text
confirm_destructive
confirm_data_loss
confirm_manual_migration_review
confirm_target_rewrite
```

### 17.4 Verification database

Use an isolated test database for verification when integration tests run.

Do not apply generated migrations silently to a developer’s production-like database.

---

## 18. Guarantee Implementation Plan

### 18.1 Guarantee compiler

Implement guarantee compilation as deterministic pattern matching plus structured long-form predicate support.

Unknown short-form guarantees fail in normal V1 mode.

Unsupported guarantees are diagnostics-only in V1 and block normal apply. They must not become agent instructions, fake generated tests, or normal coverage entries.

Guarantee coverage statuses are:

```text
covered
partially_covered
manual
missing
```

### 18.2 Supported guarantee: `no_unsanitized_html_persisted`

Category:

```text
security_safety or data_integrity
```

Applies to:

```text
string/text fields sanitized by workflow steps
```

Generated implementation expectations:

```text
- workflow sanitizes Post.content before insert
- persisted value is sanitized
- validator and workflow tests include unsafe HTML input
```

Generated tests:

```text
tests/generated/createPost.htmlSafety.test.ts
```

Acceptance:

```text
- unsafe HTML input does not persist unsanitized content
- test fails if sanitization step is removed or bypassed
```

### 18.3 Supported guarantee: `notification_failure_does_not_rollback_post`

Category:

```text
transactional_behavior
```

Applies to:

```text
workflow with insert_model step and notify_users step using non-required integration
```

Generated implementation expectations:

```text
- insert completes before notification side effect
- notification failure is best-effort, record_error, or retry_then_continue
- post persistence is not rolled back by notification failure
```

Generated tests:

```text
tests/generated/createPost.notificationFailure.test.ts
```

Static drift detector:

```text
Flag generated workflow pattern where notify is awaited inside the same transaction callback that inserts Post.
```

Acceptance:

```text
- test simulates PushProvider failure
- post remains persisted
- workflow returns successful or expected non-rollback response
```

### 18.4 Supported guarantee: `post_creation_p95_latency <= 200ms`

Category:

```text
latency
```

V1 status:

```text
partially_verifiable
```

Generated artifacts:

```text
- load test scaffold or skipped Vitest test with explicit partially_covered status
- verification report warning
```

Acceptance:

```text
- Arch does not claim production proof
- plan/report state limitation clearly
- guarantee coverage marks partially_covered
```

---

## 19. Risk Register and Mitigations

| Risk | Impact | Mitigation | Milestone owner |
|---|---|---|---|
| Parser scope grows too large | Delays core sync loop | Implement only V1 grammar; parse reserved constructs only to reject them clearly | M2 |
| Canonical IR instability | False diffs and unreliable sync | Golden hash fixtures; canonical JSON tests; no timestamps/random IDs | M4 |
| Validation order ambiguity | Inconsistent implementation | Adopt AST → draft IR → validation → canonical IR; document decision | M3/M4 |
| Generated backend too complex | Prototype stalls before sync proof | Generate boring minimal Fastify/Prisma backend; defer production OAuth/provider completeness | M5 |
| Prisma migration edge cases | Data-loss risk | Generate scaffolds; validate additive migrations; block destructive changes | M5/M11 |
| Diff engine emits broad diffs | Minimal patch goal fails | Use entity-level comparators and specific diff types; test every common change | M8 |
| Dependency graph under-includes artifacts | Incomplete patches | Golden affected-artifact tests for each diff type | M9 |
| Dependency graph over-includes artifacts | Patches too broad | Assert touched files in E2E fixtures | M9/M11 |
| Ownership mistakes overwrite user code | High trust loss | Generated/custom separation; ownership/write_scope preflight before write; patch allowlists | M11/M12 |
| LLM output is broad or invalid | Unsafe patching | Do not use LLM until patch schema, allowlist, ownership/write_scope checks, and verification are enforced | M13 |
| Repair loop becomes autonomous | Unsafe behavior | Max 3 attempts; allowlisted files; no destructive repairs; no human-owned edits | M14 |
| Guarantee tests are brittle | False failures | Start with three supported patterns; mark latency partially_covered | M5/M12 |
| Drift detection overclaims semantic understanding | Bad trust | Limit drift claims to hashes, missing artifacts, and specific static patterns | M12 |
| Docker/Postgres environment instability | E2E flaky | Separate unit tests from Docker integration tests; use isolated test DB; allow local skip for non-release tests | M6/M15 |
| Plan staleness not detected | Applying wrong patch | Store base/next/artifact/ownership hashes and recompile before apply | M7/M10/M11 |
| Metadata corruption | Broken sync state | Atomic writes; schema validation; restore-from-Git instructions | M7/M15 |
| Generated code not inspectable | Product principle failure | Clear structure, readable templates, traceability headers, no hidden runtime magic | M5 |

---

## 20. Non-Goals and Deliberate Postponements

### 20.1 Product non-goals

```text
- no frontend generation
- no visual no-code builder
- no prompt-to-app free-form generation
- no hidden runtime that replaces generated code
- no general autonomous coding agent
- no production deployment automation
```

### 20.2 Language non-goals

```text
- no multiple .arch files in V1
- no scalar arrays
- no implicit many-to-many relations
- no cron/schedule/queue/event streaming triggers
- no arbitrary nested JSON schema validation
- no property-based tests
- no arbitrary natural language guarantees as executable contracts
```

### 20.3 Generated backend non-goals

```text
- no production OAuth provider completeness
- no full observability stack
- no production SLO enforcement
- no advanced queue system
- no distributed transaction handling
- no full external provider SDK support
```

### 20.4 Sync non-goals

```text
- no automatic destructive migrations
- no silent generated artifact deletion
- no synchronization of arbitrary legacy repositories
- no full semantic analysis of arbitrary TypeScript
- no broad full-regeneration on every change
- no patching human-owned files by default
```

### 20.5 Agent non-goals

```text
- no agent planning from scratch
- no agent parsing of .arch
- no agent deciding semantic diffs
- no agent choosing destructive migration behavior
- no agent weakening guarantees
- no agent marking verification as passed
```

---

## 21. V1 Release Criteria

V1 is complete when all of the following are true:

```text
1. A developer can write a backend.arch file for SocialFeed-style backend service.
2. arch parse validates syntax and semantics with source-location diagnostics.
3. arch parse --emit-ir emits deterministic arch.ir.v1.
4. arch plan produces readable initial generation and incremental sync plans.
5. arch apply generates a working TypeScript/Fastify/Prisma backend.
6. Generated code passes typecheck and generated tests.
7. Generated guarantee tests exist for supported guarantee patterns.
8. Modifying backend.arch to add Post.visibility produces a model_field_added typed diff.
9. The visibility change applies as a minimal patch to affected files only.
10. Human-owned custom code is not overwritten.
11. Generated file drift is detected.
12. At least one guarantee-related drift is detected or reported through a supported static check/test failure.
13. arch repair can fix at least one generated-code failure through a bounded loop.
14. Destructive changes are blocked by default.
15. Failed verification prevents IR/metadata promotion.
16. Final Git diff is reviewable.
17. Unsupported V1 features fail with clear diagnostics.
```

---

## 22. Engineering Workstreams

### 22.1 Compiler workstream

Owns:

```text
- parser
- AST
- source mapping
- semantic validation
- canonical IR
- IR schema validation
- entity IDs and hashing
```

Primary milestones:

```text
M2, M3, M4
```

### 22.2 Generator workstream

Owns:

```text
- generated project structure
- Prisma schema/migrations
- Fastify app/routes/workflows
- validators
- integration stubs
- tests and guarantee tests
```

Primary milestones:

```text
M5, M11, M12
```

### 22.3 Sync workstream

Owns:

```text
- snapshots
- diff engine
- dependency graph
- artifact mapper
- ownership manager
- planner
- patch validator/applier
```

Primary milestones:

```text
M7, M8, M9, M10, M11, M12
```

### 22.4 Verification workstream

Owns:

```text
- verifier
- drift detector
- guarantee coverage report
- repair loop
```

Primary milestones:

```text
M6, M12, M14
```

### 22.5 Agent workstream

Owns:

```text
- agent task protocol
- deterministic test provider
- optional LLM provider interface
- repair agent contract
- output validation
```

Primary milestones:

```text
M13, M14
```

### 22.6 Developer experience workstream

Owns:

```text
- CLI output
- examples
- docs
- demo script
- stable exit codes
- fixture updates
```

Primary milestones:

```text
M1, M15
```

---

## 23. Suggested Initial Task Backlog

### 23.1 Foundation tasks

```text
- Create pnpm workspace.
- Add TypeScript build/test configs.
- Add arch-cli executable stub.
- Add shared Diagnostic type.
- Add shared Result type.
- Add path normalization and safety checks.
- Add SHA-256 hash utility.
- Add fixture loader.
```

### 23.2 Parser tasks

```text
- Implement lexer token types.
- Implement source span tracking.
- Implement system/target parser.
- Implement model/field parser.
- Implement field-level index modifier parsing.
- Implement reserved named/composite index parsing for diagnostic rejection.
- Implement enum, duration, string, number parsing.
- Implement integration parser.
- Implement custom block parser, including reserved test_generator syntax for diagnostic rejection.
- Implement workflow trigger parser.
- Implement workflow steps parser.
- Implement guarantee block parser.
- Implement syntax diagnostics.
- Add AST snapshot fixtures.
```

### 23.3 IR tasks

```text
- Define TypeScript interfaces for arch.ir.v1.
- Implement entity ID normalization.
- Implement source map builder.
- Implement draft IR builder.
- Implement target defaults.
- Implement field constraint normalization.
- Implement field-level model index normalization.
- Implement relation normalization.
- Implement inverse model_ref_list relation view handling with non-persisted storage.
- Implement workflow step normalization.
- Implement CustomExtensionIR compilation and validation.
- Reject custom kind test_generator.
- Implement supported guarantee pattern compiler.
- Implement diagnostics-only unsupported guarantee handling.
- Implement GuaranteeCoverageIR statuses: covered, partially_covered, manual, missing.
- Implement ArtifactIR generation metadata.
- Implement OwnershipIR write_scope.
- Implement canonical JSON serializer.
- Implement canonical_hash computation.
- Add IR golden tests.
```

### 23.4 Generator tasks

```text
- Implement generated file header helper.
- Implement package.json template.
- Implement tsconfig and Vitest config templates.
- Implement Docker Compose template.
- Implement Prisma schema template.
- Implement model type template.
- Implement validator template.
- Implement Fastify app/server templates.
- Implement route template.
- Implement workflow template for CreatePost pattern.
- Implement integration stub templates.
- Implement custom extension stub templates.
- Implement generated test templates.
- Implement guarantee test templates.
```

### 23.5 Sync tasks

```text
- Implement IR snapshot store.
- Implement initial_generation diff mode.
- Implement SyncPlanV1 schema.
- Implement plan summary renderer.
- Implement artifact mapping rules.
- Implement ownership planning.
- Preserve ArtifactIR generation metadata in artifact map.
- Preserve OwnershipIR write_scope in ownership map.
- Implement apply preflight.
- Implement patch schema.
- Implement patch validator.
- Implement patch applier.
- Implement metadata staging and promotion.
```

### 23.6 Incremental tasks

```text
- Implement entity flattening for diff engine.
- Implement model field comparator.
- Implement model index comparator and model_index_* diffs.
- Implement workflow comparator.
- Implement integration comparator.
- Implement custom extension comparator and custom_extension_* diffs.
- Implement guarantee comparator.
- Block system/trigger changes as unsupported diffs.
- Implement risk classification.
- Implement dependency graph builder.
- Implement affected artifact resolver.
- Implement model_field_added patch plan.
- Implement Prisma enum/field addition patching.
- Implement validator/model/route/workflow/test update patching.
```

### 23.7 Verification and drift tasks

```text
- Implement command runner.
- Implement verification report JSON.
- Implement verification report Markdown.
- Implement ownership hash check.
- Implement write_scope enforcement.
- Implement generated file drift detector.
- Implement missing artifact detector.
- Implement missing guarantee test detector.
- Implement notification transaction static detector.
- Implement repair plan schema.
- Implement deterministic repair provider.
```

---

## 24. Definition of Done for the First Prototype

The first prototype is done when this sequence works from a clean directory:

```bash
arch init --template social-feed
arch plan
arch apply
pnpm test
cp examples/social-feed/v2-visibility/backend.arch backend.arch
arch plan
arch apply
pnpm test
arch check
```

Required evidence:

```text
- canonical IR v1 and v2 files exist
- typed diff contains model_field_added(Post.visibility)
- sync plan lists affected artifacts
- apply only touches affected generated files
- generated tests pass before and after sync
- artifact-map includes generation metadata after verification
- ownership metadata includes write_scope after verification
- final diff is reviewable
```

The first prototype may use deterministic patching only. It must still include the agent task protocol skeleton so V1 can add constrained agents without redesigning the patch path.

---

## 25. Definition of Done for V1

V1 is done when the prototype criteria are met plus:

```text
- all CLI commands are implemented
- semantic validation covers V1 language scope
- diff engine covers supported V1 diff types
- custom extensions compile to CustomExtensionIR and generate create-only typed stubs
- field-level indexes compile, diff, plan, and patch; named/composite source indexes are rejected
- guarantee coverage reports only covered, partially_covered, manual, and missing
- planner handles destructive and ambiguous changes conservatively
- ownership enforcement protects generated, custom, and extension-point files using write_scope
- artifact-map preserves generation metadata
- drift detection covers generated hash drift, missing artifacts, missing generated tests, and at least one guarantee-related pattern
- repair loop is bounded and tested
- agent protocol is implemented and validated, even if real provider is optional
- generated guarantee coverage is reported
- failure modes produce stable diagnostics
- E2E demo is documented and reproducible
```

---

## 26. Implementation Principles to Keep During Build

```text
- Do not let raw source text drive generation.
- Do not let agents decide semantic changes.
- Do not let agents parse .arch, create sync plans from scratch, bypass ownership, modify human-owned files, weaken guarantees, or mark verification passed.
- Do not write files during plan.
- Do not promote metadata after failed verification.
- Do not modify human-owned files by default.
- Do not silently perform destructive migrations.
- Do not claim unsupported guarantees are verified.
- Do not broaden the target stack before the sync loop is reliable.
- Do not hide generated implementation behind runtime magic.
- Do not optimize for breadth before the SocialFeed vertical slice is excellent.
```
