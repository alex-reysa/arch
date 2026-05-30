# CONCEPT.md

# Concept: The Meta-Coding Inversion

## Summary

Arch is built around a simple inversion:

```text
Implementation code becomes the build artifact.
System intent becomes the source of truth.
```

The high-level vision is that developers should not spend most of their time manually encoding every implementation detail. Instead, they should define system intent, constraints, workflows, policies, and behavioral guarantees in a structured specification. The implementation should then be generated, synchronized, tested, and repaired by a deterministic compiler with constrained LLM-assisted patching where synthesis is useful.

The technical version is more precise:

```text
Arch is a spec-to-code synchronization system for AI-generated backend software.
It compiles structured system intent into a typed intermediate representation, computes minimal intent diffs, constrains LLM agents to patch affected implementation regions, and verifies the resulting code against generated tests and declared guarantees.
```

The product is not “AI writes code from prompts.”

The product is:

```text
A durable specification layer for AI-generated software.
```

For V1, that framing has a narrow product meaning:

```text
TypeScript backend workflow services.
```

The V1 target is one generated backend service per project, described by one primary source file:

```text
backend.arch
```

The default V1 stack is fixed:

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

The V1 command surface is:

```text
arch init
arch parse backend.arch
arch plan
arch apply
arch check
arch repair
```

V1 is not a frontend generator, mobile generator, arbitrary app generator, arbitrary language target, arbitrary framework target, multi-service orchestrator, cloud deployment system, complex event-streaming platform, full formal verification system, unconstrained autonomous agent, hidden no-code runtime, implicit many-to-many mapper, scalar array persistence layer, or a system that performs destructive migrations without explicit confirmation.

---

## The Problem With Current AI Coding

LLMs can generate code quickly.

That is no longer the hard part.

The hard part is making generated code:

```text
- durable
- synchronized with requirements
- architecturally coherent
- safe to modify
- testable
- explainable
- maintainable over time
```

Most AI coding workflows are still prompt-based:

```text
User prompt → LLM output → developer edits → requirements drift
```

This is useful for small tasks, but weak for long-lived systems.

The problems compound over time:

```text
- The original intent disappears.
- Architecture decisions are buried in code.
- Generated code drifts from requirements.
- Tests are not directly tied to guarantees.
- Agents make broad edits with unclear boundaries.
- Human-owned code and generated code get mixed.
- Changing requirements requires another vague prompt.
```

Arch exists because AI-generated software needs a source of truth above code.

---

## The Inversion

Traditional software development:

```text
Human writes source code
   ↓
Compiler builds executable
   ↓
System runs
```

Arch-style development:

```text
Human writes system intent
   ↓
Compiler creates typed IR
   ↓
Agents generate or patch implementation
   ↓
Verification checks conformance
   ↓
System runs
```

The point is not that code disappears.

Code remains essential.

It must be readable, testable, debuggable, and deployable.

The point is that implementation code should not be the only durable representation of the system. Code tells us what exists, but often fails to preserve why it exists, what constraints matter, and which behaviors are non-negotiable.

Arch makes intent explicit.

---

## Why Natural Language Alone Is Not Enough

Natural language is expressive, but it is not reliable enough as the source of truth for software.

A prompt like this is useful:

```text
Build a social feed where users can create posts and followers are notified.
```

But it leaves critical questions unanswered:

```text
- What database should be used?
- What are the exact models?
- What is the API contract?
- What happens if notification delivery fails?
- Should post creation rollback if push notification fails?
- Should content moderation happen before persistence?
- What is the latency target?
- What tests prove the behavior is correct?
```

Natural language is good for intent discovery.

It is weak as an executable contract.

Arch uses structured intent instead:

```arch
workflow CreatePost {
  trigger: api.POST("/posts")

  steps {
    validate input
    moderate Post.content using LLMModeratorGuardrail
    sanitize Post.content as html_safe
    insert Post
    notify mentioned_users via push
  }

  guarantees {
    no_unsanitized_html_persisted
    notification_failure_does_not_rollback_post
    post_creation_p95_latency <= 200ms
  }
}
```

This is still human-readable, but now it can be parsed, normalized, diffed, tested, and verified.

---

## Why Code Alone Is Too Low-Level

Code is precise, but it frequently loses intent.

This code is specific:

```ts
await createPost(input)
await sendPushNotification(user)
```

But the system intent is ambiguous:

```text
- Is notification required or best-effort?
- Should notification be inside the database transaction?
- Should notification failure rollback post creation?
- Should notification be retried?
- Is this business-critical behavior or incidental implementation?
```

Arch captures this at the specification level:

```arch
guarantees {
  notification_failure_does_not_rollback_post
  notification_delivery_retried up_to 3 times
}
```

This gives the compiler and agents an explicit behavioral contract.

The implementation can change, but the guarantee remains stable.

---

## The Middle Layer

Arch is neither pure natural language nor ordinary source code.

It is a middle layer with five properties:

```text
human-readable
machine-parseable
version-controlled
agent-constrainable
verification-oriented
```

This middle layer allows developers to describe systems in terms of:

```text
- entities
- workflows
- triggers
- policies
- constraints
- integrations
- guarantees
```

The language should be expressive enough to describe real software, but structured enough to support deterministic compilation and safe synchronization.

---

## The Core Mechanism

Arch works through a compiler-like pipeline.

```text
backend.arch
   ↓
Parser
   ↓
AST
   ↓
draft semantic model/draft IR
   ↓
semantic validation
   ↓
canonical IR
   ↓
IR schema validation
   ↓
IR snapshot store
   ↓
typed diff
   ↓
dependency graph
   ↓
sync plan
   ↓
deterministic templates/constrained agents
   ↓
verification
   ↓
metadata promotion
```

If verification fails, a bounded repair loop may run against allowlisted generated files and then verification repeats. Metadata is promoted only after required verification succeeds.

The LLM is not the compiler.

The LLM is a tool used inside the compiler.

This distinction matters.

A free-form LLM workflow asks:

```text
Can you update the app based on this new requirement?
```

Arch asks:

```text
Given this typed diff, patch these affected implementation regions,
preserve these files, satisfy these guarantees, and pass these tests.
```

That is the difference between prompt-based coding and spec-to-code synchronization.

---

## The Role of the Intermediate Representation

The typed intermediate representation is the most important technical artifact.

The `.arch` file is what humans write.

The IR is what the compiler understands.

Example IR shape:

```json
{
  "schema_version": "arch.ir.v1",
  "canonical_hash": "sha256:...",
  "system": {
    "id": "system.SocialFeed",
    "kind": "system",
    "name": "SocialFeed"
  },
  "target": {
    "id": "target.primary",
    "kind": "target",
    "language": "typescript",
    "runtime": "node.fastify",
    "database": "postgres",
    "orm": "prisma",
    "cache": "redis"
  },
  "models": [
    {
      "id": "model.Post",
      "kind": "model",
      "name": "Post",
      "fields": [
        {
          "id": "model.Post.field.id",
          "name": "id",
          "type": "uuid",
          "primary": true
        },
        {
          "id": "model.Post.field.content",
          "name": "content",
          "type": "string",
          "max": 5000
        },
        {
          "id": "model.Post.field.created_at",
          "name": "created_at",
          "type": "timestamp"
        }
      ]
    }
  ],
  "workflows": [
    {
      "id": "workflow.CreatePost",
      "kind": "workflow",
      "name": "CreatePost",
      "trigger": {
        "kind": "api",
        "method": "POST",
        "path": "/posts"
      },
      "steps": [
        "validate_input",
        "moderate_post_content",
        "sanitize_post_content",
        "insert_post",
        "notify_mentioned_users"
      ],
      "guarantees": [
        "no_unsanitized_html_persisted",
        "notification_failure_does_not_rollback_post"
      ]
    }
  ],
  "artifacts": [],
  "ownership": [],
  "sources": [],
  "verification": {
    "commands": ["pnpm typecheck", "pnpm test"]
  }
}
```

The IR enables:

```text
- semantic validation
- schema validation
- typed diffs
- minimal patch planning
- artifact mapping
- ownership enforcement
- generated test derivation
- drift detection
- deterministic compiler behavior
```

Without an IR, Arch collapses into a prompt wrapper.

With an IR, Arch becomes a real sync system.

---

## Intent Diffs

A normal coding agent sees a changed file and guesses what to do.

Arch should compute what changed.

Example spec change:

```arch
model Post {
  id: uuid primary
  content: string max 5000
  visibility: enum["public", "private", "followers"] default "public"
}
```

The IR diff should say:

```text
Change type: model_field_added
Model: Post
Field: visibility
Type: enum
Values: public, private, followers
Default: public
```

From there, the planner can determine affected artifacts:

```text
- database schema
- migration
- model type
- validation schema
- route handler
- workflow logic
- feed query
- generated tests
```

This is the core of the sync system.

The agent is not responsible for discovering the entire meaning of the change. The compiler structures the change before the agent acts.

---

## Constrained Agents

Arch can use multiple constrained agents rather than one general agent.

The planner, diff engine, dependency graph, verifier, and metadata promotion gate are deterministic compiler components. Agents do not decide semantic diffs, choose the sync plan from scratch, weaken guarantees, write outside allowlists, or mark verification as passed.

Possible agent roles:

```text
Schema Agent
API Agent
Workflow Agent
Integration Agent
Test Agent
Repair Agent
```

Each agent receives a narrow task.

Example Schema Agent input:

```text
Typed diff:
- Post.visibility enum added with default public

Allowed files:
- prisma/schema.prisma
- prisma/migrations/*
- src/generated/models/post.ts

Requirements:
- preserve existing Post fields
- create forward migration
- do not modify route handlers
- produce valid Prisma schema
```

This kind of constraint is what makes agentic coding credible.

The first implementation can use deterministic templates for most generation and patching. The agent protocol matters because any LLM-assisted step must be bounded before it is allowed to touch implementation files.

---

## Generated Code Must Be Inspectable

Arch should not hide the output.

The generated code should be real code that engineers can inspect.

Design principles:

```text
- No hidden runtime magic
- No opaque generated blobs
- Clear folder structure
- Clear generated file headers
- Clear extension points
- Clear ownership metadata
- Clear diffs
```

A developer should be able to answer:

```text
- Which spec line produced this file?
- Which guarantee produced this test?
- Which files are safe for Arch to update?
- Which files are human-owned?
- Why did Arch make this change?
```

Generated code should be boring.

The system around it should be powerful.

---

## Verification Is the Difference

The biggest risk with AI-generated code is plausibility without correctness.

Arch should make verification a first-class concern.

The spec should not only say what to build.

It should say what must always be true.

Examples:

```arch
guarantees {
  no_unsanitized_html_persisted
  notification_failure_does_not_rollback_post
  payment_over_1000_requires_human_approval
  every_llm_decision_has_audit_log
}
```

Arch should turn guarantees into:

```text
- tests
- assertions
- static checks
- integration scenarios
- runtime policies where appropriate
- manual or partial verification status when V1 cannot prove the guarantee
```

Unsupported guarantees must be rejected or reported explicitly. Arch must not generate fake tests that imply unsupported behavior has been verified.

The system is only as strong as its ability to reject incorrect generated code.

---

## Sync, Not One-Shot Generation

The most important feature is not initial code generation.

The most important feature is ongoing synchronization.

A one-shot generator answers:

```text
Can we produce a backend from this prompt?
```

Arch asks:

```text
Can we keep a real backend synchronized with a changing system spec over time?
```

That means Arch must handle:

```text
- additive changes
- breaking changes
- destructive changes
- manual edits
- generated-code drift
- failed tests
- ambiguous requirements
- extension points
```

The ideal loop:

```text
Edit backend.arch → arch plan → arch apply → verification → review diff
```

The system should feel deterministic even when LLMs are involved.

---

## Drift Detection

Drift happens when implementation behavior no longer matches the declared system intent.

Example:

```arch
guarantees {
  notification_failure_does_not_rollback_post
}
```

But the code does:

```ts
await db.transaction(async tx => {
  const post = await createPost(tx, input)
  await sendPushNotification(post)
})
```

This violates the guarantee because notification failure could rollback post creation.

Where this pattern is statically detectable or covered by generated tests, Arch should report:

```text
Drift detected:
- Guarantee: notification_failure_does_not_rollback_post
- Current behavior: push notification is awaited inside post transaction
- Suggested repair: dispatch notification after transaction commit through background queue
```

This is more valuable than generation alone.

Generation creates software.

Drift detection keeps software aligned.

---

## Product Principle: No Magic Without Traceability

Arch should never say:

```text
I updated the app.
```

It should say:

```text
I detected these intent changes.
I mapped them to these artifacts.
I planned these edits.
I changed these files.
I generated these tests.
These checks passed.
These checks failed.
Here is the diff.
```

Every generated artifact should have a traceable reason.

Every agent edit should have an explicit input.

Every test should connect back to a declared requirement or guarantee.

---

## What Engineers Should Believe After Reading This

Arch is not trying to eliminate engineers.

It is trying to move engineering work to a higher layer.

The engineer’s job becomes:

```text
- define precise system intent
- design durable guarantees
- review generated plans
- inspect critical code
- approve destructive migrations and manual migration strategies
- handle ambiguous tradeoffs
- extend behavior through owned code
```

The compiler and agents handle:

```text
- boilerplate generation
- repetitive implementation
- synchronization after spec changes
- test generation
- mechanical patching
- repair loops
```

This is not less engineering.

It is engineering at a different abstraction level.

---

## Long-Term Vision

In the long run, Arch could become a control plane for AI-generated software.

The system spec could eventually describe:

```text
- backend services
- frontend routes
- data models
- workflows
- agents
- integrations
- permissions
- observability
- deployment policies
- compliance requirements
```

These are long-term possibilities, not V1 commitments.

But the first version should be narrow.

The right first target is not “generate any app.”

The right first target is:

```text
Generate and synchronize one TypeScript/Fastify/Prisma backend workflow service from one backend.arch file.
```

That is specific enough to build.

It is also broad enough to matter.

---

## Final Framing

Use this hierarchy when explaining Arch:

```text
One-liner:
Arch is a spec-to-code synchronization system for AI-generated backend software.

Core inversion:
Implementation code becomes the build artifact. System intent becomes the source of truth.

Technical thesis:
Arch uses canonical typed IR, typed intent diffs, dependency-aware sync plans, deterministic templates, constrained agentic patching, and verification against generated tests and behavioral guarantees.

Practical loop:
Edit backend.arch → arch plan → arch apply → verification → review diff.
```
