# External validation dataset (Phase 2)

> **This directory holds a SYNTHETIC but RUNNABLE demo dataset.**
> Its `.arch` specs are evolved through the **real Arch CLI** by `external run`
> and the `external-run-smoke` integration test, so the outcomes are *observed,
> not declared*. It exists to exercise the Phase 2 external-validation plumbing —
> how the benchmark represents, locks, runs, classifies, and reports externally
> authored service evolutions. **It is synthetic (authored here, not externally)
> and is excluded from every benchmark claim.** Real externally authored
> services, evolutions, authorship/source metadata, and holdout decisions remain
> `[PENDING - EXTERNAL]` per
> [docs/ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md](../../docs/ARCH_VALIDATION_GATE_SPEC_AND_ROADMAP.md).

## What this is

`manifest.json` is an `ExternalManifest` (`arch.bench.external.v1`): externally
authored **services** (each with `author` / `source` / `domain` / `heldOut`
metadata) and their ordered **evolutions**. Every entry carries `fixture: true`.

```
benchmarks/external/
  manifest.json                         # ExternalManifest (synthetic, runnable)
  dataset.lock.json                     # frozen content hash (run `external lock --write`)
  README.md
  services/demo-social/v00/backend.arch # base spec (real .arch)
  services/demo-social/eNN-*/backend.arch  # per-evolution target specs (real .arch)
```

The committed demo evolves a small social service: add a visibility enum
(applies), add a `pinned` flag (applies), remove `pinned` (correctly blocked —
destructive), and rename `pinned`→`isPinned` (blocked, because without
`renamedFrom` metadata it degrades to drop + add — a real capability gap).
Outcomes are produced by actually running Arch, not declared in JSON.

Unsupported/blocked outcomes are **first-class results** — never removed from the
dataset. An evolution whose block is a genuine capability gap carries a
structured `unsupportedReason`; its failure analysis is synthesized from the real
classified outcome plus the documented `suggestedNextSteps`.

## Commands

```bash
# Validate external metadata + referenced specs:
tsx packages/arch-bench/src/main.ts external validate

# Freeze / verify the dataset content hash (post-import edits must bump
# datasetVersion and be disclosed; --check fails an unversioned edit):
tsx packages/arch-bench/src/main.ts external lock --write
tsx packages/arch-bench/src/main.ts external lock --check

# RUN the demo through the real Arch CLI (real outcomes; needs network for the
# per-workspace pnpm install, like the other integration runs):
tsx packages/arch-bench/src/main.ts external run

# Analyze a recorded run's results.json (classify, metrics, failure analysis):
tsx packages/arch-bench/src/main.ts external analyze --input artifacts/bench/<run>/results.json

# Capability matrices (what diffs/migrations Arch can currently sync):
tsx packages/arch-bench/src/main.ts capability-matrix [--format json]
```

The real end-to-end run is covered by
`packages/arch-bench/test-integration/external-run-smoke.test.ts` (gated on
`ARCH_BENCH_SMOKE=1`).

## Metrics

`external run` / `external analyze` emit, per `ExternalManifest`:

- `unsupported_rate_by_kind`, `_by_external_author`, `_by_domain`
- `unsupported_reasons_top_10`
- per-failure `failures/<task>.failure.json` (the required failure-analysis JSON)
- a `passOrExplicitBlockRate` (pass + correct/explicit block)

See [docs/PHASE2_EXTERNAL_PLUMBING.md](../../docs/PHASE2_EXTERNAL_PLUMBING.md) for
the artifact-directory convention and the capability matrices.
