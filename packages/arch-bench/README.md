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
and `llm` (provider / model / billing mode / `costUsd` / `sessionId`). See
[`src/report/results.ts`](src/report/results.ts).

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
