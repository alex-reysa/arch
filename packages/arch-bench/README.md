# @arch/bench

A first-class benchmark for **intent-to-code synchronization**: when a backend
specification evolves, how faithfully, minimally, and safely does each approach
bring the generated code back in sync?

It runs a five-subject, up-to-100-task study comparing eight baselines on the
same ordered sequence of spec evolutions, in isolated temp workspaces, driving
the **real** Arch CLI and optional live coding-agent CLIs.

## Baselines

| Baseline | What it does | LLM? |
| --- | --- | --- |
| `arch-typed-sync` | `arch parse → plan (twice, for determinism) → apply` with verification gating. Refuses destructive/confirmation-required changes. | no |
| `full-regeneration` | Compile the target spec and rewrite **every** Arch-owned artifact from the target IR — no typed diff, no affected-artifact planning. Preserves `src/custom/**`. Measures churn + the absence of a safety gate. | no |
| `claude-direct-edit` | `claude -p` with file-edit tools enabled, run in the project dir. No typed diff, no allowlist, no constraints. | yes (gated) |
| `claude-broad-constrained` | Same, plus a high-level constraint system prompt (don't touch `src/custom/**`, don't weaken tests, preserve shape). Still no typed diff / allowlist. | yes (gated) |
| `grok-direct-edit` | `grok -p` / Grok Build with file-edit tools enabled, run in the project dir. No typed diff, no allowlist, no constraints. | yes (gated) |
| `grok-broad-constrained` | Same, plus the broad constraint prompt passed as Grok rules. Still no typed diff / allowlist. | yes (gated) |
| `composer-direct-edit` | `cursor-agent -p --model composer-2.5` with file-edit tools enabled in the project dir. No typed diff, no allowlist, no constraints. | yes (gated) |
| `composer-broad-constrained` | Same, with the broad constraint prompt embedded into the Composer prompt. Still no typed diff / allowlist. | yes (gated) |

Deterministic baselines run once; live-agent baselines run `--repeats` times
(default 3) to measure run-to-run variance.

## Task kinds (20-per-subject mix)

`additive_field` · `enum_change` · `workflow_edit` · `guarantee_change` ·
`drift_injection` · `destructive_block` · `migration_data_preservation` ·
`human_owned_edit`.

Each task declares its expected outcome (`apply_passes` / `apply_blocks` /
`drift_detected`), the minimal artifact set it should touch
(`expectedAffectedPaths`, supporting `dir/` prefixes), and independent
**oracle** tests that assert *behavior* (default values, enum validation,
guarantee behavior, human-owned preservation) — not generated structure.

## Metrics (per task × baseline × repeat)

`passed`, `blocked`, `durationMs`, `filesTouched`, `changedLoc`,
`expectedFilesTouched`, `offScopeFilesTouched`, `humanOwnedViolations`,
`generatedTestDeletedOrWeakened`, `verificationPassed`, `oraclePassed`,
`driftRecall`, `repairSucceeded`, `planDeterministic`, `migrationDataPreserved`,
`migrationCheckStatus`, `migrationCheckReason`, `guaranteeVerification`,
`taskKind`, `taskMode`, `failurePolicy`, and `llm` (provider / model /
billing mode / `costUsd` / `sessionId`). See
[`src/report/results.ts`](src/report/results.ts). The CSV and `summary.md`
break results down by these dimensions, including a migration-dbCheck-status
table and a guarantee-verification table.

`off-scope` is content-diff based: rewriting a file with identical bytes is not
churn. Arch's deterministic generation therefore shows ~0 off-scope; an LLM's
collateral edits show up directly.

## Usage

```bash
# Fast smoke (deterministic baselines, 2 subjects × 2 tasks):
pnpm bench:smoke

# Full paper run (requires authenticated live-agent CLIs):
ARCH_BENCH_LIVE=1 ARCH_BENCH_REPEATS=3 pnpm bench:paper

# Re-summarize an existing run:
pnpm bench:summarize artifacts/bench/<run-id>/results.json

# Merge sharded paper runs:
pnpm bench:merge -- --inputs "artifacts/bench/paper-*/results.json" \
  --out artifacts/bench/paper-combined

# Validate the committed manifest (structural, then strict):
tsx packages/arch-bench/src/main.ts validate
tsx packages/arch-bench/src/main.ts validate --strict

# Validation run (isolated mode, restore-from-spec, strict migration scoring):
ARCH_BENCH_DB=1 ARCH_BENCH_DATABASE_URL=postgres://arch:arch@localhost:5432/arch_bench \
  pnpm bench:paper -- --task-mode isolated --failure-policy restore-from-spec --strict
```

Or the CLI directly:

```bash
tsx packages/arch-bench/src/main.ts run --suite smoke \
  --subjects social-feed,task-tracker --baselines arch-typed-sync,full-regeneration
```

Outputs land in `artifacts/bench/<run-id>/`:
`results.json`, `results.csv`, `summary.md`, plus per-task `logs/`.

### Environment

- `ARCH_BENCH_LIVE=1` — enable live baselines (required for `paper`).
- `ARCH_BENCH_CLAUDE_MODEL=sonnet` — Claude model. Falls back to
  `ARCH_BENCH_MODEL` for backward compatibility, then `sonnet`.
- `ARCH_BENCH_GROK_MODEL=grok-build` — Grok Build model.
- `ARCH_BENCH_COMPOSER_MODEL=composer-2.5` — Cursor Composer model.
- `ARCH_BENCH_CLAUDE_BIN=claude`, `ARCH_BENCH_GROK_BIN=grok`,
  `ARCH_BENCH_COMPOSER_BIN=cursor-agent` — override CLI binaries.
- `ARCH_BENCH_REPEATS=<n>` — live-baseline repeats (default 3).
- `ARCH_BENCH_SMOKE=1` — enable the gated integration tests under
  `test-integration/`.

Preflight checks run for selected live providers. Claude requires
`claude --version`; Grok requires `grok models` without "not authenticated";
Composer requires `cursor-agent models` and the selected Composer model.
Grok and Composer subscription runs record `billingMode: "subscription"`;
Claude records `billingMode: "metered"` and captures `costUsd` when the CLI
exposes it.

### Calibration and sharding

Run a small calibration before the full paper run:

```bash
ARCH_BENCH_LIVE=1 \
ARCH_BENCH_CLAUDE_MODEL=sonnet \
ARCH_BENCH_GROK_MODEL=grok-build \
ARCH_BENCH_COMPOSER_MODEL=composer-2.5 \
pnpm bench:paper -- \
  --subjects social-feed,task-tracker \
  --max-tasks 2 \
  --repeats 1 \
  --baselines claude-direct-edit,claude-broad-constrained,grok-direct-edit,grok-broad-constrained,composer-direct-edit,composer-broad-constrained \
  --out artifacts/bench/calibration-multimodel
```

The full run is intentionally shardable by subject, provider, variant, or
repeat, then merged with `arch-bench merge`. This avoids losing multi-day live
runs to one process failure.

## Dataset

Committed under [`benchmarks/`](../../benchmarks): **5 subjects × 20 ordered
tasks = 100 tasks**, every one of which passes the authoritative
`arch-typed-sync` baseline in a real smoke run (apply + verify + oracle for
`apply_passes`; correct refusal for `destructive_block`; detect + repair for
`drift_injection`).

```
benchmarks/
  manifest.json                              # typed, validated manifest (100 tasks)
  subjects/<subject>/v00/backend.arch        # base spec
  subjects/<subject>/tasks/<NN-name>/
    backend.arch                             # the target spec (full, not a delta)
    oracles/*.test.ts                        # behavior oracles
    assertions/*.guarantee.json              # verifier-backed guarantee assertions
    drift/*.ts                               # drift-injection scripts
    db-check.ts                              # Postgres data-preservation check (gated)
```

Kind distribution across the 100 tasks: additive_field 34, enum_change 13,
destructive_block 11, drift_injection 11, guarantee_change 10, human_owned_edit
10, migration_data_preservation 9, workflow_edit 2. (`workflow_edit` is sparse
by necessity: the current generator reindexes positional workflow-step ids and
emits one `const validation` block per `validate` step, so inserting a step into
a workflow that already validates produces a destructive diff or a duplicate
declaration — authoring favors the constructions the real pipeline accepts.)

The manifest is structurally validated (`validateManifest`) and every
referenced file is existence-checked (`loadManifest`). Every `toSpec` is a
complete spec; blocked/destructive tasks therefore never corrupt the chain (the
next task's `fromSpec` is the last *successfully applied* spec).

Re-merge per-subject task sets and re-validate with
[`scripts/merge-bench-tasks.ts`](../../scripts/merge-bench-tasks.ts).

## Run modes

| flag | values | meaning |
| --- | --- | --- |
| `--task-mode` | `sequential` (default) / `isolated` | `sequential` evolves one workspace through the ordered task chain; `isolated` bootstraps each task in a fresh workspace from its own `fromSpec`, so a task never replays a previous baseline's failure. |
| `--failure-policy` | `continue-contaminated` (default) / `restore-from-spec` | in `sequential` mode, `restore-from-spec` rebuilds the next task's starting point from a clean workspace after a failed task, so one bad baseline doesn't cascade. |
| `--strict` | flag | validation/paper scoring: migration tasks require a passing `dbCheck` (also implied by `--suite paper`). |

Validation runs should include `--task-mode isolated` (no sequential
contamination) and `--task-mode sequential --failure-policy restore-from-spec`
(long-lived evolution without cascading failures).

## Migration checks (`dbCheck`)

Each `migration_data_preservation` task carries a `dbCheck` script run as
`tsx db-check.ts <projectDir>` with `DATABASE_URL` / `ARCH_BENCH_DATABASE_URL`
in the environment. The shared checker (`benchmarks/_lib/db-check-lib.ts`)
applies the generated migrations to a real (throwaway) Postgres schema and
verifies the change is **additive and preservation-safe** — an
`ALTER TABLE ... ADD COLUMN` that is nullable or defaulted, with no destructive
drop/recreate. It emits a structured result the runner records as
`migrationCheckStatus` (`passed` / `failed` / `skipped` / `not_applicable`),
`migrationDataPreserved`, and `migrationCheckReason`.

Without a database configured the check reports `skipped`, so smoke runs never
require Postgres. In `--strict` (validation/paper) mode, a migration task only
passes if its `dbCheck` actually ran and reported `passed` — no
migration-preservation claim is made without an executed `dbCheck`. Real checks
need `pg` (a repo devDependency) and a Postgres URL.

The bench process reads `ARCH_BENCH_DATABASE_URL` / `DATABASE_URL` from its own
environment and threads the URL into each `dbCheck` (the hermetic per-task
workspace env intentionally does not inherit it). Captured evidence against a
throwaway Postgres 16:

```text
social-feed-12   status=passed preserved=true  "additive migration preserves data (Post.viewCount); 2 migration(s) applied"
task-tracker-12  status=passed preserved=true  "additive migration preserves data (Task.completedCount); 2 migration(s) applied"
```

Reproduce (CLI run, or the gated integration test):

```bash
docker run -d --name arch-bench-pg -e POSTGRES_USER=arch -e POSTGRES_PASSWORD=arch \
  -e POSTGRES_DB=arch_bench -p 55432:5432 postgres:16-alpine

# (a) full CLI slice
ARCH_BENCH_DB=1 ARCH_BENCH_DATABASE_URL=postgres://arch:arch@localhost:55432/arch_bench \
  pnpm exec tsx packages/arch-bench/src/main.ts run --suite smoke \
    --subjects social-feed,task-tracker --baselines arch-typed-sync \
    --max-tasks 12 --task-mode isolated --failure-policy restore-from-spec --strict

# (b) the committed integration test (skips automatically with no DB URL)
ARCH_BENCH_SMOKE=1 ARCH_BENCH_DATABASE_URL=postgres://arch:arch@localhost:55432/arch_bench \
  pnpm --filter @arch/bench test -- migration-dbcheck-postgres
```

## Strict validation

`arch-bench validate --strict` requires every `apply_passes` task to have an
oracle (`oracleTests`, or a `dbCheck` for migration tasks) and every
`guarantee_change` task to have a behavioral oracle or a verifier-backed
`guaranteeAssertion`. Structural validation always runs; `--strict` adds the
oracle requirements. All 10 `guarantee_change` tasks now carry a verifier-backed
`guaranteeAssertion` (under each task's `assertions/`), so `--strict` exits 0.
Those assertions back only the *structural* claim — the guarantee is declared in
the IR and Arch regenerates a traceable scaffold — so all 10 stay
`declared_but_not_behaviorally_verified` (see below) until a load oracle exists.

## Guarantee verification

Latency/guarantee tasks with no measurable load oracle are marked
`declared_but_not_behaviorally_verified` and **excluded from correctness
claims**; the summary reports them separately. A structural `guaranteeAssertion`
satisfies strict validation but does **not** promote a guarantee to
`behavioral`: only a real behavioral oracle (or an explicit `behavioral`
classification) counts. The manifest's `guaranteeVerification` field is the
honest source of truth.

## Validation-gate status (Phase 1)

Per [docs/ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md](../../docs/ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md),
this is the measurement foundation, not external proof:

| Claim | Evidence wired | Status |
| --- | --- | --- |
| Workflow edits are stable | named-step IR/diff identity + insertion/reorder tests | Wired (internal) |
| Migration preservation | real `dbCheck` execution + strict scoring gate + Postgres integration test | Wired + **evidence captured** (social-feed-12 / task-tracker-12 `passed` against throwaway Postgres 16); `test-integration/migration-dbcheck-postgres.test.ts` asserts it (double-gated on `ARCH_BENCH_SMOKE=1` + a DB URL, else skips) |
| Guarantee oracles | strict validation + verifier-backed `guaranteeAssertion` per guarantee_change task + `declared_but_not_behaviorally_verified` reporting | `--strict` passes; 10 latency/audit guarantees structurally asserted, not behaviorally verified (no load oracle) |
| External usefulness | external-validation plumbing (represent/lock/run/classify/report) + capability matrices | Plumbing ready; real external dataset pending (fixture/demo only) |

The internal 100-task benchmark is regression coverage, not external proof.

## Phase 2 — external validation (plumbing)

The benchmark can now **represent, lock, run, classify, and report** externally
authored service evolutions. The committed `benchmarks/external/` data is a
clearly-marked **fixture/demo** — it exercises the plumbing and is **excluded
from every claim**. Real external services/evolutions remain pending external
input. Full reference: [docs/PHASE2_EXTERNAL_PLUMBING.md](../../docs/PHASE2_EXTERNAL_PLUMBING.md).

- **Representation** — `ExternalManifest` (`src/external/schema.ts`): services with
  `author`/`source`/`domain`/`heldOut`, ordered evolutions, an `ExternalOutcome`
  per evolution. Unsupported/blocked outcomes are first-class (kept, never
  dropped) with a structured `unsupportedReason` + `failureAnalysis`.
- **Lock** — content hash + per-file hashes; post-import edits must bump
  `datasetVersion` (`external lock --check` fails an unversioned change).
- **Classify** — pure outcome classification with documented precedence, plus the
  required per-failure `failures/<task>.failure.json`.
- **Metrics** — `unsupported_rate_by_kind` / `_by_external_author` / `_by_domain`,
  `unsupported_reasons_top_10`, and a pass-or-explicit-block rate.
- **Capability matrices** — an honest map of which diff/migration changes Arch can
  sync today, with structured reasons + next steps.

```bash
tsx packages/arch-bench/src/main.ts external validate
tsx packages/arch-bench/src/main.ts external lock --write   # then --check
tsx packages/arch-bench/src/main.ts external run                           # real run through the Arch CLI
tsx packages/arch-bench/src/main.ts capability-matrix [--format json]
# Reproducible validation run (throwaway Postgres up → strict slice → down):
scripts/bench-validation/run-validation.sh
```

New report fields: `results.csv` gains `externalOutcome`, `unsupportedDiffType`,
`unsupportedReason`, `failureClass`, `externalDatasetVersion`,
`externalDatasetHash`; `summary.md` gains an External-validation section when
external records are present. The validation artifact-directory convention is
defined in [docs/PHASE2_EXTERNAL_PLUMBING.md](../../docs/PHASE2_EXTERNAL_PLUMBING.md).

## Design notes

- The runner drives the real CLI by spawning `tsx packages/arch-cli/src/main.ts`
  from the repo root (mirrors `scripts/run-examples-e2e.ts`), with a `pnpm`
  shim so generated projects install + verify.
- Live modes differ from the constrained `ClaudeCodeProvider` in `@arch/agents`
  (tools OFF, isolated tmpdir): the bench runs provider CLIs with tools ON in
  the project dir so agents edit real files. The transport is injectable, so the
  whole path is unit- and integration-tested with fakes.
- CI runs only the unit tests + `bench:smoke`. The full `bench:paper` run is
  manual because it is live, slow, and billable.
