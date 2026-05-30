# PRODUCT_SPEC.md

# Product Spec: Arch V1

## Product Name

Working name: **Arch**

---

## Product Definition

Arch is a **spec-to-code synchronization system for AI-generated backend software**.

Developers write a structured `.arch` specification describing backend models, workflows, integrations, constraints, policies, and behavioral guarantees. Arch parses and validates the specification into canonical `arch.ir.v1`, computes minimal typed intent diffs when the spec changes, constrains deterministic templates and LLM agents to patch affected implementation regions, and verifies the resulting code against generated tests and declared guarantees.

---

## Product Objective

The V1 objective:

```text
A developer can write a backend.arch file, generate a working backend service, modify the spec, and have Arch produce a minimal verified code patch that keeps the implementation synchronized with the spec.
```

V1 is not about generating every kind of application.

V1 is about proving the sync loop:

```text
Parser → AST → draft semantic model/draft IR → semantic validation → canonical IR → IR schema validation → IR snapshot store → typed diff → dependency graph → sync plan → deterministic templates/constrained agents → verification → metadata promotion → reviewable diff
```

---

## Target User

Primary user:

```text
Senior software engineers building backend workflow services, internal tools, SaaS backends, and AI-native systems.
```

Secondary users:

```text
- technical founders
- staff engineers prototyping new systems
- platform engineers building internal workflow infrastructure
- AI engineers building LLM-powered backend processes
```

The product assumes the user is technical.

Arch should not hide code, tests, plans, diffs, or failure modes.

---

## User Problem

Developers can already use LLMs to generate code, but current workflows are not durable enough for serious systems.

Pain points:

```text
- Prompt-generated code loses the original intent.
- Requirements are not preserved as executable artifacts.
- Agents make broad, unpredictable edits.
- Generated code drifts after manual changes.
- Tests are not directly connected to requirements.
- Regenerating after requirement changes is unsafe.
- Human-owned code can be overwritten.
- Architecture decisions are scattered across implementation details.
```

The user needs a way to make AI-generated software:

```text
- structured
- synchronized
- inspectable
- testable
- reviewable
- repairable
```

---

## Product Thesis

The `.arch` spec should become the source of truth for the backend system.

The implementation should become an inspectable, testable, maintainable build artifact.

```text
System intent is declared in .arch.
Implementation is synchronized from that declaration.
Verification determines whether the implementation is acceptable.
```

---

## V1 Scope

V1 should support one narrow category:

```text
TypeScript backend workflow services.
```

A backend workflow service includes:

```text
- API routes
- data models
- database schema
- business workflows
- integrations
- generated tests
- local runtime configuration
```

V1 should support exactly one primary `backend.arch` file and one generated backend service per Arch project.

V1 should not attempt frontend generation, arbitrary app generation, mobile apps, multi-service distributed systems, multi-language support, multiple backend frameworks, or arbitrary framework targets.

---

## V1 Default Stack

Pick one default stack for V1.

Recommended default:

```text
Language: TypeScript
Runtime: Node.js
Framework: Fastify
Database: PostgreSQL
ORM: Prisma
Cache: Redis by default; `cache: none` is allowed
Testing: Vitest
Local runtime: Docker Compose
Package manager: pnpm
```

Do not support multiple stacks in V1 unless absolutely necessary.

A single well-supported stack is better than shallow support for many stacks.

---

## Core User Journey

### First-Time Generation

```text
1. Developer writes backend.arch.
2. Developer runs arch plan.
3. Arch parses and validates the spec, emits canonical IR, and produces an implementation plan.
4. Developer reviews the plan.
5. Developer runs arch apply.
6. Arch generates the backend service.
7. Arch runs tests and checks.
8. Arch promotes IR and metadata only after verification succeeds.
9. Developer reviews the git diff.
```

### Spec Change Sync

```text
1. Developer modifies backend.arch.
2. Developer runs arch plan.
3. Arch compiles the current spec to canonical IR and validates the IR schema.
4. Arch compares the previous verified IR snapshot and current IR.
5. Arch shows a typed intent diff.
6. Arch maps the diff through the dependency graph to affected artifacts.
7. Developer runs arch apply.
8. Arch patches only affected generated files or generated regions.
9. Arch runs verification and promotes metadata only on success.
10. Developer reviews the final diff.
```

### Drift Detection

```text
1. Developer or agent changes implementation code.
2. Developer runs arch check.
3. Arch compares generated artifact hashes, generated-region hashes, ownership metadata, required generated tests, and supported static guarantee checks against the latest canonical IR.
4. Arch reports deterministic drift and any explicitly limited guarantee-drift findings.
5. Developer runs arch repair or manually fixes the issue.
```

---

## V1 CLI Commands

### `arch init`

Initializes an Arch project.

Expected behavior:

```text
- creates backend.arch starter file
- creates .arch metadata directory
- optionally scaffolds an empty backend project when requested
- does not generate a full backend service unless apply is run
```

Generated structure:

```text
.arch/
  ir.current.json
  ir.previous.json
  artifact-map.json
  ownership.json
  source-map.json
  drift.json
  plans/
  runs/
  repair-history/
  locks/
  tmp/
```

---

### `arch parse backend.arch`

Parses the `.arch` file.

Expected behavior:

```text
- validates syntax
- validates semantic requirements
- can emit AST with source spans
- can emit canonical IR
- validates canonical IR against arch.ir.v1
- reports errors with line references
```

Example output:

```text
Parsed backend.arch successfully.

System: SocialFeed
Target: node.fastify
Models: User, Post
Workflows: CreatePost
Integrations: PushProvider, LLMModeratorGuardrail
Guarantees: 3
```

---

### `arch plan`

Creates a sync plan.

Expected behavior:

```text
- loads current backend.arch
- parses to AST
- builds draft semantic model or draft IR
- validates semantics
- emits and schema-validates canonical IR
- loads previous IR if present
- computes typed intent diff
- builds dependency graph and affected artifact list
- generates sync plan
- identifies missing requirements
- identifies destructive changes
- outputs human-readable plan
```

Example output:

```text
Plan: Add Post.visibility

Intent diff:
- Model Post added field visibility
- Type: enum["public", "private", "followers"]
- Default: "public"

Affected artifacts:
- prisma/schema.prisma
- prisma/migrations/*
- src/generated/models/post.ts
- src/generated/routes/posts.ts
- src/generated/workflows/createPost.ts
- tests/generated/postVisibility.test.ts

Planned actions:
- Add Prisma enum PostVisibility
- Add Post.visibility column migration
- Update POST /posts validation schema
- Update feed filtering logic
- Generate tests for public/private/followers visibility

Risk level: low
Destructive: false
Requires confirmation: false
```

---

### `arch apply`

Applies a generated plan.

Expected behavior:

```text
- applies deterministic template changes where possible
- invokes constrained patch agents where needed
- updates generated files and generated regions
- preserves human-owned files
- updates tests
- stages artifact map and ownership metadata updates
- runs verification
- promotes IR and metadata only after verification succeeds
- produces git diff
```

Rules:

```text
- must not silently overwrite human-owned files
- must not perform destructive migrations without explicit confirmation
- must not modify unrelated files
- must produce a reviewable diff
```

---

### `arch check`

Checks whether the implementation conforms to the latest spec.

Expected behavior:

```text
- compiles current spec to IR
- checks generated artifact map
- checks ownership rules
- runs tests
- runs type checks
- detects drift in generated regions
- detects supported static guarantee violations where possible
- does not claim full semantic equivalence for arbitrary TypeScript
```

Example output:

```text
Drift detected.

Guarantee:
- notification_failure_does_not_rollback_post

Issue:
- push notification is awaited inside the post creation transaction

Suggested repair:
- dispatch notification after transaction commit
- add retry policy
```

---

### `arch repair`

Attempts to repair failed checks.

Expected behavior:

```text
- reads failed tests, type errors, lint errors, or drift reports
- creates a constrained repair plan
- invokes repair agent with file allowlist
- applies minimal patch
- re-runs verification
- promotes metadata only after successful verification
- stops after bounded attempts
```

Recommended V1 max attempts:

```text
3
```

Repair must not become an infinite autonomous loop.

---

## `.arch` Language Scope for V1

V1 should support these primitives:

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

---

## Example V1 Spec

```arch
system SocialFeed {
  target {
    runtime: node.fastify
    database: postgres
    orm: prisma
    cache: redis
    auth: oauth.github
  }

  model User {
    id: uuid primary
    username: string unique required
    bio: string max 280
  }

  model Post {
    id: uuid primary
    author: User required
    content: string max 5000
    created_at: timestamp
  }

  integration LLMModeratorGuardrail {
    kind: llm_moderation
    required: true
  }

  integration PushProvider {
    kind: push
    required: false
  }

  workflow CreatePost {
    trigger: api.POST("/posts")

    steps {
      validate input
      moderate Post.content using LLMModeratorGuardrail
      sanitize Post.content as html_safe
      insert Post
      update FeedCache for author.followers
      notify mentioned_users via PushProvider
    }

    guarantees {
      no_unsanitized_html_persisted
      notification_failure_does_not_rollback_post
      post_creation_p95_latency <= 200ms
    }
  }
}
```

---

## System Architecture

V1 architecture:

```text
backend.arch
   ↓
Parser
   ↓
AST
   ↓
Draft semantic model / draft IR
   ↓
Semantic Validator
   ↓
Canonical IR
   ↓
IR Schema Validator
   ↓
IR Snapshot Store
   ↓
Typed Diff Engine
   ↓
Dependency Graph
   ↓
Sync Plan
   ↓
Deterministic Templates / Patch Generator
   ↓
Constrained LLM Agents
   ↓
Generated Code + Tests
   ↓
Verification
   ↓
Repair Loop
   ↓
Metadata Promotion
   ↓
Git Diff
```

---

## Core Components

### 1. Parser

Responsibilities:

```text
- parse .arch syntax
- produce AST
- report syntax errors
- preserve source locations
```

V1 uses custom readable `backend.arch` syntax backed by a simple grammar.

The parser must preserve enough location information to map generated artifacts back to spec lines.

---

### 2. Draft Semantic Model / Draft IR Builder

Responsibilities:

```text
- build symbol table
- expand target defaults
- resolve shorthand where possible
- attach source locations
- produce a draft semantic model or draft IR for validation
```

The draft form is not a generation contract.

It exists so semantic validation can run before canonical IR is accepted.

---

### 3. Semantic Validator

Responsibilities:

```text
- validate required declarations
- validate references between models and workflows
- validate integration references
- validate unsupported features
- detect incomplete specs
- reject unsupported target values instead of treating them as hints
```

Example validation errors:

```text
Workflow CreatePost references PushProvider, but no PushProvider integration is declared.

Model Post field author references User, but User model does not exist.

Guarantee post_creation_p95_latency requires a numeric latency threshold.
```

---

### 4. Canonical IR Generator

Responsibilities:

```text
- normalize validated semantics into stable JSON IR
- remove syntax-level ambiguity
- create deterministic ordering
- generate stable IDs for entities
- emit IR for diffing and planning
```

The IR should be stable even if the `.arch` formatting changes.

Formatting changes should not produce implementation diffs.

---

### 5. IR Schema Validator

Responsibilities:

```text
- validate canonical IR against arch.ir.v1
- reject unresolved references, unsupported entities, and invalid metadata
- ensure source locations, artifact intent, ownership intent, and verification metadata are well-formed
```

Downstream diffing, planning, patching, verification, and drift detection must consume schema-valid canonical IR.

---

### 6. IR Snapshot Store

Responsibilities:

```text
- persist candidate and previous verified IR snapshots
- maintain stable hashes for plan validation
- prevent stale plans from applying to changed specs or metadata
- promote the current IR only after successful apply and verification
```

Expected stable metadata:

```text
.arch/ir.current.json
.arch/ir.previous.json
.arch/artifact-map.json
.arch/ownership.json
.arch/source-map.json
.arch/drift.json
.arch/plans/
.arch/runs/
.arch/repair-history/
.arch/locks/
.arch/tmp/
```

---

### 7. Typed Diff Engine

Responsibilities:

```text
- compare previous IR and current IR
- produce typed intent diffs
- classify changes
- identify additive, modifying, destructive, and ambiguous changes
```

Example diff types:

```text
model_added
model_removed
model_field_added
model_field_removed
model_field_type_changed
workflow_added
workflow_removed
workflow_step_added
workflow_step_removed
workflow_step_reordered
integration_added
integration_removed
guarantee_added
guarantee_removed
policy_changed
target_changed
```

Diff classification:

```text
Additive:
- new optional field
- new test
- new non-required integration

Modifying:
- field max length changed
- workflow step changed
- latency threshold changed

Destructive:
- model removed
- required field removed
- database provider changed
- field type changed incompatibly

Ambiguous:
- workflow step renamed
- guarantee changed without clear mapping
- integration provider changed with unknown migration strategy
```

---

### 8. Dependency Graph

Responsibilities:

```text
- map IR entities to generated artifacts
- determine affected files for each intent diff
- prevent unnecessary edits
```

Example mapping:

```text
Model Post →
  prisma/schema.prisma
  src/generated/models/post.ts
  src/generated/validators/post.ts
  tests/generated/postModel.test.ts

Workflow CreatePost →
  src/generated/workflows/createPost.ts
  src/generated/routes/posts.ts
  tests/generated/createPost.test.ts

Guarantee no_unsanitized_html_persisted →
  tests/generated/htmlSafety.test.ts
```

---

### 9. Sync Planner

Responsibilities:

```text
- convert typed diffs into implementation plans
- choose deterministic templates when possible
- decide when agent synthesis is needed
- identify missing information
- identify destructive changes
- produce machine-readable sync plan and human-readable summary
```

Planner output should include:

```text
- summary
- typed diff
- affected artifacts
- planned actions
- required agents
- metadata updates
- verification handoff
- generated tests
- risk level
- confirmation requirements
```

---

### 10. Patch Generator

Responsibilities:

```text
- apply deterministic template changes
- prepare agent tasks
- enforce file allowlists
- update generated code regions
- stage metadata updates
```

The patch generator should prefer deterministic edits for:

```text
- model types
- validation schemas
- simple route scaffolds
- migration skeletons
- generated test scaffolds
```

Agents should be used when the change requires synthesis or adaptation.

---

### 11. Constrained LLM Agents

Agents should be specialized.

Possible V1 agents:

```text
Schema Agent
API Agent
Workflow Agent
Integration Agent
Test Agent
Repair Agent
```

Each agent receives:

```text
- typed diff
- relevant IR fragment
- current file contents
- allowed files
- forbidden files
- implementation constraints
- expected tests
- output format
```

Agents should not receive broad instructions such as:

```text
Update the app.
```

They should receive constrained tasks such as:

```text
Apply model_field_added(Post.visibility) to these files only.
Preserve all existing behavior.
Do not modify human-owned files.
Generated tests must pass.
```

---

### 12. Verifier

Responsibilities:

```text
- run type checks
- run unit tests
- run integration tests
- run generated guarantee tests
- verify ownership rules
- report failures
```

V1 verification commands:

```bash
pnpm prisma generate
pnpm typecheck
pnpm test
```

Required when configured:

```bash
pnpm lint
```

Optional V1:

```text
- generated smoke tests
- Docker Compose integration test
- migration validation
```

---

### 13. Repair Loop

Responsibilities:

```text
- read verifier failures
- create targeted repair tasks
- invoke repair agent
- apply minimal patch
- rerun verification
- stop after bounded attempts
```

Repair loop constraints:

```text
- maximum 3 attempts
- no destructive edits
- no unrelated files
- every repair must produce a diff summary
```

---

## Generated Project Structure

Recommended generated backend structure:

```text
.
├── backend.arch
├── package.json
├── pnpm-lock.yaml
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

---

## Ownership Rules

Arch must distinguish between generated and human-owned code.

### Fully Generated Files

Safe for Arch to update.

Example:

```text
src/generated/models/post.ts
tests/generated/createPost.test.ts
```

### Human-Owned Files

Arch must not modify without explicit permission.

Example:

```text
src/custom/postRankingStrategy.ts
tests/custom/postRanking.test.ts
```

### Mixed Files

If mixed files are necessary, use generated regions.

Example:

```ts
// <arch-generated id="post-validator">
export const PostInputSchema = z.object({
  content: z.string().max(5000)
})
// </arch-generated>
```

Generated regions should be avoided where possible. Extension points are cleaner.

---

## Extension Points

Arch should generate calls into custom files rather than forcing users to edit generated files.

Example spec:

```arch
workflow CreatePost {
  steps {
    validate input
    call custom PostRankingStrategy
    insert Post
  }
}
```

Generated code:

```ts
import { postRankingStrategy } from "../../custom/postRankingStrategy"

await postRankingStrategy(post)
```

Human-owned file:

```text
src/custom/postRankingStrategy.ts
```

Arch should create stubs but not overwrite completed custom implementations.

---

## Behavioral Guarantees

Guarantees are first-class product objects.

They are not comments.

Each guarantee should map to at least one of:

```text
- generated unit test
- generated integration test
- static check
- runtime assertion
- manual verification warning
```

Example guarantee mapping:

```text
Guarantee:
no_unsanitized_html_persisted

Generated tests:
- rejects unsafe HTML input
- sanitizes allowed HTML
- persists sanitized content only

Relevant files:
- src/generated/workflows/createPost.ts
- src/generated/validators/post.ts
- tests/generated/htmlSafety.test.ts
```

If Arch cannot verify a guarantee, it should say so.

Example:

```text
Guarantee declared:
post_creation_p95_latency <= 200ms

V1 limitation:
Arch can generate a load test scaffold, but cannot prove production p95 latency locally.

Status:
partially verifiable
```

---

## Handling Missing Information

Arch should stop when the spec is underspecified.

Example:

```arch
steps {
  send email digest if user is offline
}
```

If no email provider is declared, `arch plan` should report:

```text
Cannot safely plan change.

Missing integration:
- email provider

Options:
- declare integration Resend
- declare integration SendGrid
- declare SMTP integration
- mark email provider as custom
```

Do not let agents invent major architecture choices silently.

---

## Destructive Changes

Destructive changes require explicit confirmation.

Examples:

```text
- removing a model
- removing a field or required field
- adding a required persistent field without a default
- changing database provider
- changing field type incompatibly
- removing a workflow
- deleting an integration referenced by generated code or guarantees
- weakening or removing a guarantee
```

Example output:

```text
Destructive change detected:
- Model Post removed

Potential effects:
- drop posts table
- delete generated Post routes
- delete CreatePost workflow references
- remove generated tests

Action required:
Run with --confirm-destructive or revise spec.
```

V1 should be conservative.

When uncertain, stop and ask for explicit developer action through the CLI.

---

## V1 Example Demo

A good V1 demo should show the following sequence.

### Step 1: Initial Spec

Developer writes:

```text
backend.arch
```

with:

```text
- User model
- Post model
- CreatePost workflow
- LLM moderation integration
- Push notification integration
- three guarantees
```

### Step 2: Plan

Developer runs:

```bash
arch plan
```

Arch outputs:

```text
- target stack
- generated files
- migrations
- tests
- guarantees
- risk level
```

### Step 3: Apply

Developer runs:

```bash
arch apply
```

Arch generates:

```text
- Fastify service
- Prisma schema
- route handlers
- workflow logic
- integration stubs
- tests
- Docker Compose setup
```

Tests pass.

### Step 4: Spec Change

Developer adds:

```arch
visibility: enum["public", "private", "followers"] default "public"
```

to `Post`.

### Step 5: Sync Plan

Developer runs:

```bash
arch plan
```

Arch outputs:

```text
Intent diff:
- Post.visibility added

Patch plan:
- update Prisma schema
- create migration
- update validators
- update feed filtering
- add visibility tests
```

### Step 6: Apply Patch

Developer runs:

```bash
arch apply
```

Arch produces a minimal diff.

### Step 7: Drift Detection

Developer manually changes generated workflow code in a way that violates:

```text
notification_failure_does_not_rollback_post
```

Developer runs:

```bash
arch check
```

Arch reports the drift.

### Step 8: Repair

Developer runs:

```bash
arch repair
```

Arch moves notification dispatch outside the transaction, updates generated tests where required, and verification passes.

This demo proves the core product.

---

## Acceptance Criteria

V1 is acceptable if it can do the following reliably.

### Generation

```text
- parse a valid backend.arch file
- validate semantics
- generate canonical IR
- validate canonical IR against arch.ir.v1
- produce a plan
- generate a working backend service
- generate tests
- pass local verification
```

### Sync

```text
- detect a model field addition
- detect a workflow step addition
- detect a guarantee addition
- produce typed intent diffs
- map diffs to affected artifacts
- apply minimal patches
- avoid unrelated edits
```

### Code Ownership

```text
- preserve human-owned files
- update generated files safely
- respect generated regions if used
- maintain artifact-map.json
- maintain ownership.json
- promote metadata only after successful verification
```

### Verification

```text
- run type checks
- run tests
- generate tests from guarantees
- report failed checks clearly
- attempt bounded repair
```

### Developer Experience

```text
- plans are readable
- diffs are reviewable
- failures are understandable
- destructive changes are blocked by default
- generated code is inspectable
```

---

## V1 Non-Goals

V1 should not support:

```text
- frontend generation
- arbitrary app generation
- mobile apps
- multiple .arch files
- more than one generated backend service per project
- arbitrary backend languages
- multiple backend frameworks
- arbitrary runtime, ORM, database, or cache targets beyond V1 target values
- multi-service orchestration
- Kubernetes deployment
- production cloud deployment
- complex auth providers beyond one default or stub
- complex event streaming
- implicit many-to-many relations
- scalar array persistence
- full formal verification
- autonomous long-running agents
- unconstrained agents
- agent planning from scratch
- synchronization of arbitrary legacy repositories
- automatic destructive migrations
- hidden no-code runtime
```

The point of V1 is to prove spec-to-code synchronization, not to build a universal app generator.

---

## Suggested Milestones

### Milestone 0: Static Prototype

Goal:

```text
Generate a backend from one hardcoded example spec.
```

Deliverables:

```text
- example backend.arch
- generated IR
- generated file tree
- generated tests
```

No sync required.

---

### Milestone 1: Parser and IR

Goal:

```text
Parse real backend.arch files into canonical IR.
```

Deliverables:

```text
- parser
- draft semantic model or draft IR builder
- semantic validator
- IR generator
- IR schema validator
- source location mapping
- error reporting
```

---

### Milestone 2: Initial Generator

Goal:

```text
Generate a working backend service from IR.
```

Deliverables:

```text
- Fastify service
- Prisma schema
- migrations
- model validators
- route handlers
- workflow implementation
- integration stubs
- generated tests
- Docker Compose
```

---

### Milestone 3: Intent Diff and Plan

Goal:

```text
Detect changes between previous IR and current IR.
```

Deliverables:

```text
- IR snapshot storage
- typed diff engine
- dependency graph
- sync plan schema
- human-readable plan output
```

---

### Milestone 4: Incremental Apply

Goal:

```text
Apply minimal patches for common spec changes.
```

Supported changes:

```text
- add model
- add model field
- add workflow
- add workflow step
- add integration stub
- add guarantee
```

---

### Milestone 5: Verification and Repair

Goal:

```text
Run tests and attempt bounded repairs.
```

Deliverables:

```text
- verifier
- failure parser
- repair agent
- max attempt limit
- final diff summary
```

---

### Milestone 6: Drift Detection

Goal:

```text
Detect when generated implementation no longer matches declared spec.
```

Deliverables:

```text
- ownership checks
- generated region checks
- artifact map validation
- at least one guarantee drift detector
```

---

## Technical Decisions and Deferred Options

These should stay consistent with the V1 scope before serious implementation.

### DSL Format

V1 decision:

```text
- custom Arch syntax
```

Deferred options:

```text
- YAML
- JSON
- TypeScript-based DSL
```

Recommendation:

```text
Use custom readable backend.arch syntax for V1 and compile to strict JSON IR.
JSON is the canonical IR format, not the authoring format.
Do not use a TypeScript DSL in V1 because it blurs source intent with implementation code.
```

---

### ORM

V1 decision:

```text
- Prisma
```

Deferred option:

```text
- Drizzle
```

Recommendation:

```text
Use Prisma for V1 because migrations, schema, and generated client are familiar and demo-friendly.
Drizzle and other ORMs are deferred beyond V1.
```

---

### Generated Code Strategy

Options:

```text
- fully generated files
- generated regions
- extension points
- hybrid
```

Recommendation:

```text
Use fully generated files plus human-owned extension points.
Avoid mixed files unless necessary.
```

---

### Agent Provider

Options:

```text
- single LLM API
- local model
- pluggable provider
```

Recommendation:

```text
Keep provider abstraction simple. Do not make provider flexibility a core V1 feature.
```

---

### Verification Depth

V1 decision:

```text
- typecheck
- unit tests
- selected integration tests
- generated guarantee tests
```

Deferred options:

```text
- property tests
- deeper runtime assertions
```

Recommendation:

```text
V1 should support typecheck, unit tests, selected integration tests, and generated guarantee tests.
```

---

## Product Principle

Arch should always show its work.

For every sync, the user should be able to see:

```text
- what changed in the spec
- what changed in the IR
- which files are affected
- what patches were planned
- what agents were invoked
- what tests were generated
- what verification passed or failed
- what final diff was produced
```

No hidden magic.

No silent broad rewrites.

No untraceable agent behavior.

---

## Final V1 Definition

V1 is done when Arch can demonstrate this complete loop:

```text
Write backend.arch
   ↓
Parser
   ↓
AST
   ↓
Draft semantic model/draft IR
   ↓
Semantic validation
   ↓
Canonical IR
   ↓
IR schema validation
   ↓
Generate working backend
   ↓
Modify backend.arch
   ↓
IR snapshot store
   ↓
Compute typed intent diff
   ↓
Build dependency graph
   ↓
Plan minimal sync patch
   ↓
Apply deterministic templates/constrained agent changes
   ↓
Generate/update tests
   ↓
Verify behavior
   ↓
Promote metadata
   ↓
Detect drift
   ↓
Repair one bounded failure
   ↓
Produce reviewable git diff
```

That is the product.
