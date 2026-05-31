# Arch Validation Gate Spec And Roadmap

## Summary

Goal: move Arch from "promising internal prototype" to a defensible narrow system: typed, verification-gated synchronization for Arch-owned generated backend service substrates, with human behavior behind explicit extension points and LLMs treated as optional non-authoritative helpers.

Primary target: a 4-6 week validation gate. Arch continues only if it can pass externally authored service evolutions with stable workflow diffs, real migration checks, independent oracles, protected human code, and lower off-scope churn than realistic baselines.

Center of gravity: make measurement honest enough, then let external validation decide what Arch is. The internal 100-task benchmark remains regression coverage, not external proof.

Current multi-model benchmark work is useful if already near completion, but not required for the validation gate. The gate depends on external service evolution, real migration checks, independent oracles, realistic baselines, and transparent unsupported outcomes.

## Status Legend

- `[DONE]`: implemented and verified in the repo.
- `[PARTIAL]`: repo support exists, but evidence or scope is incomplete.
- `[PENDING - AGENT]`: can be completed by the coding agent in this repo.
- `[PENDING - EXTERNAL]`: requires user-supplied input, external authors, infrastructure, paid/live credentials, or a product decision.
- `[ONGOING]`: a rule to keep enforcing rather than a one-time implementation task.

## Ownership Split

Coding-agent-completable work:

- `[DONE]` Multi-model benchmark infrastructure and the 8-baseline manifest.
- `[DONE]` Phase 1 measurement foundation: named workflow-step identity, executable dbCheck runner, migration result fields/scoring, strict validation, run modes, report fields, and focused tests.
- `[DONE]` Strict validation now passes on the internal 100-task manifest via verifier-backed guarantee assertions while latency guarantees remain excluded from behavioral correctness claims.
- `[DONE]` External-validation plumbing: `benchmarks/external/`, dataset hashing/versioning, `ExternalOutcome`, unsupported-rate reporting, failure-analysis JSON, and external report dimensions. Exercised by a clearly-marked fixture/demo dataset; the real external dataset is `[PENDING - EXTERNAL]`.
- `[PARTIAL]` Product-boundary implementation: the capability matrix and migration capability matrix are `[DONE]`; typed extension points and the brownfield harness remain `[PENDING - AGENT]` until external failures justify them.
- `[DONE]` Reproducibility packaging: Docker compose + a one-shot validation script, the artifact-directory convention / raw-log layout, and summary tables for the final validation run.

Requires user/external input:

- `[DONE]` A throwaway Postgres URL or working Docker/Postgres environment for representative live migration-preservation evidence; `test-integration/migration-dbcheck-postgres.test.ts` now passes with a DB URL and skips without one.
- `[PENDING - EXTERNAL]` At least 3 externally authored service specs and at least 20 externally authored evolutions that are not edited to fit Arch after import.
- `[PENDING - EXTERNAL]` External author/source metadata and a decision on which imported tasks are held out during development.
- `[PENDING - EXTERNAL]` Realistic non-Arch baselines that require human/manual/codemod/framework-native execution, unless the user accepts agent-authored approximations.
- `[PENDING - EXTERNAL]` Go/no-go product decision after external metrics are available.
- `[PENDING - EXTERNAL]` Publication decision, artifact release policy, and any paid/live model runs.

## Phase 0: Claim Freeze And Measurement Freeze

Status: `[DONE]` for the repo changes, `[ONGOING]` for claim discipline.

Before more engineering, freeze public claims and benchmark rules.

`[ONGOING]` No new public claim may be added unless it maps to an acceptance criterion and a reproducible evidence artifact.

Add a claim ledger:

| Claim | Evidence required | Current status |
| --- | --- | --- |
| Arch-owned generated substrate is build artifact | Deterministic regeneration plus drift repair | `[PARTIAL]` Internally supported; external validation pending |
| Workflow edits are stable | Named-step insertion/reorder tests | `[DONE]` Internal named-step parser/IR/diff/generator tests |
| Migration preservation | Real Postgres `dbCheck` per migration task | `[PARTIAL]` dbCheck wired for all internal migration tasks; representative Postgres integration evidence captured; full paper-scale all-migration DB run pending |
| Human code is protected | Seeded custom logic plus extension contracts | `[PARTIAL]` Protected custom files covered; typed extension contracts pending |
| External usefulness | 3 external specs plus 20 evolutions | `[PENDING - EXTERNAL]` |

Reframe the public claim:

- `[DONE]` Use: "Arch-owned generated service substrate is a build artifact."
- `[DONE]` Avoid: "implementation code is a build artifact," "AI writes your backend," or "scientific proof."
- `[ONGOING]` Document this in README/reports before new benchmark claims are published.

Multi-model baselines:

- `[DONE]` Land the multi-model branch only if already near-complete. Otherwise, defer it behind validation-critical work.
- `[DONE]` If landed, keep 8 baselines: deterministic Arch, full regeneration, Claude direct/constrained, Grok direct/constrained, Composer direct/constrained.
- `[DONE]` Add a note in benchmark docs: multi-model baselines broaden comparison but do not solve benchmark neutrality.

## Phase 1: Minimal Credibility Blockers

Status: `[DONE]` for repo implementation, internal verification, and representative live Postgres integration evidence.

Make the benchmark honest enough to measure external tasks.

Add stable workflow step identity:

- `[DONE]` Existing syntax remains valid: `step validate title`.
- `[DONE]` Add named-step syntax: `step validate_title: validate title`.
- `[DONE]` IR preserves `step.name?: string`, `step.order`, and stable entity id `step:<Workflow>.<name>` when a name is present.
- `[DONE]` Unnamed steps keep legacy positional IDs but are treated as legacy/unstable for workflow-edit diffs.
- `[DONE]` Diff engine matches named steps by stable ID and emits `workflow_step_added`, `workflow_step_removed`, `workflow_step_reordered`, or `workflow_step_changed` without positional ambiguity.

Make migration checks real:

- `[DONE]` Replace stub-only `db-check.ts` behavior with executable checks.
- `[DONE]` Define db-check contract: `tsx db-check.ts <projectDir>` with `DATABASE_URL`/`ARCH_BENCH_DATABASE_URL` in env.
- `[DONE]` Add result fields:

  ```ts
  migrationCheckStatus?: "passed" | "failed" | "skipped" | "not_applicable";
  migrationDataPreserved?: boolean;
  migrationCheckReason?: string;
  ```

- `[DONE]` In validation/paper mode, any `migration_data_preservation` task with skipped/failed db check fails scoring.
- `[DONE]` Convert current migration db-check stubs into real Postgres checks for all 9 internal migration tasks.
- `[DONE]` Run representative migration checks against a real throwaway Postgres database and preserve the evidence artifact.
- `[PENDING - EXTERNAL]` Run the full paper-scale DB-backed migration slice across all migration tasks.

Strengthen benchmark semantics:

- `[DONE]` Add `arch-bench validate --strict` or equivalent strict manifest validation.
- `[DONE]` Strict validation requires every `apply_passes` task to have an oracle, and every `guarantee_change` task to have a behavioral oracle or verifier-backed guarantee assertion.
- `[DONE]` Add run modes:

  ```bash
  --task-mode sequential|isolated
  --failure-policy restore-from-spec|continue-contaminated
  ```

- `[DONE]` Validation runs include isolated-mode and restore-from-spec coverage in the benchmark tests.

Latency guarantees:

- `[PENDING - AGENT]` Add real measurable benchmark/load oracles if latency correctness should become a behavioral claim.
- `[DONE]` Otherwise, classify it as `declared_but_not_behaviorally_verified` and exclude it from correctness claims.

## Phase 2: External Validation Starts Immediately

Status: `[DONE]` for plumbing, `[PENDING - EXTERNAL]` for the actual external dataset. See docs/PHASE2_EXTERNAL_PLUMBING.md.

`[PENDING - EXTERNAL]` Collect at least 3 externally authored backend workflow service specs before implementing expressiveness fixes, then freeze the initial import and record all unsupported cases.

The point is not to pass at first. The point is to discover what breaks.

Formalize external validation data:

- `[DONE]` Add `benchmarks/external/` or an equivalent manifest section for externally authored services.
- `[DONE]` Each external task records author/source, whether it was held out during development, and unsupported outcome if Arch blocks it.
- `[DONE]` Unsupported diffs are first-class results, not removed from the dataset.
- `[DONE]` Once an external service is imported, its initial spec and evolution list are content-hashed.
- `[DONE]` Any post-import modification creates a new dataset version and must be reported.
- `[PENDING - EXTERNAL]` Provide the actual external service specs, evolutions, authorship/source metadata, and holdout decisions.

`[DONE]` Classify every external evolution:

```ts
type ExternalOutcome =
  | "passed"
  | "blocked_supported_reason"
  | "blocked_unsupported_capability"
  | "failed_verification"
  | "failed_oracle"
  | "human_code_violation"
  | "migration_check_failed"
  | "excessive_churn";
```

Report unsupported outcomes as product metrics:

- `[DONE]` `unsupported_rate_by_kind`
- `[DONE]` `unsupported_rate_by_external_author`
- `[DONE]` `unsupported_rate_by_domain`
- `[DONE]` `unsupported_reasons_top_10`

`[DONE]` Required failure analysis output for every failed external task:

```json
{
  "task": "external-crm-07",
  "outcome": "blocked_unsupported_capability",
  "unsupportedDiff": "relation_change",
  "reason": "Changing one-to-many relation cardinality requires data migration semantics not implemented.",
  "suggestedNextSteps": [
    "add explicit migration plan",
    "split into additive relation + backfill + deprecation"
  ],
  "shouldArchSupportThis": true,
  "priority": "high"
}
```

## Phase 3: Fix Only Failures Exposed By External Validation

Status: `[PENDING - EXTERNAL]` until Phase 2 produces real failures, then `[PENDING - AGENT]` for selected fixes.

Do not add expressiveness because it feels useful. Add it because external specs demand it.

| External failure | Product response |
| --- | --- |
| Needs nullable fields | Add nullable/optional grammar |
| Needs renames | Add `renamedFrom` metadata |
| Needs workflow insertion | Named-step diff support |
| Needs custom behavior | Typed extension-point contracts |
| Needs relation evolution | Migration capability matrix |
| Needs query endpoints | Decide whether V1 scope expands or blocks honestly |

Improve product boundaries around human code:

- `[PENDING - AGENT]` Add typed extension-point requirements beyond "preserve `src/custom/**`": policies, hooks, integrations, and custom workflow calls should produce typed stubs/contracts.
- `[PENDING - EXTERNAL]` External validation must include human code that is actually used, not merely preserved:

  ```text
  policy sanitizeText implemented_by "./src/custom/policies/sanitizeText.ts"
  hook before_insert Task implemented_by "./src/custom/hooks/beforeInsertTask.ts"
  integration SlackNotifier implemented_by "./src/custom/integrations/slack.ts"
  ```

- `[PENDING - AGENT]` Acceptance for extension points requires:
  - Generated code imports the typed interface.
  - Human implementation compiles.
  - Regeneration preserves it.
  - Spec evolution does not break it silently.
  - If the contract changes, Arch emits a clear migration/error.

`[DONE]` Add a capability matrix for supported/blocked diffs with structured reasons and suggested next steps.

`[DONE]` Explicitly classify migration support (see the migration capability matrix):

- Additive nullable.
- Additive required with default.
- Index add/drop.
- Rename with explicit metadata.
- Destructive removal.
- Relation change.
- Type narrowing/widening.

`[PENDING - EXTERNAL]` Add a small brownfield validation:

```text
Given an existing generated Arch project with custom code and one manual integration,
can Arch evolve the spec without destroying local behavior?
```

## Phase 4: Go/No-Go Review

Status: `[PENDING - EXTERNAL]`.

Platform continuation threshold:

- `[PENDING - EXTERNAL]` At least 70% of external evolutions pass or block for a correct/explicit reason.
- `[PENDING - EXTERNAL]` 0 human-owned file violations on the external validation set.
- `[PENDING - EXTERNAL]` 0 false migration-preservation claims on real Postgres checks.
- `[PENDING - EXTERNAL]` 100% of migration-preservation passes require real `dbCheck`.
- `[PENDING - EXTERNAL]` At least 90% of named workflow-step edits produce stable bounded diffs.
- `[PENDING - EXTERNAL]` Median off-scope churn is lower than protected regeneration and LLM baselines.
- `[PENDING - EXTERNAL]` Unsupported cases are reported, not removed.

Research/publication threshold:

- `[PENDING - EXTERNAL]` At least 5 external services.
- `[PENDING - EXTERNAL]` At least 50 external evolutions.
- `[DONE]` Frozen dataset hash before final run (external dataset lock tooling).
- `[DONE]` Reproducible Docker setup (`scripts/bench-validation/`).
- `[PARTIAL]` Raw logs, diffs, failures, costs, and timings: the artifact-directory layout is defined and produced per run; actual publication is a release-time action.
- `[PENDING - EXTERNAL]` Independent oracles for all claimed behavioral guarantees.

`[PENDING - EXTERNAL]` Continue as a platform only if the validation gate passes. If it fails on expressiveness or user ergonomics, pivot to a smaller product: typed service scaffolding plus migration-aware regeneration.

## Realistic Baselines

The realistic baselines that matter most are:

1. `[DONE]` Arch typed sync.
2. `[DONE]` Protected full regeneration.
3. `[PENDING - EXTERNAL]` Manual/codemod/codegen-style patching.
4. `[DONE]` LLM patching with tests for Claude/Grok/Composer live-agent variants; full paper runs require credentials/subscriptions.
5. `[PENDING - EXTERNAL]` Framework-native generator where applicable.

`[DONE]` Multi-model Claude/Grok/Composer comparison is useful for variance and cost analysis, but secondary to whether Arch solves real service evolution better than realistic alternatives.

## Test Plan

Unit tests:

- `[DONE]` Parser accepts both legacy and named workflow step syntax.
- `[DONE]` IR canonicalization is stable when named steps are inserted, removed, or reordered.
- `[DONE]` Diff engine matches named steps by ID, not position.
- `[DONE]` Manifest strict validation rejects missing oracles for `apply_passes` and guarantee tasks.
- `[DONE]` Migration check runner records passed, failed, skipped, and not-applicable statuses.
- `[DONE]` Scoring fails validation-mode migration tasks unless `migrationCheckStatus === "passed"`.
- `[DONE]` External outcome classification preserves unsupported cases as reportable results.
- `[DONE]` Dataset locking detects post-import edits and creates a new dataset version.

Integration tests:

- `[DONE]` A workflow insertion with named steps produces bounded workflow/test artifacts and no duplicate `const validation`.
- `[DONE]` A migration task seeds Postgres before evolution, applies generated migration SQL, runs `db-check.ts`, and records `migrationDataPreserved: true`.
- `[DONE]` Isolated mode runs a task from `fromSpec` without replaying previous baseline failures.
- `[DONE]` Sequential restore mode recovers after a failed baseline before the next task.
- `[DONE]` Strict benchmark validation passes only after required oracles and db checks are wired.
- `[DONE]` An external validation task that hits an unsupported capability produces structured failure analysis.
- `[PENDING - EXTERNAL]` A brownfield project with custom code and one manual integration survives a spec evolution.

Validation commands:

```bash
# [DONE]
pnpm typecheck
pnpm test
pnpm exec tsx packages/arch-bench/src/main.ts validate --strict
ARCH_BENCH_SMOKE=1 pnpm --filter @arch/bench test
pnpm bench:smoke

# [PENDING - EXTERNAL]
ARCH_BENCH_DB=1 ARCH_BENCH_DATABASE_URL=<url> pnpm bench:paper -- --task-mode isolated --failure-policy restore-from-spec
```

## Acceptance Criteria

- `[PARTIAL]` No migration preservation claim is made unless `dbCheck` actually ran against Postgres. Repo scoring enforces this, and representative Postgres evidence is captured; full paper-scale all-migration DB evidence remains pending.
- `[DONE]` Named workflow step edits are non-destructive and stable across insertion/reorder cases.
- `[DONE]` Every safe/guarantee-bearing internal task has an independent oracle or explicit verifier-backed assertion.
- `[DONE]` Latency guarantees are either measured by a real oracle or excluded from correctness claims.
- `[DONE]` Benchmark reports separate results by task kind, run mode, baseline, model, and migration/guarantee status, plus the Phase 2 external dimensions (external outcome, failure class, unsupported diff type, unsupported reason, external dataset version/hash). External dimensions populate only on external runs; real external data is `[PENDING - EXTERNAL]`.
- `[PENDING - EXTERNAL]` At least 3 external services and 20 external evolutions run without modifying the dataset to fit Arch after first import.
- `[DONE]` The external dataset is frozen before final validation runs; any edits after first import are versioned and disclosed (dataset lock tooling + `external lock --check`). Awaits a real dataset to freeze.
- `[PENDING - EXTERNAL]` A platform continuation decision is based on external validation metrics, not internal benchmark pass rate.
- `[DONE]` Final claim is narrow and defensible: Arch synchronizes generated backend substrates under typed diffs, ownership boundaries, verification gates, and drift repair.

## Assumptions

- Current internal 100-task benchmark remains useful as regression coverage, not external proof.
- Postgres-gated migration checks are acceptable for validation/paper runs even if normal smoke runs skip them.
- Backward compatibility matters: existing unnamed `step ...` syntax should keep compiling, but external validation specs should use named steps.
- LLMs remain non-authoritative; correctness comes from typed plans, ownership rules, checks, oracles, and verified promotion.
- It is acceptable, and expected, that the first external validation run exposes unsupported cases. The goal is not first-run success; the goal is honest capability mapping.
