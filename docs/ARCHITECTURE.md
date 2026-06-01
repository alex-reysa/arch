# Arch — Architecture Overview

A short, contributor-facing map of the Arch monorepo. For the authoritative,
exhaustive specs, see [`founding-docs/`](../founding-docs) (linked at the
bottom). This file is a pointer into them, not a replacement.

## Core thesis

**System intent is the source of truth; the Arch-owned generated service
substrate is an inspectable build artifact.** A developer authors one `backend.arch` spec. Arch compiles it
into a canonical typed IR, computes a *typed* diff when the spec changes, maps
that diff to the affected generated files under explicit ownership boundaries,
patches only those files through a validated plan, and gates every metadata
promotion behind verification. Arch never *guesses* code edits — it derives them
deterministically from the IR and proves them with verification + drift checks.

## The pipeline

```text
backend.arch
   → parse                  @arch/language   lexer + recursive-descent parser → AST + source spans
   → semantic validation    @arch/ir         draft IR, validate references/types, canonicalize → arch.ir.v1 + stable hash
   → typed diff + planning   @arch/sync       diff engine, dependency graph, planner, patcher, migration writer
   → deterministic templates @arch/generator  TS/Fastify/Prisma/Vitest project, traceability headers
   → verify + drift + repair @arch/verifier   verification runner, drift detector, static-guarantee checks
   → CLI                     @arch/cli        init / parse / plan / apply / check / repair orchestration
```

The constrained agent protocol lives in `@arch/agents` (typed task specs,
orchestrator, output validation, providers). It is *library-level*: the
deterministic pipeline above does not route through it in V1 (see cutline).

## Package responsibilities

| Package | What it owns | Key files (`packages/<pkg>/src/`) |
|---|---|---|
| `@arch/language` | Lex + parse `.arch` into an AST with source spans; syntax diagnostics. | `lexer.ts`, `parser.ts`, `ast.ts`, `diagnostics.ts`, `source-map.ts` |
| `@arch/ir` | Draft IR from AST, semantic validation, canonicalization to `arch.ir.v1`, canonical hashing, IR schema validation, entity IDs, source map. | `draft-ir.ts`, `semantic-validator.ts`, `canonicalize.ts`, `canonical-json.ts`, `hash.ts`, `ir-validator.ts`, `schema.ts`, `entity-ids.ts` |
| `@arch/sync` | Typed IR diff, dependency graph → affected artifacts, change planner, patch validation/application, Prisma migration writer, snapshot + metadata stores. | `diff/diff-engine.ts`, `graph/dependency-graph.ts`, `planner/plan-builder.ts`, `patcher/patch-applier.ts`, `patcher/migration-writer.ts`, `snapshots.ts`, `metadata-store.ts` |
| `@arch/generator` | Deterministic templates that render the whole backend project from IR (package.json, Docker Compose, Prisma schema, runtime, Fastify app/routes, models, validators, workflows, policies, integration + custom stubs, guarantee tests). | `generator.ts`, `templates/*.ts`, `prisma-migration-writer.ts`, `naming.ts` |
| `@arch/verifier` | Run install/typecheck/tests inside the generated project, drift detection (hash / missing / static guarantee), report writing. | `verifier.ts`, `command-runner.ts`, `drift-detector.ts`, `guarantee-static.ts`, `reports.ts`, `runInstall.ts` |
| `@arch/agents` | Constrained agent task protocol: typed task specs, orchestrator, structured-output validation, agent roles, and pluggable providers (deterministic + optional HTTP LLM). | `agent-task.ts`, `task-builder.ts`, `orchestrator.ts`, `output-validation.ts`, `providers/*.ts`, `roles/*.ts` |
| `@arch/cli` | User entrypoint + workflow orchestration; the six commands; diagnostics/plan/report printers; project-root resolution; exit codes. | `main.ts`, `commands/{init,parse,plan,apply,check,repair}.ts`, `output/*.ts`, `project-root.ts` |
| `@arch/test-fixtures` | Shared `.arch` fixtures (valid / invalid / drift) accessed by symbolic id across package test suites. | `index.ts`, `fixtures/` |
| `@arch/bench` | Intent-to-code synchronization benchmark harness: drives the real CLI over evolving specs, scores typed-diff sync vs regeneration baselines, and runs the external-validation plumbing. Not part of the product surface. | `main.ts`, `runner/*.ts`, `manifest/*.ts`, `external/*.ts` (see `packages/arch-bench/README.md`) |

### The six CLI commands (`packages/arch-cli/src/commands/`)

| Command | File | Responsibility |
|---|---|---|
| `arch init` | `init.ts` | Scaffold `backend.arch` starter + `.arch/` metadata dirs + `src/custom`. |
| `arch parse [--emit-ir] <file>` | `parse.ts` | Parse + semantically validate; optionally emit canonical IR. Exit 65 on diagnostics. |
| `arch plan` | `plan.ts` | Compute typed diff vs baseline, write a read-only plan. Exit 1 blocked, 2 error. |
| `arch apply [--skip-verify]` | `apply.ts` | Generate/patch through the plan, install, verify, promote on success. Exit 70 on failure (no promotion). |
| `arch check` | `check.ts` | Detect drift (hash / missing / static guarantee), write `drift.json`. Exit 1 on drift. |
| `arch repair [--max-attempts N]` | `repair.ts` | Regenerate drifted/missing generated files, re-verify; bounded (default 3). Exit 70 unresolved. |

## Data flow / metadata artifacts

Arch persists project state under `.arch/`. The following on-disk artifacts are
**verified to exist in the codebase** (paths from `@arch/sync`'s
`metadata-store.ts`, the CLI commands, and `@arch/verifier`'s `reports.ts`):

| Artifact | Written by | Role |
|---|---|---|
| `.arch/ir.current.json` | `arch parse --emit-ir`, `plan`, `apply` (before generation) | Candidate canonical IR compiled from the current spec. |
| `.arch/ir.previous.json` | `arch apply` (on successful promotion) | Last verified baseline IR; the diff baseline for the next `plan`. |
| `.arch/artifact-map.json` | apply | Maps IR entities → generated files (provenance, reverse lookup, drift). |
| `.arch/ownership.json` | apply | Per-file/region ownership + `write_scope` + content hashes. |
| `.arch/source-map.json` | parse/plan | IR entity IDs → `backend.arch` source ranges for diagnostics + traceability. |
| `.arch/drift.json` | `arch check` | Latest drift report (replaced each run). |
| `.arch/plans/latest.plan.json` | `arch plan` | Stable pointer to the most recent plan; `apply` requires it for incremental sync. |
| `.arch/plans/<plan-id>.plan.json` | `arch plan` | The full machine-readable `SyncPlanV1` for a given plan id (with a `.plan.md` summary alongside). |
| `.arch/runs/<run-id>/report.json` | apply / repair (via verifier) | Per-run verification report (also mirrored to `verification-report.json`). |

Promotion is atomic and gated: candidate metadata in staging/`tmp` is promoted
to the stable files only after verification passes. Failed plans, applies, or
repairs never promote.

## Trust boundaries

Arch splits responsibility between **deterministic compiler components** and
**constrained agents**. The deterministic side is the whole V1 critical path.

**Deterministic (the compiler):**

- Parsing, AST construction, source mapping.
- Semantic validation; canonicalization to `arch.ir.v1`; IR schema validation; canonical hashing.
- Typed IR diffing, risk/rename classification.
- Dependency-graph construction and affected-artifact resolution.
- Change planning, plan/patch schema validation, file-allowlist enforcement, ownership checks.
- Template generation, Prisma migration scaffolding.
- Verification orchestration (install/typecheck/test), drift + static-guarantee detection.
- **Metadata promotion** — only on verification success.

**Constrained agents (`@arch/agents`):** receive a *typed* task ("apply this
diff to this allowlisted set of files; preserve ownership; produce structured
patch ops; tests must pass") with output validated against a patch schema.

**Agents may NEVER:** parse `.arch` or resolve semantic references; decide what
the diff is; invent integrations/providers; create a plan from scratch; choose
destructive migration behavior; bypass ownership or edit human-owned files;
weaken guarantees/policies; mark verification as passed; or produce unvalidated
patches. The compiler narrows the problem *before* any model writes code.

## V1 cutline (be honest about what is and isn't wired)

This is a functional V1 prototype that proves the spec-to-code thesis. Known
boundaries, confirmed in the code:

- **Persistence defaults to in-memory.** The generated project ships an
  in-memory store with a Prisma-like API so the generated test suite runs with
  no database. A real Prisma/Postgres adapter is also generated and selectable
  at startup via `ARCH_DB=prisma` (the runtime config reads
  `env.ARCH_DB === "prisma" ? "prisma" : "memory"`); see
  `packages/arch-generator/src/templates/runtime-config.ts` and `runtime-db*.ts`.
  The Prisma schema and migration scaffolds are generated for the real Postgres
  path regardless.
- **Apply uses deterministic templates, not agents.** `arch apply`
  (`apply.ts`) imports `generate` from `@arch/generator` and does **not** invoke
  the agent orchestrator. The constrained agent protocol exists as a
  library/foundation; it is not auto-wired into the apply loop in V1.
- **The LLM provider is optional and disabled by default.** The default provider
  is the deterministic one (`deterministic-provider.ts`, `enabled = true`). The
  `HttpLlmProvider` implements the same interface but is **disabled unless**
  `ARCH_LLM_API_KEY` is set; the provider interface defaults `enabled` to false
  and "must be explicitly enabled to make network calls."
- **`optional`/`nullable` field modifiers are not in the V1 grammar.** Field
  modifiers are `default:` and `indexed`/`index`. An unknown field modifier is
  rejected with `ARCH-SEM-018` (`UNKNOWN_FIELD_MODIFIER` in
  `semantic-validator.ts`). (`optional` is a keyword only for `auth: optional`,
  unrelated to field nullability.)
- **Destructive / unsupported diffs are blocked, not silently applied.** Target
  *system* changes (e.g. database provider) and unsupported diffs are reported
  as blocked; destructive changes require explicit confirmation.

Nothing above should be read as "complete production persistence" or
"autonomous agentic apply" — neither is claimed for V1.

## Where to go deeper

The `founding-docs/` directory is authoritative. Start there when a detail here
is ambiguous:

- [`founding-docs/CONCEPT.md`](../founding-docs/CONCEPT.md) — the meta-coding inversion and product framing.
- [`founding-docs/ARCHITECTURE.md`](../founding-docs/ARCHITECTURE.md) — full component-by-component architecture, state model, ownership, flows.
- [`founding-docs/PRODUCT_SPEC.md`](../founding-docs/PRODUCT_SPEC.md) — product scope, V1 target, non-goals.
- [`founding-docs/LANGUAGE_SPEC.md`](../founding-docs/LANGUAGE_SPEC.md) — `.arch` grammar and source-level primitives.
- [`founding-docs/IR_SPEC.md`](../founding-docs/IR_SPEC.md) — the `arch.ir.v1` canonical IR contract.
- [`founding-docs/SYNC_ENGINE_SPEC.md`](../founding-docs/SYNC_ENGINE_SPEC.md) — diff engine, planner, patcher, migrations.
- [`founding-docs/IMPLEMENTATION_PLAN.md`](../founding-docs/IMPLEMENTATION_PLAN.md) — build sequencing.

Repo-level orientation lives in the top-level [`README.md`](../README.md) (the
loop, commands, quick start, and the V1 cutline).
