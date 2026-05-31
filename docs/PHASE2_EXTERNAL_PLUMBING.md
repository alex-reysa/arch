# Phase 2 — External Validation Plumbing

Status: **plumbing ready** (coding-agent-completable work landed). The actual
external dataset — real externally authored services, evolutions, authorship/
source metadata, and holdout decisions — remains `[PENDING - EXTERNAL]`. See
[ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md](ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md).

This document describes what the benchmark can now do with external validation
tasks: **represent, lock, run, classify, and report** them. The committed
`benchmarks/external/` data is a synthetic but **runnable** demo: its `.arch`
specs are evolved through the **real Arch CLI** (so outcomes are *observed, not
declared*) by `external run` and the gated `external-run-smoke` integration test.
It is synthetic (authored here, not externally) and **excluded from every
claim** — no external evidence is implied until a real dataset is imported.

## 1. Representation

`benchmarks/external/manifest.json` is an `ExternalManifest` (`arch.bench.external.v1`,
`packages/arch-bench/src/external/schema.ts`):

- **Services** carry authorship metadata: `author`, `source`, `domain`,
  `heldOut` (whether held out during Arch development), plus a `fixture` flag.
- **Evolutions** are ordered per service, each with a task `kind`, an `intent`,
  optional runnable `fromSpec`/`toSpec`, and an external classification.
- Unsupported/blocked outcomes are **first-class** — kept in the dataset, never
  removed. A `blocked_unsupported_capability` evolution must carry a structured
  `unsupportedReason` (with a typed `code`) and may carry a `failureAnalysis`.

A representation-only fixture omits `fromSpec`/`toSpec`; it can be validated,
locked, classified, and reported, but `external run` refuses it rather than
fabricate a run.

## 2. Dataset lock / versioning

Once imported, a dataset's manifest + referenced specs are content-hashed
(`external/dataset-lock.ts`). The lock (`benchmarks/external/dataset.lock.json`)
records `datasetVersion`, an overall `hash`, and per-file hashes.

```bash
tsx packages/arch-bench/src/main.ts external lock --write   # freeze
tsx packages/arch-bench/src/main.ts external lock --check   # verify
```

Policy (roadmap Phase 2): **any post-import modification must bump
`datasetVersion` and be disclosed.** `--check` reports added/modified/removed
files and **fails (exit 1)** if content changed without a version bump
(`unversionedChange`). A change *with* a version bump is reported as a disclosed
new dataset version.

## 3. Run

`external run` projects the `ExternalManifest` onto the internal benchmark shape
(`external/project.ts`) and drives the existing suite orchestrator unchanged, so
external evolutions run through the real Arch CLI exactly like internal tasks.
Each record is tagged with its `externalOutcome`, `unsupportedDiffType`,
`unsupportedReason`, `failureClass`, and the frozen dataset version/hash. The
committed demo exercises this end-to-end in
`packages/arch-bench/test-integration/external-run-smoke.test.ts` (gated on
`ARCH_BENCH_SMOKE=1`): adding a visibility enum and a `pinned` flag really apply
(`passed`), removing `pinned` is correctly refused (`blocked_supported_reason`),
and renaming `pinned`→`isPinned` blocks as a capability gap
(`blocked_unsupported_capability`, `field_rename`) — all observed from the real
run, none declared.

## 4. Classification

Every evolution is classified into an `ExternalOutcome`:

```
passed | blocked_supported_reason | blocked_unsupported_capability
failed_verification | failed_oracle | human_code_violation
migration_check_failed | excessive_churn
```

Classification (`external/classify.ts`) is pure, with documented precedence so a
record never hides a severe problem behind a softer label:

1. `human_code_violation` (protected `src/custom/**` touched)
2. `migration_check_failed` (a real dbCheck reported failed)
3. `blocked_*` (capability gap if annotated, else a correct/supported refusal)
4. `failed_verification` → `failed_oracle` → `excessive_churn` → `passed`

`excessive_churn` is only meaningful when the evolution declares an expected
affected-path allowlist (so "off-scope" is defined). External evolutions usually
don't, so a legitimately-generated diff is never mistaken for churn — the
classifier ignores off-scope churn unless an allowlist matched.

For every non-passing task, the required **failure-analysis JSON** is produced
(`failures/<task>.failure.json`):

```json
{
  "task": "external-crm-07",
  "outcome": "blocked_unsupported_capability",
  "unsupportedDiff": "relation_cardinality_change",
  "reason": "Changing one-to-many relation cardinality requires data migration semantics not implemented.",
  "suggestedNextSteps": ["add explicit migration plan", "split into additive relation + backfill + deprecation"],
  "shouldArchSupportThis": true,
  "priority": "high"
}
```

## 5. Metrics (unsupported as a product signal)

`external/metrics.ts` reports unsupported outcomes as metrics, not as failures
to hide:

- `unsupported_rate_by_kind`
- `unsupported_rate_by_external_author`
- `unsupported_rate_by_domain`
- `unsupported_reasons_top_10`
- `passOrExplicitBlockRate` (pass + correct/explicit block — the go/no-go shape)

"Unsupported" means `blocked_unsupported_capability` — a genuine Arch capability
gap, distinct from a correct refusal of a destructive change.

## 6. Report fields

`results.csv` gains: `externalOutcome`, `unsupportedDiffType`,
`unsupportedReason`, `failureClass`, `externalDatasetVersion`,
`externalDatasetHash`. `summary.md` gains an **External validation** section
(outcomes, unsupported-rate by kind, top reasons, dataset version/hash) — emitted
only when external records are present, so internal-only summaries are unchanged.
The richer authorship/domain breakdown and the fixture banner live in
`external-summary.md`.

## 7. Capability matrices

`external/capability.ts` is an honest map of what Arch can currently
synchronize, with structured reasons and suggested next steps — the current
boundary, refined by external validation, not a completeness claim.

```bash
tsx packages/arch-bench/src/main.ts capability-matrix            # markdown
tsx packages/arch-bench/src/main.ts capability-matrix --format json
```

Two matrices:

- **Diff capability matrix** — per spec-diff family: `supported` / `partial` /
  `blocked` / `unsupported`, with reason + next steps.
- **Migration capability matrix** — the roadmap's seven migration classes
  (additive nullable; additive required-with-default; index add/drop; rename
  with metadata; destructive removal; relation change; type narrowing/widening),
  each with a support level, data-preservation status, and reason.

## 8. Artifact directory convention (final validation run)

A validation/paper run writes a single, self-describing directory:

```
artifacts/bench/<run-id>/
  results.json          # machine-readable run envelope (schema arch.bench.results.v1)
  results.csv           # one row per record (incl. external + run-mode columns)
  summary.md            # human summary (incl. external section when present)
  logs/<subject>/<baseline>/r<repeat>/<task>.log         # raw per-task log
  logs/<subject>/<baseline>/r<repeat>/<task>.result.json # per-task structured result (diffs, churn, timings)
  failures/<task>.failure.json     # external failure-analysis (Phase 2)
  external-metrics.json            # unsupported-rate metrics (Phase 2)
  external-summary.md              # external + fixture-banner summary (Phase 2)
  capability-matrix.md             # capability matrices snapshot
  dataset.lock.json                # frozen external dataset hash for the run
```

`artifacts/bench/` is git-ignored; published runs copy this tree verbatim so raw
logs, diffs, failures, and timings travel together.

## 9. Reproducible setup (Docker)

```bash
# One-shot: throwaway Postgres up → strict isolated migration slice →
# capability matrices → external lock check + fixture analysis → DB down.
scripts/bench-validation/run-validation.sh artifacts/bench/validation-<stamp>

# Or manage Postgres directly:
docker compose -f scripts/bench-validation/docker-compose.yml up -d
docker compose -f scripts/bench-validation/docker-compose.yml down -v
```

The migration dbCheck resets the target `public` schema, so the compose file
provisions a disposable, tmpfs-backed Postgres on port 55432 — never a real
database.

## What is still pending external input

- At least 3 externally authored service specs and ≥20 evolutions, not edited to
  fit Arch after import.
- Authorship/source metadata and holdout decisions for those imports.
- Realistic non-Arch baselines that require human/manual/codemod execution.
- The go/no-go product decision based on external metrics.
