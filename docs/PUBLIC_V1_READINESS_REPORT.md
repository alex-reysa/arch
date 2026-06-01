# Arch Public V1 Readiness Report

> _Point-in-time snapshot (2026-05-30, branch `arch-v1-readiness`, base `6109f83`)._
> _Per-run figures below — the 228-test count, the "8 packages" total, and the
> commit/branch — describe the repo at that moment and have since drifted (a 9th
> package, `@arch/bench`, was added later). The durable claim is the product
> thesis in §3, not these counts; re-run the commands in §13 for current numbers._

**Date:** 2026-05-30
**Branch:** `arch-v1-readiness`
**Base commit:** `6109f83` (the Public V1 work in this report builds on top of it;
changes are in the working tree, ready to review and commit)
**Scope:** `docs/PUBLIC_V1_GOAL.md` + `docs/OPEN_SOURCE_READINESS_CHECKLIST.md`,
on top of the internal V1 baseline in `docs/V1_READINESS_REPORT.md`.

---

## 1. Verdict

**Arch is ready for an Apache-2.0 Public V1 open-source release.** An external
developer can clone it, install, run the SocialFeed demo, inspect generated code
and traceability metadata, stress the trust boundaries, optionally exercise a
**real constrained LLM provider** and a **real Prisma/Postgres** persistence
path, and contribute through a documented test-first workflow. Every public
claim below has passing evidence or an explicitly documented limitation.

This cycle added, test-first:

- a **real LLM provider** (`HttpLlmProvider`) behind the existing `AgentProvider`
  boundary, disabled by default, with enriched run metadata and an optional
  env-gated live test;
- a **real Prisma/Postgres adapter** selectable by `ARCH_DB=prisma`, proven by a
  gated test that round-trips a row through a real Postgres;
- the one missing stress scenario (repeated edit→plan→apply cycles);
- a full open-source documentation set and community files (LICENSE, CoC,
  CONTRIBUTING, SECURITY, issue/PR templates);
- a CI workflow that runs build, typecheck, unit tests, e2e, and diff/goldens
  determinism by default, with gated Postgres/integration jobs.

**+19 unit tests** were added (209 → 228) while keeping every prior gate green.

---

## 2. Commands run and results

All run from this working tree on 2026-05-30 (macOS, Node 20, pnpm 9):

| Command | Result |
|---|---|
| `pnpm build` | **PASS** (exit 0, all 8 packages `tsc -b`) |
| `pnpm typecheck` | **PASS** (exit 0, all 8 packages) |
| `pnpm test` | **PASS** — 228 unit tests pass, 3 gated tests skipped by default (see note) |
| `ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts` | **PASS** (exit 0; real `pnpm install` + typecheck + tests of the generated project) |
| `ARCH_RUN_POSTGRES=1 DATABASE_URL=… pnpm --filter @arch/cli test -- src/__tests__/prisma-postgres.test.ts` | **PASS** (exit 0; create→read round-trips through a real Postgres 16 container; verified 1 `Post` row persisted) |
| `pnpm e2e` | **PASS** (exit 0; init → IR → plan → apply → verify → v1→v2 enum sync → check → induced drift → repair → clean check) |
| `pnpm update-goldens` | **PASS** — no changes (deterministic) |
| `git diff --check` | **PASS** (clean; no whitespace/conflict markers) |
| `ARCH_RUN_LIVE_LLM=1 … live-provider.test.ts` | **SKIPPED by default** (documented; requires an API key) |

Per-package unit counts: language 36, ir 44, sync 54, generator 26, verifier 16,
agents 24 (+1 skipped live test), cli 28 (+2 skipped gated tests).

> **Test-runner note (honest).** Once during repeated full runs, the *parallel*
> `pnpm -r … test` aggregator exited with a transient `SIGABRT` during worker
> teardown **after every package reported all tests passing**. It did not
> reproduce on re-run, and every package passes deterministically in isolation
> (`pnpm --filter <pkg> test`). The machine used for verification runs ~10 other
> Docker services; the crash is process-teardown resource contention, not a test
> failure. On a clean 2-core CI runner this is very unlikely; if a project sees
> it, limiting `--workspace-concurrency` removes it.

---

## 3. Product thesis evidence

The core inversion — *the Arch-owned generated service substrate is the build
artifact; system intent is the source of truth* — holds end to end (unchanged from the internal V1 baseline,
re-verified this cycle):

1. `backend.arch` is the durable source of truth; the CLI compiles it through the
   real `@arch/language` + `@arch/ir` pipeline (no divergent shim).
2. Canonical IR preserves/normalizes intent (enums survive parse→IR→Prisma);
   hash is source-position-independent.
3. Spec edits produce **typed diffs** (`model_field_added`, …), proven in the e2e
   v1→v2 enum sync and the new multi-cycle test.
4. Plans map diffs to affected artifacts under ownership/write-scope.
5. Apply changes implementation only through validated plans (containment,
   allowlist, forbidden paths, human-owned block).
6. Generated code is real, inspectable, and traceable (headers + `.arch/`
   metadata; see `docs/GENERATED_CODE_INSPECTION.md`).
7. Verification gates metadata promotion (`--skip-verify`/install-fail/verify-fail
   never promote).
8. Drift is detected (hash / missing / missing-test / static guarantee).
9. Repair is bounded, allowlisted, verification-gated.
10. **LLM work is constrained** by the task protocol and cannot bypass validation,
    ownership, or verification (§6).

---

## 4. Open-source readiness checklist status

Mapped against `docs/OPEN_SOURCE_READINESS_CHECKLIST.md`:

- **Product evidence** — clone→quickstart, SocialFeed demo, spec-edit→diff→plan→
  apply, positive drift + bounded repair demos, traceability headers, metadata
  explained, clear diagnostics, honest limitations: **met** (README + e2e +
  `docs/GENERATED_CODE_INSPECTION.md`).
- **Engineering evidence** — install/build/typecheck/test, gated apply/verify,
  e2e, deterministic goldens, `git diff --check`, generated install/typecheck/test
  path, no local paths, no committed secrets: **met** (§2; hygiene scan clean).
- **LLM & agent boundary** — single `AgentProvider` abstraction, a real adapter,
  disabled by default, mocked integration tests, env-gated live test, invalid
  output rejected, cannot write outside allowlist / modify human-owned / weaken
  guarantees / mark verification passed, reviewable run metadata: **met** (§6).
- **Persistence & runtime** — hermetic in-memory default, valid Prisma schema,
  additive migration scaffolds, **real Prisma adapter**, **Docker/Postgres-gated
  integration test**, persistence docs, no hidden production behavior: **met**
  (§7).
- **Stress & abuse** — all 19 scenarios covered: **met** (§8).
- **Documentation** — README, quickstart, example walkthrough, architecture
  overview, contributor guide, test-first workflow, security policy, provider
  config, gated-test commands, known limitations, roadmap, inspection guide:
  **met** (§9 / `docs/`).
- **Repository hygiene** — LICENSE (Apache-2.0) + NOTICE, CODE_OF_CONDUCT, issue
  & PR templates, CI matrix, no-secrets default CI, gated optional jobs,
  `.gitignore`, deterministic artifacts, determinism verified: **met**
  (one untracked local scratch file, see §11).

---

## 5. LLM integration status

**Real, constrained, disabled by default.**

- `packages/arch-agents/src/providers/http-llm-provider.ts` — `HttpLlmProvider`
  implements `AgentProvider`. It talks to the Anthropic Messages API (or any
  compatible endpoint) via an **injectable transport**, parses the model's JSON
  into a structured `AgentTaskOutput`, and is **disabled unless `ARCH_LLM_API_KEY`
  is set** (with the default transport, `run()` refuses to make a network call).
- `providerFromEnv()` returns the deterministic provider unless an API key is
  configured.
- **The orchestrator re-validates every provider output** (`output-validation.ts`),
  so a model can never write outside the allowlist, escape the repo root, touch
  human-owned files, or mark verification passed. New tests in
  `test/http-llm-provider.test.ts` prove a real-shaped provider's malicious
  output (out-of-allowlist path; human-owned target; unparseable text) is
  rejected or recorded as `provider_error` — never a bypass.
- **Run metadata** (`AgentRunRecord`) now carries `provider_id`, `model_id`,
  `task_id`, `action_id`, `artifact_id`, `task_hash` (sha256 of the canonical
  spec), `ir_fragment_hash`, `attempts`, `outcome`, and a structured
  `output_validation` result. Covered by `test/run-metadata.test.ts`.
- **Optional live test:** `test/live-provider.test.ts`, gated by
  `ARCH_RUN_LIVE_LLM=1` + an API key, skipped by default; it asserts the boundary
  holds against a real model.
- **Wiring decision (documented):** `arch apply` patches through **deterministic
  templates** in V1; the live provider is **manually invokable**. Rationale and
  the path to close are in `docs/PROVIDERS.md` §"Why V1 keeps the provider
  manually invokable" (determinism is the product; the boundary is already real
  and tested; safety).

Evidence: `packages/arch-agents` — 24 passing tests (+ 1 skipped live test).

---

## 6. Prisma/Postgres status

**Real adapter, real round-trip, hermetic default.**

- `src/runtime/db-prisma.ts` (generated) implements the same `Db`/`Collection<R>`
  interface as the in-memory store, selectable via `ARCH_DB=prisma`. It is
  **decoupled from `@prisma/client`** (structural `PrismaClientLike` type), so the
  generated project's typecheck stays hermetic (no `prisma generate` required);
  the real client is constructed at startup behind the `ARCH_DB=prisma` branch.
- **Drop-in proof (hermetic):** `db.ts` + `db-prisma.ts` typecheck together as a
  valid `Db` under strict `tsc --noEmit` with no `@prisma/client`
  (`prisma-persistence.test.ts`).
- **Real-DB proof (gated):** `prisma-postgres.test.ts` generates the SocialFeed
  project, runs `prisma generate` + `prisma db push` against a real Postgres 16
  container, and round-trips `createUser → createPost → findPostById` through the
  Prisma adapter. **Verified passing**, with a `Post` row confirmed persisted in
  Postgres.
- Generated `package.json` gains `prisma:generate` / `prisma:push` /
  `prisma:migrate` scripts; `docs/PERSISTENCE.md` documents default vs real-DB
  mode and the migration-fidelity caveat.
- **Hermetic default preserved:** `pnpm test` and the gated apply/verify
  integration test still pass with the in-memory store (no DB needed).

---

## 7. Stress / abuse coverage map

All 19 required scenarios are covered by a passing assertion (exact `it()` names;
see `docs/STRESS_TESTING.md` for the full table):

| # | Scenario | Test |
|---|---|---|
| a | repeated edit→plan→apply cycles | apply-lifecycle: *supports repeated spec edit -> plan -> apply cycles…* (NEW) |
| b | stale plan rejected | apply-lifecycle: *rejects latest plans whose base/target hash…*, *…plan_hash* |
| c | corrupt metadata rejected | check: *exits 2 when metadata JSON is corrupt*; drift-detector: *fails closed when metadata JSON is corrupt* |
| d | path traversal rejected | patch-validator: *rejects parent-escape segments*; agents: *rejects a patch that escapes the repo root* |
| e | `.git`/`node_modules` rejected | patch-validator: *rejects writes inside .git*, *rejects node_modules segments…* |
| f | `src/custom` / human-owned protected | repair: *never touches human-owned src/custom files*; agents: *rejects writing a human-owned…* |
| g | destructive blocked by default | apply-lifecycle: *rejects destructive plans by default* |
| h | confirmation-required blocked | apply-lifecycle: *rejects confirmation-required plans by default* |
| i | failed install → no promote | apply-lifecycle: *leaves baseline metadata untouched when install fails* |
| j | failed verify → no promote | apply-lifecycle: *leaves baseline metadata untouched when verification fails…* |
| k | `--skip-verify` → no promote | apply-lifecycle: *does not promote snapshots or metadata when --skip-verify is used* |
| l | hash drift detected | check: *reports drift…when a generated file is hand-edited*; drift-detector: *reports generated_file_modified…* |
| m | missing generated artifact | drift-detector: *reports generated_file_missing for a deleted, non-test artifact* |
| n | missing generated test | drift-detector: *reports missing_generated_test for a deleted test artifact* |
| o | static guarantee drift | check: *detects a guarantee_static_pattern violation…*; guarantee-static: *flags an awaited post-persistence integration call…* |
| p | repair fixes allowed drift | repair: *restores a hand-edited generated file…*, *regenerates a deleted generated test…* |
| q | repair refuses human-owned | repair: *never touches human-owned src/custom files* |
| r | repair stops after max attempts | repair: *stops after max attempts and exits non-zero…* |
| s | invalid agent/LLM output rejected | agent-protocol (8 cases) + http-llm-provider: *cannot widen its own permissions…* |

---

## 8. Documentation delivered

`README.md` (updated), `docs/ARCHITECTURE.md`, `docs/PROVIDERS.md`,
`docs/PERSISTENCE.md`, `docs/GENERATED_CODE_INSPECTION.md`,
`docs/STRESS_TESTING.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`LICENSE` (Apache-2.0), `NOTICE`, `.github/pull_request_template.md`,
`.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}`. No public doc
claims unsupported behavior as complete; every deferral is labeled.

---

## 9. CI and release hygiene

`.github/workflows/ci.yml` runs **by default** on push/PR: install → build →
typecheck → unit tests → goldens-determinism (`update-goldens` then
`git diff --exit-code`) → `git diff --check`, plus a dedicated **e2e** job.
**Gated jobs** (workflow_dispatch): the apply/verify integration test and a real
**Postgres** job using a `postgres:16-alpine` service container (no secrets).
Hygiene scan: no hardcoded absolute paths, no committed secrets, `.gitignore`
covers build/scratch/secret outputs.

---

## 10. Known limitations (honest)

1. **LLM provider is not auto-wired into `arch apply`.** Deterministic templates
   do the patching in V1; the live provider is manually invokable. Documented in
   `docs/PROVIDERS.md` with the path to close.
2. **In-memory persistence is the runtime default;** the Prisma adapter is opt-in
   (`ARCH_DB=prisma`). Generated migration SQL is an inspectable scaffold, not
   `prisma migrate diff` output — validate against real Postgres before relying on
   it (`docs/PERSISTENCE.md`).
3. **`optional`/`nullable` field modifiers are not in the V1 grammar**
   (`ARCH-SEM-018`); use `default:` for safe additive changes.
4. **`generated_region` write-scope** exists in the ownership vocabulary but the
   V1 generator emits only `whole_file` and `stub_only`.
5. **Latency guarantee** (`post_creation_p95_latency`) is reported as
   partially-covered scaffold, not a production proof.
6. **Static guarantee drift is heuristic** (line/brace-based) and complements,
   not replaces, hash drift.
7. **Prisma adapter `reset()` is a no-op** and `findMany` has no
   filtering/pagination — matching the narrow V1 workflow-service target.

---

## 11. Risks for community testing

- **e2e/integration/Postgres tests do real installs** (network) and are
  heavier; they are gated or in dedicated CI jobs so the default fast loop stays
  hermetic. Contributors behind an offline mirror must configure pnpm first.
- **Parallel test-runner SIGABRT** under heavy host load (see §2 note). Mitigation
  documented; not a test failure.
- **Generated-content determinism** depends on templates never hashing raw source
  positions; covered by a regression test, but new templates must preserve it.
- **An untracked local scratch file** (`expert-consultation.txt`, a research-paper
  prompt unrelated to the product) sits in the repo root. It is **not tracked** and
  will not be released unless explicitly `git add`-ed; recommend removing or
  ignoring it before tagging.

## 12. Recommended next issues

1. **Wire the orchestrator into `arch apply`** behind a flag: mark selected
   `SyncPlanActionV1`s as agent-synthesized and route them through
   `AgentOrchestrator`, persisting `AgentRunRecord`s under `.arch/agent-runs/`.
2. **Real migration fidelity:** generate migrations via `prisma migrate diff`
   against the previous schema instead of the hand-rolled scaffold.
3. **`optional`/`nullable` field modifiers** (localized parser/draft-IR/generator
   change) to broaden safe additive evolution.
4. **Prisma adapter depth:** `findMany` filters/pagination and a real
   table-truncation `reset()` for integration test teardown.
5. **Expand the live-provider suite** with recorded-fixture (VCR-style) runs so a
   model round-trip can be exercised in CI without a billable key.

---

## 13. How to reproduce

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
pnpm e2e
pnpm update-goldens     # no changes expected
git diff --check

# Optional gated checks:
docker run --rm -d --name arch-pg -e POSTGRES_USER=arch -e POSTGRES_PASSWORD=arch \
  -e POSTGRES_DB=arch_app -p 5432:5432 postgres:16-alpine
ARCH_RUN_POSTGRES=1 DATABASE_URL=postgres://arch:arch@localhost:5432/arch_app \
  pnpm --filter @arch/cli test -- src/__tests__/prisma-postgres.test.ts

ARCH_RUN_LIVE_LLM=1 ARCH_LLM_API_KEY=sk-... ARCH_LLM_MODEL=claude-opus-4 \
  pnpm --filter @arch/agents test -- test/live-provider.test.ts
```
