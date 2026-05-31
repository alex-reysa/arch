# Public V1 Goal

This document defines the next phase after `docs/V1_READINESS_REPORT.md`.
The current codebase has proven the deterministic Arch thesis internally. The
next target is **Public V1**: a release that outside developers can clone,
run, inspect, stress, break, and contribute to with clear expectations.

## Current State

Arch currently has a strong internal V1 candidate:

- `backend.arch` is compiled through the real language and IR pipeline.
- Canonical IR, typed diffs, sync plans, apply, verification, drift detection,
  and bounded repair are demonstrated end to end.
- `pnpm typecheck`, `pnpm test`, the gated apply/verify integration test,
  `pnpm e2e`, and `git diff --check` passed for the V1 readiness report.
- `docs/V1_READINESS_REPORT.md` records the evidence and the known deferrals.

Known gaps that matter before open source:

- Real LLM provider integration is not implemented. The agent protocol and
  deterministic provider are implemented and tested, but no provider calls a
  model and `arch apply` does not route planned actions through the
  orchestrator.
- Generated runtime persistence defaults to an in-memory Prisma-like store.
  Prisma schema and migration scaffolds are generated, but a real
  Prisma/Postgres runtime path is not yet proven.
- Community stress readiness needs more explicit abuse tests, docs, and CI
  framing.

## Desired State

Arch Public V1 is ready when an external developer can:

- clone the repository,
- install dependencies,
- run the SocialFeed demo,
- inspect generated code and traceability metadata,
- understand what is supported and what is intentionally not supported,
- stress the compiler/sync/repair loop,
- optionally exercise a real constrained LLM provider,
- optionally exercise a real Prisma/Postgres persistence path,
- contribute changes using a documented test-first workflow.

Public V1 is not the final product. It is the first release where the core
product claim is credible to outside users.

## Product Thesis

Public V1 must prove the core inversion from `founding-docs/CONCEPT.md`:

```text
The Arch-owned generated service substrate becomes the build artifact.
System intent becomes the source of truth.
```

Concrete meaning:

1. `backend.arch` is the durable source of truth.
2. The real compiler pipeline parses, validates, and canonicalizes intent.
3. Spec edits produce typed intent diffs, not guessed code edits.
4. Plans map diffs to affected artifacts with explicit ownership boundaries.
5. Apply changes implementation only through validated plans.
6. Generated code is real, inspectable, traceable, and testable.
7. Verification gates metadata promotion.
8. Drift is detected when generated code diverges from intent.
9. Repair is bounded, allowlisted, and verification-gated.
10. LLM-assisted work, if used, is constrained by Arch's task protocol and
    cannot bypass validation, ownership, or verification.

## Non-Negotiable Outcomes

Before calling Public V1 done:

- The CLI must use the real `@arch/language` and `@arch/ir` pipeline. No
  divergent parser shim may be reintroduced.
- Every public product claim must have passing evidence or an explicit
  documented limitation.
- Real LLM integration must be behind `AgentProvider` and validated by
  `AgentOrchestrator`; no provider can parse `.arch`, decide diffs, write
  outside allowlists, modify human-owned files, weaken guarantees, or mark
  verification passed.
- Real LLM tests must include mocked provider integration. Optional live tests
  must be gated by environment variables and skipped by default.
- The generated backend must have a credible Prisma/Postgres runtime path.
  Hermetic in-memory tests may remain the default, but the real persistence path
  must be documented and tested behind a Docker/Postgres gate where feasible.
- Drift and repair must include both positive and negative demos.
- Stress and abuse cases must cover stale plans, corrupted metadata, invalid
  agent output, path escape attempts, forbidden human-owned edits, failed
  verification, repair attempt caps, and generated artifact drift.
- New contributors must be able to understand setup, architecture, tests,
  limitations, security expectations, and contribution workflow.

## Test-First Rule

Use Superpowers as process discipline only:

- test-driven-development
- systematic-debugging
- code review before completion
- verification-before-completion

Do not use Superpowers to redefine the product. The product source of truth is
`founding-docs/`.

Every behavior change must begin with one of:

- a failing unit test,
- a failing integration test,
- a failing e2e assertion,
- a characterization test that locks current behavior before refactoring,
- or a short written reason why another verification method is more appropriate.

Default loop:

1. Identify the acceptance criterion from `founding-docs/` or this document.
2. Write or update the focused failing test.
3. Confirm the failure is for the intended reason.
4. Implement the smallest correct change.
5. Run the focused test.
6. Run relevant package checks.
7. Include the change in the final integration pass.

## Required Workstreams

### 1. Real Constrained LLM Provider Path

Goal: prove Arch can use an actual model without weakening the compiler
boundary.

Required:

- Add one real provider adapter behind `AgentProvider`.
- Keep provider disabled unless explicitly configured.
- Do not add provider logic to the compiler, planner, verifier, or drift
  detector.
- Add mocked-provider tests first.
- Add optional live-provider test gated by env vars.
- Route at least one low-risk planned action through `AgentOrchestrator`, or
  document why Public V1 keeps live LLM provider as manually invokable only.
- Persist enough run metadata for review: provider id, model id, task id,
  action id, artifact id, task hash, output validation result, and attempts.

Acceptance evidence:

- `packages/arch-agents` tests prove invalid model output is rejected.
- A mocked provider integration test proves the apply/agent boundary.
- Optional live test documentation explains required env vars and safety gates.

### 2. Prisma/Postgres Persistence Path

Goal: remove ambiguity around generated runtime persistence.

Required:

- Keep the hermetic in-memory path for fast local tests.
- Add or document a generated Prisma-backed adapter behind the same runtime DB
  interface.
- Add Docker/Postgres-gated verification where feasible.
- Ensure generated migrations are inspectable and validated against the real
  schema path.

Acceptance evidence:

- Generated project still passes hermetic typecheck/tests.
- A gated integration test proves create/read behavior through Prisma/Postgres,
  or the report explicitly documents why that remains deferred.

### 3. Stress And Abuse Testing

Goal: make community stress testing less likely to expose trust-boundary holes.

Required scenarios:

- repeated spec edit -> plan -> apply cycles,
- stale plan rejected,
- corrupt metadata rejected,
- generated file hash drift detected,
- missing generated file/test detected,
- static guarantee drift detected,
- repair fixes allowed generated drift,
- repair refuses human-owned files,
- repair stops after max attempts,
- invalid agent output rejected,
- path traversal and forbidden path attempts rejected,
- destructive/confirmation-required changes blocked by default.

Acceptance evidence:

- Unit/integration/e2e tests cover each scenario, or a checklist maps the
  scenario to existing tests.

### 4. Open Source Documentation

Goal: make the project usable and reviewable by someone outside the original
development sessions.

Required docs:

- top-level README quickstart,
- architecture overview,
- contributor guide,
- security policy,
- roadmap or known limitations,
- example walkthrough,
- provider configuration docs,
- generated project inspection guide,
- stress/e2e guide.

Acceptance evidence:

- A new contributor can follow the quickstart from a clean clone.
- Docs clearly state what runs by default and what requires Docker or provider
  env vars.
- No public doc claims unsupported behavior as complete.

### 5. CI And Release Hygiene

Goal: make the public branch safe to accept outside contributions.

Required:

- CI runs install, build/typecheck, unit tests, e2e, and diff checks.
- Gated tests are documented and runnable locally.
- No secrets, local paths, or machine-specific assumptions in committed files.
- Generated snapshots/goldens update deterministically.
- License and contribution files are present or explicitly deferred.

Acceptance evidence:

- CI workflow exists and reflects supported commands.
- `pnpm update-goldens` is deterministic.
- `git status` is clean after final verification.

## Final Public V1 Gates

Run from a clean tree:

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
pnpm e2e
pnpm update-goldens
git diff --check
```

If added, also run:

```sh
ARCH_RUN_POSTGRES=1 pnpm test -- --runInBand
ARCH_RUN_LIVE_LLM=1 pnpm --filter @arch/agents test -- test/live-provider.test.ts
```

The exact gated commands may change, but the final readiness report must list
the commands that actually ran, their exit codes, and any skipped gates.

## Final Deliverable

Create `docs/PUBLIC_V1_READINESS_REPORT.md` with:

- verdict,
- exact commit/branch,
- commands run and results,
- product thesis evidence,
- open-source readiness checklist status,
- LLM integration status,
- Prisma/Postgres status,
- stress/abuse coverage map,
- known limitations,
- risks for community testing,
- next recommended issues.

Do not call Public V1 complete unless the report is specific enough for an
external reviewer to reproduce the result.
