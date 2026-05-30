# README.md

# Arch

Arch is a **spec-to-code synchronization system for AI-generated backend software**.

Developers define system intent through a structured `.arch` specification describing models, workflows, integrations, constraints, policies, and behavioral guarantees. Arch parses and semantically validates that specification, compiles it into canonical typed IR, computes minimal intent diffs when the spec changes, constrains LLM agents to patch only affected implementation regions, and verifies the resulting code against generated tests and declared guarantees.

The core inversion is simple:

```text
Implementation code becomes the build artifact.
System intent becomes the source of truth.
```

Arch is not a prompt-to-app toy, a no-code platform, or a free-roaming coding agent. It is a developer tool for keeping real backend codebases synchronized with a durable, typed specification of what the system is supposed to do.

---

## Category

```text
Spec-to-code synchronization system
AI-native backend compiler
Intent-driven software development tool
```

The closest analogy is a combination of:

```text
Terraform apply
Prisma migrate
TypeScript compiler
GitHub Copilot-style coding agents
CI verification
```

Terraform synchronizes infrastructure with declared state.

Arch synchronizes application code with declared system intent.

---

## Core Thesis

LLMs make implementation generation cheap, but they do not automatically make software engineering reliable.

The missing layer is a durable artifact above implementation code.

Today, most AI coding workflows look like this:

```text
Prompt → generated code → human cleanup → drifting codebase
```

Arch changes the workflow to this:

```text
System spec → typed IR → intent diff → patch plan → constrained agent edits → tests → verification → reviewable diff
```

The `.arch` file is not just a prompt. It is a structured, version-controlled system contract.

---

## Technical Thesis

Arch introduces four technical primitives:

```text
1. Typed system intent
2. Minimal intent diffs
3. Constrained agentic patching
4. Verification against tests and behavioral guarantees
```

Together, these make AI-generated code maintainable after the first generation.

### 1. Typed System Intent

Developers write a `.arch` file describing the system at a higher level than source code.

It includes:

```text
- data models
- workflows
- API triggers
- integrations
- target backend stack
- policies
- constraints
- guarantees
- tests
```

### 2. Minimal Intent Diffs

Arch compiles semantically valid `.arch` input into a canonical intermediate representation.

When the spec changes, Arch compares:

```text
previous IR ↔ current IR
```

This produces a typed diff such as:

```text
Model Post added field visibility
Workflow CreatePost added step send_email_digest
Guarantee notification_failure_does_not_rollback_post changed
Integration PushProvider added
```

The system does not ask an LLM to guess what changed. It computes the change.

### 3. Constrained Agentic Patching

LLM agents do not freely rewrite the codebase.

They receive:

```text
- the typed diff
- the affected files
- the relevant implementation regions
- ownership rules
- acceptance criteria
- test expectations
```

They are constrained to produce minimal patches.

### 4. Verification

Arch generates or updates tests from declared guarantees.

The resulting code must pass:

```text
- type checks
- unit tests
- integration tests
- generated guarantee tests
- static checks
- drift checks
```

The goal is not to generate code that merely looks plausible.

The goal is to generate code that satisfies the declared system contract.

---

## What Arch Is

Arch is a CLI and compiler workflow for backend software.

A developer writes:

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

Arch turns this into a real backend implementation:

```text
- TypeScript service
- Fastify routes
- Prisma schema
- PostgreSQL migration files or migration scaffolds
- Redis cache logic when `cache: redis` is selected
- workflow implementation
- integration stubs
- generated tests
- local Docker Compose environment
- runtime config
- verification report
- Arch metadata
```

---

## What Arch Is Not

### Not a Prompt-to-App Generator

Arch does not treat a single prompt as the source of truth.

The source of truth is a structured spec that can be parsed, diffed, versioned, tested, and synchronized.

### Not a No-Code Tool

Arch does not hide the implementation.

Generated code must be:

```text
- readable
- inspectable
- reviewable
- debuggable
- testable
- deployable
```

Developers should be able to open the generated files and understand what is happening.

### Not a Free-Roaming Agent

Arch does not ask an agent to “update the app” in an unconstrained way.

Agents operate inside a compiler workflow.

```text
Bad:
“Update this repo based on the new requirements.”

Good:
“Apply this typed diff to these implementation regions, preserve these manual files, satisfy these tests, and do not modify unrelated code.”
```

### Not Full Regeneration on Every Change

Arch should not delete and regenerate the whole codebase.

The sync model is incremental:

```text
small spec change → small patch
large spec change → structured migration plan
destructive change → explicit developer decision
```

---

## Core Workflow

The intended development loop:

```text
1. Developer edits backend.arch
2. Developer runs arch plan
3. Arch parses the spec
4. Arch builds a draft semantic model or draft IR
5. Arch runs semantic validation
6. Arch emits canonical IR and validates the IR schema
7. Arch stores the candidate IR snapshot
8. Arch computes the typed intent diff
9. Arch produces a sync plan
10. Developer reviews the plan
11. Developer runs arch apply
12. Arch patches the codebase with deterministic templates or constrained agents
13. Arch runs verification
14. Arch promotes IR and metadata only after verification succeeds
15. Developer reviews the final git diff
```

CLI shape:

```bash
arch init
arch parse backend.arch
arch plan
arch apply
arch check
arch repair
```

---

## Sync Model

The sync model is the heart of Arch.

Canonical pipeline wording:

```text
Parser -> AST -> draft semantic model/draft IR -> semantic validation -> canonical IR -> IR schema validation -> IR snapshot store -> typed diff -> dependency graph -> sync plan -> deterministic templates/constrained agents -> verification -> metadata promotion
```

```text
backend.arch
   ↓
Parser
   ↓
AST
   ↓
Draft Semantic Model / Draft IR
   ↓
Semantic Validation
   ↓
Canonical IR
   ↓
IR Schema Validation
   ↓
IR Snapshot Store
   ↓
Typed Diff
   ↓
Dependency Graph
   ↓
Sync Plan
   ↓
Deterministic Templates / Constrained Agents
   ↓
Generated Code + Tests
   ↓
Verification
   ↓
Metadata Promotion
   ↓
Git Diff / PR-ready local changes
```

Example spec change:

```arch
model Post {
  id: uuid primary
  author: User required
  content: string max 5000
  visibility: enum["public", "private", "followers"] default "public"
  created_at: timestamp
}
```

Typed diff:

```text
Model Post:
- added field visibility
- type enum
- values public, private, followers
- default public
```

Patch plan:

```text
- Add Prisma enum PostVisibility
- Add migration for Post.visibility
- Update generated Post model
- Update POST /posts validation
- Update feed filtering logic
- Add visibility tests
```

The LLM agent does not decide from scratch what the change means. The compiler narrows the task before the agent touches the code.

---

## File Ownership

Arch must preserve developer control.

Generated projects should distinguish between:

```text
1. Fully generated files
2. Human-owned files
3. Generated regions inside mixed files
4. Extension points
```

Example structure:

```text
src/
  generated/
    models/
    routes/
    workflows/
    integrations/
  custom/
    postRankingStrategy.ts
    notificationPolicy.ts
  app.ts
tests/
  generated/
  custom/
.arch/
  ir.previous.json
  ir.current.json
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

The compiler can safely update generated files and generated regions.

Human-owned files, completed extension points, and unrelated files should never be overwritten without explicit permission.

---

## Behavioral Guarantees

The most important part of the `.arch` language is not the model declaration.

It is the guarantee declaration.

Supported V1 short-form examples:

```arch
guarantees {
  no_unsanitized_html_persisted
  notification_failure_does_not_rollback_post
  post_creation_p95_latency <= 200ms
}
```

Guarantees should drive generated tests, static checks, runtime assertions, and explicit partial or manual verification reporting. Unsupported guarantees must be rejected or marked manual/partial where the schema allows it; they must not become vague instructions for an agent.

This is what separates Arch from “AI writes code.”

---

## V1 Scope

V1 should be narrow.

V1 product framing:

```text
Backend workflow generation and synchronization for TypeScript services.
```

Default stack:

```text
Language: TypeScript
Runtime: Node.js
Framework: Fastify
Database: PostgreSQL
ORM: Prisma
Cache: Redis by default or cache:none
Testing: Vitest
Local runtime: Docker Compose
Package manager: pnpm
```

V1 should support:

```text
- one backend.arch file
- one generated backend service per project
- model declarations
- workflow declarations
- API triggers
- basic integrations as typed stubs or explicit templates
- supported guarantee patterns
- generated tests
- incremental spec sync
- drift checks for generated regions
```

V1 should not support:

```text
- frontend generation
- arbitrary app generation
- backend languages other than TypeScript
- mobile apps
- Kubernetes or production cloud deployment automation
- arbitrary legacy repository synchronization
- multi-service orchestration
- complex distributed systems
- complex event streaming
- implicit many-to-many relations
- scalar array persistence
- full formal verification
- unconstrained or long-running autonomous agents
- destructive migrations without explicit confirmation
- backend frameworks other than Fastify
```

---

## V1 Success Criteria

V1 is successful if a developer can:

```text
1. Write a backend.arch file for a small backend service.
2. Run arch plan and see a clear implementation plan.
3. Run arch apply and get a working TypeScript backend.
4. Run generated tests successfully.
5. Modify the spec.
6. Run arch plan again and see a minimal intent diff.
7. Apply a minimal patch without regenerating the entire codebase.
8. Preserve human-owned custom code.
9. Detect at least one meaningful drift between spec and implementation.
10. Repair at least one failed generated test through a bounded repair loop.
```

A strong V1 demo should show:

```text
Initial spec → generated backend → spec change → minimal patch → tests → drift detection → repair
```

---

## Why This Matters

LLMs are changing the role of developers.

The new bottleneck is no longer only writing implementation code.

The new bottleneck is specifying systems precisely enough that agents can safely generate, modify, verify, and maintain them.

Arch is a step toward that future.

```text
Humans define intent.
The compiler structures the intent.
Agents synthesize implementation.
Verification decides whether the result is acceptable.
```
