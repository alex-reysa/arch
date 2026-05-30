# Arch

**Spec-to-code synchronization for TypeScript backend workflow services.**

Arch makes `backend.arch` the durable source of truth for a backend service.
Implementation code is a build artifact: generated, inspectable, and traceable
back to the intent that produced it. When you change the spec, Arch computes a
typed diff, maps it to the affected artifacts under explicit ownership
boundaries, patches only those files through a validated plan, and gates every
metadata promotion behind verification.

> **Core thesis:** system intent is the source of truth; implementation code is
> an inspectable build artifact. Arch never *guesses* code edits — it derives
> them from a canonical IR and proves them with verification and drift checks.

## The loop

```
backend.arch
   → parse            (recursive-descent parser, source spans)
   → canonical IR     (semantic validation, stable hash, intent preserved)
   → generate         (TypeScript / Fastify / Prisma project, traceability headers)
   → verify           (typecheck + tests gate metadata promotion)
   → edit spec        (developer changes backend.arch)
   → typed diff       (model_field_added, model_index_added, … — not a guess)
   → plan             (affected artifacts + ownership/write-scope decisions)
   → apply            (validated plan patches only allowlisted generated files)
   → verify           (again — promotion only on success)
   → check            (drift: hash, missing, and static guarantee violations)
   → repair           (bounded, allowlisted, verification-gated regeneration)
```

## Quick start

Requires Node ≥ 20.10 and pnpm ≥ 9.

```sh
pnpm install
pnpm build
```

Drive a generated SocialFeed backend from a clean directory:

```sh
mkdir demo && cd demo
cp ../examples/social-feed/v1/backend.arch .

# 1. scaffold .arch/ metadata + src/custom
arch init

# 2. compile the spec to canonical IR (writes .arch/ir.current.json)
arch parse --emit-ir backend.arch

# 3. see exactly what will be created (read-only)
arch plan

# 4. generate the project, install, verify, and promote on success
arch apply

# 5. evolve intent: add Post.visibility (an enum) and re-sync
cp ../examples/social-feed/v2-visibility/backend.arch backend.arch
arch plan      # typed diff: model_field_added + model_index_added
arch apply     # patches only the affected generated files + a migration

# 6. detect drift and repair it
rm tests/guarantees/no_unsanitized_html_persisted.CreatePost.test.ts
arch check     # reports missing_generated_test drift (exit 1)
arch repair    # regenerates it from the IR, re-verifies (exit 0)
arch check     # clean
```

> In this repo, invoke the CLI with
> `pnpm exec tsx packages/arch-cli/src/main.ts <command>` (or build and use the
> `arch` bin). The end-to-end transcript above is automated by `pnpm e2e`.

## Commands

| Command | Purpose | Notable exit codes |
|---|---|---|
| `arch init` | Create `backend.arch` starter + `.arch/` metadata dirs + `src/custom` | 0 |
| `arch parse [--emit-ir] <file>` | Parse + semantically validate; optionally emit canonical IR | 0 ok, 65 diagnostics |
| `arch plan` | Compute typed diff vs baseline, write a read-only `SyncPlanV1` | 0 ok, 1 blocked, 2 error |
| `arch apply [--skip-verify]` | Generate/patch through the plan, install, verify, promote on success | 0 ok, 70 failure (no promotion) |
| `arch check` | Detect drift (hash / missing / static guarantee), write `.arch/drift.json` | 0 clean, 1 drift, 2 error |
| `arch repair [--max-attempts N]` | Regenerate drifted/missing generated files, re-verify, bounded (3) | 0 repaired, 70 unresolved |

## What V1 builds

- One `backend.arch` source file → one generated backend service.
- TypeScript / Node / Fastify, PostgreSQL + Prisma schema, Redis (or `cache: none`),
  Vitest, Docker Compose, pnpm.
- Canonical `arch.ir.v1` with a stable, source-position-independent hash.
- First-class field types including **enums** (`enum["a","b"] default: "a"`),
  relations (many-to-one + one-to-many inverse views), and field-level indexes.
- Typed IR diffs, ownership-bounded sync plans, deterministic patching, and
  inspectable Prisma migration scaffolds.
- Generated guarantee tests for `no_unsanitized_html_persisted` and
  `notification_failure_does_not_rollback_post`; a partial-coverage scaffold for
  latency.
- Ownership/drift metadata, a static guarantee drift detector, a constrained
  agent task protocol (deterministic provider), and a bounded repair loop.

## Persistence: in-memory by default, real Postgres on demand

Generated backends run against an **in-memory store** by default (so the
generated test suite is hermetic), and switch to a **real Prisma/Postgres**
backend with `ARCH_DB=prisma`. Both implement the same `Db`/`Collection<R>`
interface, so the generated `models/*`, routes, workflows, and tests are
identical either way. A gated test proves a real create→read round-trips through
Postgres. See [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md).

## Constrained LLM provider (optional)

Arch ships a **real, model-backed provider** (`HttpLlmProvider`, Anthropic
Messages API or any compatible endpoint), **disabled by default**. The
`AgentOrchestrator` re-validates every provider output, so a model can never
write outside the allowlist, touch human-owned files, or mark verification
passed. In V1 the live provider is **manually invokable** — `arch apply` patches
through deterministic templates. See [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

## V1 cutline / known limitations

- The **default runtime is the in-memory store**; the real Prisma/Postgres
  adapter is opt-in (`ARCH_DB=prisma`). Migration SQL is an inspectable scaffold,
  not `prisma migrate diff` output — validate against real Postgres before
  relying on it.
- Field modifiers are `default:` and `indexed`/`index`; `optional`/`nullable`
  are not part of the V1 grammar (rejected with `ARCH-SEM-018`).
- The LLM provider is **optional and disabled by default**, and is not wired into
  `arch apply` (deterministic templates do the patching). The agent boundary,
  validation, and run metadata are real and tested.
- Workflow `trigger` and target *system* changes are blocked as unsupported
  diffs (not silently applied); destructive changes are blocked without explicit
  confirmation.

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System overview + package map (points to `founding-docs/`) |
| [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md) | In-memory vs real Prisma/Postgres; `ARCH_DB`; gated DB test |
| [`docs/PROVIDERS.md`](docs/PROVIDERS.md) | LLM provider config, trust boundary, live test |
| [`docs/GENERATED_CODE_INSPECTION.md`](docs/GENERATED_CODE_INSPECTION.md) | Reading generated headers + `.arch/` traceability metadata |
| [`docs/STRESS_TESTING.md`](docs/STRESS_TESTING.md) | Abuse/stress scenarios mapped to tests |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup + test-first workflow + PR process |
| [`SECURITY.md`](SECURITY.md) | Reporting vulnerabilities; in-scope boundaries |
| [`docs/PUBLIC_V1_READINESS_REPORT.md`](docs/PUBLIC_V1_READINESS_REPORT.md) | Public V1 verdict, evidence, and known limitations |

## Repository layout

```
packages/arch-language   lexer + recursive-descent parser + AST
packages/arch-ir         draft IR, semantic validator, canonicalize, IR schema
packages/arch-generator  deterministic TS/Fastify/Prisma templates
packages/arch-sync       diff engine, dependency graph, planner, patcher, migrations
packages/arch-verifier   verification runner, drift + static-guarantee detectors
packages/arch-agents     constrained agent task protocol + deterministic provider
packages/arch-cli        init / parse / plan / apply / check / repair
examples/social-feed     v1 + v2-visibility demo specs
scripts/run-e2e.ts       full CLI transcript (pnpm e2e)
founding-docs/           canonical product + implementation specs
```

## Verification

```sh
pnpm typecheck
pnpm test
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
pnpm e2e
```

Optional gated checks (skipped by default):

```sh
# real Postgres persistence (needs Docker/Postgres)
ARCH_RUN_POSTGRES=1 DATABASE_URL=postgres://arch:arch@localhost:5432/arch_app \
  pnpm --filter @arch/cli test -- src/__tests__/prisma-postgres.test.ts

# live LLM provider (needs an API key; billable)
ARCH_RUN_LIVE_LLM=1 ARCH_LLM_API_KEY=sk-... \
  pnpm --filter @arch/agents test -- test/live-provider.test.ts
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and the test-first workflow,
and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security issues: please follow
[`SECURITY.md`](SECURITY.md) (private reporting).

## License

Licensed under the [Apache License 2.0](LICENSE). See [`NOTICE`](NOTICE).
