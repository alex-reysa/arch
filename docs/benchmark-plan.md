# Arch Bench Paper-Scale Benchmark Plan

## Summary

Build `arch-bench` as a first-class benchmark package that runs a five-subject, 100-task intent-to-code synchronization study with deterministic Arch, full regeneration, and live direct-edit / broad-constrained baselines for Claude, Grok Build, and Cursor Composer.

Decisions locked in:
- Subjects: `social-feed`, `task-tracker`, `inventory`, `billing-approval`, `booking-workflow`.
- Tasks: 20 sequential evolution tasks per subject, 100 total.
- Live LLMs: Claude Code via `claude -p`, Grok Build via `grok -p`, and Cursor Composer via `cursor-agent -p --model composer-2.5`, required for paper runs when selected.
- Repetitions: deterministic baselines run once; live-agent baselines run 3 repeats per task.
- Outputs: reproducible JSON, CSV, Markdown summaries, and raw per-run workspaces under `artifacts/bench/<run-id>/`.

## Key Changes

- Add `packages/arch-bench` with a CLI:
  - `arch-bench run --suite paper --out artifacts/bench/<run-id>`
  - `arch-bench run --suite smoke --baselines arch,regen`
  - `arch-bench summarize --input artifacts/bench/<run-id>/results.json`
  - `arch-bench merge --inputs "artifacts/bench/paper-*/results.json" --out artifacts/bench/paper-combined`
- Add root scripts:
  - `pnpm bench:smoke`
  - `pnpm bench:paper`
  - `pnpm bench:summarize <results.json>`
  - `pnpm bench:merge -- --inputs <glob> --out <dir>`
- Add benchmark dataset under `benchmarks/`:
  - `benchmarks/manifest.json`
  - `benchmarks/subjects/<subject>/v00/backend.arch`
  - `benchmarks/subjects/<subject>/tasks/01-.../backend.arch`
  - task-local `oracles/*.test.ts`, `drift/*.ts`, and optional `db-check.ts`.

## Benchmark Model

Use a typed manifest schema owned by `@arch/bench`:

```ts
type BaselineId =
  | "arch-typed-sync"
  | "full-regeneration"
  | "claude-direct-edit"
  | "claude-broad-constrained"
  | "grok-direct-edit"
  | "grok-broad-constrained"
  | "composer-direct-edit"
  | "composer-broad-constrained";

type TaskKind =
  | "additive_field"
  | "enum_change"
  | "workflow_edit"
  | "guarantee_change"
  | "drift_injection"
  | "destructive_block"
  | "migration_data_preservation"
  | "human_owned_edit";

interface BenchTask {
  id: string;
  subject: string;
  order: number;
  kind: TaskKind;
  fromSpec: string;
  toSpec: string;
  intent: string;
  expectedDiffTypes: string[];
  expectedAffectedPaths: string[];
  expectedOutcome: "apply_passes" | "apply_blocks" | "drift_detected";
  oracleTests: string[];
  driftScripts: string[];
  dbCheck?: string;
}
```

Task mix per subject:
- 5 additive field/default changes.
- 2 enum changes.
- 3 workflow edits.
- 2 guarantee additions/removals.
- 2 drift injections.
- 2 destructive/confirmation-required changes.
- 2 migration/data-preservation tasks.
- 2 human-owned edit preservation tasks.

## Baseline Behavior

- `arch-typed-sync`: run `arch parse`, `arch plan`, assert plan determinism by running plan twice, then `arch apply`. For safe tasks, verify, run oracles, check drift. For blocked tasks, assert no promotion and no unexpected writes.
- `full-regeneration`: compile target spec, regenerate every Arch-owned artifact from target IR without using typed diff or affected-artifact planning, preserve `src/custom/**`, then verify and run oracles. This measures churn and off-scope writes.
- `claude-direct-edit`: generate vN project, replace `backend.arch` with target spec, run Claude Code in the temp project with direct edit tools enabled, no typed diff, no allowlist, then verify and run oracles.
- `claude-broad-constrained`: run Claude Code with high-level constraints only: do not edit `src/custom/**`, do not delete/weaken tests, preserve generated project shape. It receives no typed diff and no affected-path allowlist.
- `grok-direct-edit` / `grok-broad-constrained`: same direct and broad-constrained comparison through `grok -p`; constraints are passed as Grok rules.
- `composer-direct-edit` / `composer-broad-constrained`: same direct and broad-constrained comparison through `cursor-agent -p --model composer-2.5`; constraints are embedded in the prompt.

All baselines run in isolated temp directories. Raw stdout/stderr, provider session/cost/model metadata, file diffs, and verification reports are copied into the run artifact directory.

## Metrics

Each task/baseline/repeat records:

```ts
interface BenchResult {
  taskId: string;
  baseline: BaselineId;
  repeat: number;
  passed: boolean;
  blocked: boolean;
  durationMs: number;
  filesTouched: number;
  changedLoc: number;
  expectedFilesTouched: number;
  offScopeFilesTouched: number;
  humanOwnedViolations: number;
  generatedTestDeletedOrWeakened: boolean;
  verificationPassed: boolean;
  oraclePassed: boolean;
  driftRecall: "not_applicable" | "detected" | "missed";
  repairSucceeded?: boolean;
  planDeterministic?: boolean;
  migrationDataPreserved?: boolean;
  llm?: {
    provider: "claude-code" | "grok-build" | "cursor-composer";
    model?: string;
    costUsd?: number;
    sessionId?: string;
    billingMode?: "metered" | "subscription" | "unknown";
  };
}
```

Summary tables aggregate by baseline, task kind, subject, and live-repeat variance.

## Independent Oracles

- Copy benchmark-authored oracle tests into `tests/oracles/<task-id>.test.ts` after each baseline applies changes.
- Oracle tests must assert behavior not merely generated structure: default values, enum validation, guarantee behavior, DB row preservation, and human-owned custom file preservation.
- Negative/destructive tasks assert no metadata promotion, no generated baseline update, and no human-owned edit.
- Drift tasks inject known file/test/static-guarantee corruption and measure whether `arch check` reports the expected drift kind.
- Migration tasks seed Postgres before evolution, apply generated migration SQL, and verify old rows survive with expected defaults.

## Implementation Phases

1. Create `@arch/bench` package, manifest validator, temp workspace runner, command wrapper, and JSON result writer.
2. Convert `scripts/run-examples-e2e.ts` logic into reusable bench helpers without deleting the existing script.
3. Add the five benchmark subjects and 100 task specs, staying inside current V1 language support.
4. Implement deterministic baselines: `arch-typed-sync` and `full-regeneration`.
5. Implement live provider baselines with required `ARCH_BENCH_LIVE=1`; paper runs fail fast if selected provider CLIs are unavailable or unauthenticated.
6. Add metric collectors: git-style file diffing, LOC diffing, off-scope classification, test deletion/weakening detection, drift/repair parsing, and plan determinism checks.
7. Add oracle execution and Postgres migration/data-preservation checks.
8. Add summary generation: `results.json`, `results.csv`, `summary.md`, plus per-baseline tables.

## Test Plan

- Unit tests:
  - manifest validation rejects missing specs, duplicate task ids, invalid task ordering, unknown baselines.
  - metric collector counts touched files, LOC, off-scope paths, human-owned writes, and deleted tests from fixture diffs.
  - summary generator produces stable Markdown/CSV from fixed fixture results.
  - fake provider runners record provider/model/cost/session metadata and handle failed/unparseable runs.
- Integration tests:
  - smoke suite: 2 subjects x 2 tasks x `arch-typed-sync` + `full-regeneration`.
  - fake-LLM direct-edit baselines using injected provider runners.
  - one drift-injection task proving recall and repair metrics.
  - one Postgres-gated migration preservation task.
- Paper run command:
  - `ARCH_BENCH_LIVE=1 ARCH_BENCH_REPEATS=3 pnpm bench:paper`
  - requires authenticated Claude, Grok, and Cursor Agent CLIs for the default all-live paper suite, plus Postgres for DB tasks.

## Assumptions

- Benchmark artifacts can be committed under `benchmarks/`; large run outputs stay ignored under `artifacts/bench/`.
- CI runs build, typecheck, unit tests, the deterministic e2e transcript, and goldens-determinism; the benchmark (`bench:smoke` and `bench:paper`) is run locally/manually and is not yet wired into CI. `bench:paper` in particular is live, slow, and billable.
- Claude Sonnet, Grok Build, and Composer 2.5 are the standard LLM backends for the first multi-model paper-scale run.
- Existing V1 language limits remain: no optional/nullable fields, no unsupported trigger surfaces, no production migration claims beyond tested additive/data-preserving cases.
