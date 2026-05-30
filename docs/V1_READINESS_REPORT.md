# Arch V1 Readiness Report

**Date:** 2026-05-30
**Scope:** Milestones M1–M15 of `founding-docs/IMPLEMENTATION_PLAN.md`, evaluated
against the V1 readiness definition in `docs/CLAUDE_V1_HANDOFF.md` and the
ten reviewer-trust criteria.

## 1. Verdict

Arch reaches a **solid, functional V1**. A reviewer can see, run, and trust the
full thesis loop end-to-end: `backend.arch` is the source of truth, the
canonical IR preserves and normalizes intent, spec changes become typed diffs
(not guessed edits), plans map diffs to affected artifacts under explicit
ownership boundaries, apply changes implementation only through validated plans,
generated code is real and traceable, verification gates promotion, drift is
detected, and repair is bounded and verification-gated.

The single most important change this cycle: **the CLI now compiles through the
real `@arch/language` + `@arch/ir` pipeline.** It previously shipped a divergent
inline regex parser that bypassed semantic validation and dropped intent (e.g.
enums degraded to strings). The demonstrated pipeline is now the tested one.

## 2. Final verification (commands and results)

All commands run from a clean tree on 2026-05-30:

| Command | Result |
|---|---|
| `pnpm typecheck` | **PASS** (all 8 packages, `tsc -b`) |
| `pnpm test` | **PASS** — 209 unit tests (lang 36, ir 44, sync 54, generator 22, verifier 16, agents 10, cli 27) + 1 gated integration test skipped |
| `ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts` | **PASS** (1 test; real install + verify of a generated project) |
| `pnpm e2e` | **PASS** — full transcript incl. v1→v2 enum sync, drift detection, and repair |
| `git diff --check` | **PASS** (clean) |
| `pnpm update-goldens` | **PASS** — snapshots regenerate deterministically (no changes) |

Baseline at session start was green (174 unit tests); this cycle added 35 tests
and a substantial pipeline unification while keeping every gate green.

## 3. Thesis criteria → evidence

| # | Criterion | Evidence |
|---|---|---|
| 1 | `backend.arch` is the durable source of truth | CLI compiles via `@arch/language`+`@arch/ir` (`arch-cli/src/commands/parse.ts`); semantic validation rejects unsupported intent before IR. |
| 2 | Canonical IR preserves & normalizes intent | Enum is first-class end-to-end: `enum["public","private","followers"]` survives parse→IR→Prisma `enum PostVisibility`. Hash is source-position-independent (`canonicalize` + generator `fragmentHash` both strip source). Tests: `arch-ir/src/canonicalize.test.ts`, `draft-ir.test.ts`, generator `enum.test.ts`. |
| 3 | Spec changes → typed diffs, not guessed edits | `diffIRV1` emits `model_field_added` + `model_index_added` for the visibility change; `arch-sync/test/diff-engine.test.ts`; e2e asserts the typed diff in the plan. |
| 4 | Plans map diffs to affected artifacts with ownership boundaries | `buildPlanV1` attaches `ArtifactGenerationIR` + `OwnershipIR` write-scope per action; `plan-builder.ts`, `artifact-resolution.ts`. |
| 5 | Apply changes implementation only through validated plans | `applyPlan` runs `validatePlan` (repo-root containment, allowlist, forbidden paths, per-kind write_scope, human-owned block); migrations are generated, not silently skipped; `apply.ts`, `patch-validator.ts`, `apply-lifecycle.test.ts`. |
| 6 | Generated code is real, inspectable, traceable | Every file carries a header (artifact id, entity ids, ownership, write_scope, generator id, ir_fragment_hash); generated project typechecks + tests pass; Prisma schema + migration scaffolds emitted; `generator.ts`, headers/typecheck tests. |
| 7 | Verification gates metadata promotion | `apply` promotes `ir.previous` + ownership only after install + verify pass; `--skip-verify` never promotes; `apply-lifecycle.test.ts` (skip-verify, install-fail, verify-fail cases). |
| 8 | Drift detected when code no longer matches intent | Hash-modified / missing-file / missing-test detection + **static guarantee detector** (notification-in-transaction) + structured `drift.json` (`checked_ir_hash`, categories); `drift-detector.ts`, `guarantee-static.ts`, `check.test.ts`. |
| 9 | Repair is bounded, allowlisted, verification-gated | `arch repair` regenerates drifted/missing generated files from IR, never touches `src/custom`, max 3 attempts, repair-history preserved, promotes only on verify pass; `repair.ts`, `repair.test.ts` (6 cases). |
| 10 | SocialFeed demonstrates the loop end to end | `pnpm e2e`: init → parse/IR → plan → apply → verify → edit→enum diff → plan → apply → verify → check (clean) → induce drift → check (reports) → repair → check (clean). |

## 4. Milestone status (M1–M15)

| Milestone | Status | Notes |
|---|---|---|
| M1 CLI skeleton | ✅ | 6 commands, stable exit codes, `arch init`. |
| M2 Parser | ✅ | Recursive-descent, source spans; enum value lists added this cycle. |
| M3 Semantic validator | ✅ | Rejects missing PK, undeclared refs, many-to-many, schedule trigger, unknown guarantees, reserved syntax, **enum default ∉ values**. |
| M4 Canonical IR | ✅ | Stable, source-stripped hash; enum `FieldTypeIR`; guarantee coverage statuses; artifact/ownership metadata. |
| M5 Initial generator | ✅ (1 deferral) | Valid TS/Fastify/Prisma project, traceability headers, guarantee tests, **migration scaffolds**. Runtime persistence is in-memory by design — see §5. |
| M6 Verifier | ✅ | typecheck + tests, run records, reports; failed verify blocks promotion. |
| M7 Snapshot store | ✅ | first-gen lifecycle; corrupt/stale metadata blocks; atomic promotion. |
| M8 Diff engine | ✅ | Full V1 diff set; enum value change → `model_field_type_changed`; trigger/system changes blocked as unsupported. |
| M9 Dependency graph / artifact mapper | ✅ | Field change → schema/model/validator/route/workflow/tests/migration/metadata. |
| M10 Sync planner | ✅ | read-only plans, deterministic ids/hashes, stale-plan detection, ownership decisions. |
| M11 Deterministic patching | ✅ | Visibility enum vertical slice end-to-end; **no silent artifact skips** (migrations generated); validated, allowlisted patching. |
| M12 Ownership & drift | ✅ | Unified spec write_scope/ownership vocab; strengthened metadata schemas; static guarantee detector; `source-map.json`; structured `drift.json`. |
| M13 Agent task protocol | ✅ (deterministic) | Rich `AgentTaskSpec`/`AgentTaskOutput`; deterministic provider; boundary fully enforced + tested (10 tests); LLM provider optional/disabled. See §5. |
| M14 Bounded repair | ✅ | Implemented + tested + demonstrated in e2e (was a stub at session start). |
| M15 Demo polish | ✅ | README, e2e drift+repair demo, `update-goldens`, CI present. |

## 5. Deferrals (explicit and justified)

1. **Generated runtime persistence is an in-memory store with a Prisma-like
   async API; it does not import `@prisma/client` at runtime.**
   - *Rationale:* keeps the generated test suite hermetic (no database needed
     for `pnpm test`), satisfying M5's "Done when … `pnpm typecheck` and
     `pnpm test` pass." The Prisma schema and additive migration scaffolds are
     generated and valid, so the real-Postgres path is credible: `docker compose
     up` provides Postgres and the generated migrations describe the schema.
   - *Path to close:* add a Prisma-backed adapter behind the same collection
     interface, selected by `DATABASE_URL`/an env flag, plus a Docker-gated
     integration test. The in-memory store deliberately mirrors the Prisma API
     (`create/findUnique/findMany/update/delete`) so the swap is mechanical.
   - *Why safe to defer:* no guarantee is weakened; the founding plan §17.4
     explicitly gates real-DB verification behind integration runs.

2. **The agent orchestrator is not wired into `arch apply`; deterministic
   templates perform the actual patching.**
   - *Rationale:* the founding plan (§4.1, §3.2) prescribes deterministic-first
     and states a deterministic mock agent is acceptable for V1 if the protocol,
     allowlists, ownership checks, and verification gates are real — all of which
     are implemented and tested. M13's "Done when" is "the agent boundary is
     testable independently from provider integration," which is satisfied.
   - *Path to close:* mark selected `SyncPlanActionV1`s as `planned_agent` and
     route them through the orchestrator in apply; the validation layer already
     rejects every out-of-bounds output.

3. **`optional`/`nullable` field modifiers are not in the V1 grammar**
   (`ARCH-SEM-018`). Fields are required; use `default:` for safe additive
   changes. Adding optionality is a localized parser/draft-IR/generator change.

4. **Real LLM provider** is an interface only, disabled by default — by design
   (`providers/llm-provider-interface.ts`).

5. **Latency guarantee** (`post_creation_p95_latency`) is reported as
   partially-covered with a scaffold, not a production proof — per founding
   plan §3.4.

## 6. Risks to monitor

- **Pipeline duplication regression.** The CLI must keep using the real compiler
  packages; a reintroduced inline shim in `parse.ts` would silently diverge from
  the tested pipeline. (Memory: `arch-cli-real-pipeline`.)
- **Generated-content determinism.** Generated file headers hash a
  source-stripped IR fragment; if a future template hashes raw source
  positions, unchanged files will falsely drift. Covered by a regression test
  in generator `headers.test.ts`.
- **Migration fidelity.** Migration SQL is an inspectable scaffold, not the
  output of `prisma migrate diff`; validate against a real Postgres before
  relying on it for production migrations.
- **Incremental metadata.** `apply` rewrites the full artifact-map/ownership
  from the current IR on every apply; this is correct because generation is
  deterministic, but it assumes generated content is a pure function of the IR.
- **Drift static analysis is heuristic.** The notification-in-transaction
  detector is line/brace-based; it complements (does not replace) hash drift.

## 7. How to reproduce

```sh
pnpm install && pnpm build
pnpm typecheck
pnpm test
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
pnpm e2e            # full loop incl. drift + repair (ARCH_E2E_KEEP_TMP=1 to inspect)
git diff --check
```

The `examples/social-feed/{v1,v2-visibility}/backend.arch` specs are the demo
inputs; the e2e harness (`scripts/run-e2e.ts`) drives the real CLI transcript.
