# Contributing to Arch

Thanks for your interest in Arch — a spec-to-code synchronization system for
TypeScript backend workflow services. This guide covers setup, the test-first
workflow we expect, and how to get a change merged.

## Ground rules

- **`founding-docs/` is the product source of truth.** Arch's scope is defined
  there (and summarized in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)). New
  behavior should map to that scope, not expand it ad hoc.
- **Never weaken a trust boundary.** Ownership/allowlist checks, verification
  gates, and metadata-promotion rules exist to make generated code trustworthy.
  Changes that loosen them need a very good reason and explicit review.
- **Generated output is deterministic.** The same IR must produce byte-identical
  files. If you touch a template, keep it deterministic (no timestamps, no random
  values, no absolute paths in output).

## Setup

Requires **Node ≥ 20.10** and **pnpm ≥ 9**.

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test          # 230+ unit tests; gated integration tests skip by default
```

The repo is a pnpm monorepo:

| Package | Responsibility |
|---|---|
| `@arch/language` | lexer + recursive-descent parser + AST |
| `@arch/ir` | draft IR, semantic validator, canonicalize, IR schema |
| `@arch/generator` | deterministic TS/Fastify/Prisma templates |
| `@arch/sync` | diff engine, dependency graph, planner, patcher, migrations |
| `@arch/verifier` | verification runner, drift + static-guarantee detectors |
| `@arch/agents` | constrained agent task protocol + providers |
| `@arch/cli` | `init` / `parse` / `plan` / `apply` / `check` / `repair` |

## Test-first workflow (required)

Every behavior change starts with a test. Use this loop:

1. **Identify the acceptance criterion** from `founding-docs/` or the relevant
   doc.
2. **Write or update a focused failing test** (unit, integration, or e2e).
3. **Run it and confirm it fails for the intended reason** — not a typo, the
   missing behavior.
4. **Implement the smallest correct change** to make it pass.
5. **Run the focused test, then the package suite.**
6. **Run the full verification** before opening a PR.

For existing behavior where pure TDD is awkward, write a **characterization
test** that locks current behavior first, then refactor. Either way, a meaningful
change should have one of: a failing unit test, a failing integration test, a
failing e2e assertion, or a short written reason another method fits better.

We use [Vitest](https://vitest.dev). Run a single file:

```sh
pnpm --filter @arch/cli test -- apply-lifecycle
```

## Full verification (run before a PR)

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
pnpm e2e
pnpm update-goldens     # must produce no changes
git diff --check
```

### Gated tests

Some tests are heavy or need external services and are **skipped by default**:

| Gate | Command | Needs |
|---|---|---|
| Generated-project install + verify | `ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts` | network (pnpm install) |
| Real Postgres persistence | `ARCH_RUN_POSTGRES=1 DATABASE_URL=... pnpm --filter @arch/cli test -- src/__tests__/prisma-postgres.test.ts` | Docker/Postgres |
| Live LLM provider | `ARCH_RUN_LIVE_LLM=1 ARCH_LLM_API_KEY=... pnpm --filter @arch/agents test -- test/live-provider.test.ts` | API key (billable) |

See [`docs/STRESS_TESTING.md`](docs/STRESS_TESTING.md),
[`docs/PERSISTENCE.md`](docs/PERSISTENCE.md), and
[`docs/PROVIDERS.md`](docs/PROVIDERS.md).

## Goldens / snapshots

`pnpm update-goldens` regenerates snapshots deterministically. If it changes
files, your change altered generated output — review the diff and include it in
your PR (and explain why the output changed).

## Pull requests

1. Branch from `main`.
2. Keep changes scoped; prefer existing patterns over new abstractions.
3. Include tests for behavior changes.
4. Ensure the full verification above passes and `git status` is clean.
5. Fill in the PR template (what changed, which tests prove it, any limitations).
6. Be honest in docs: don't claim unsupported behavior as complete — document
   limitations explicitly.

By contributing, you agree your contributions are licensed under the project's
[Apache-2.0 license](LICENSE).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it.
