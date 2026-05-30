# Arch Validation Gate Spec And Roadmap

## Summary

Goal: move Arch from "promising internal prototype" to a defensible narrow system: typed, verification-gated synchronization for Arch-owned generated backend service substrates, with human behavior behind explicit extension points and LLMs treated as optional non-authoritative helpers.

Primary target: a 4-6 week validation gate. Arch continues only if it can pass externally authored service evolutions with stable workflow diffs, real migration checks, independent oracles, protected human code, and lower off-scope churn than realistic baselines.

Center of gravity: make measurement honest enough, then let external validation decide what Arch is. The internal 100-task benchmark remains regression coverage, not external proof.

Current multi-model benchmark work is useful if already near completion, but not required for the validation gate. The gate depends on external service evolution, real migration checks, independent oracles, realistic baselines, and transparent unsupported outcomes.

## Phase 0: Claim Freeze And Measurement Freeze

Before more engineering, freeze public claims and benchmark rules.

No new public claim may be added unless it maps to an acceptance criterion and a reproducible evidence artifact.

Add a claim ledger:

| Claim | Evidence required | Current status |
| --- | --- | --- |
| Arch-owned generated substrate is build artifact | Deterministic regeneration plus drift repair | Partially proven |
| Workflow edits are stable | Named-step insertion/reorder tests | Unproven |
| Migration preservation | Real Postgres `dbCheck` per migration task | Mostly unproven |
| Human code is protected | Seeded custom logic plus extension contracts | Partially proven |
| External usefulness | 3 external specs plus 20 evolutions | Unproven |

Reframe the public claim:

- Use: "Arch-owned generated service substrate is a build artifact."
- Avoid: "implementation code is a build artifact," "AI writes your backend," or "scientific proof."
- Document this in README/reports before new benchmark claims are published.

Multi-model baselines:

- Land the multi-model branch only if already near-complete. Otherwise, defer it behind validation-critical work.
- If landed, keep 8 baselines: deterministic Arch, full regeneration, Claude direct/constrained, Grok direct/constrained, Composer direct/constrained.
- Add a note in benchmark docs: multi-model baselines broaden comparison but do not solve benchmark neutrality.

## Phase 1: Minimal Credibility Blockers

Make the benchmark honest enough to measure external tasks.

Add stable workflow step identity:

- Existing syntax remains valid: `step validate title`.
- Add named-step syntax: `step validate_title: validate title`.
- IR preserves `step.name?: string`, `step.order`, and stable entity id `step:<Workflow>.<name>` when a name is present.
- Unnamed steps keep legacy positional IDs but are marked unstable for workflow-edit diffs.
- Diff engine matches named steps by stable ID and emits `workflow_step_added`, `workflow_step_removed`, `workflow_step_reordered`, or `workflow_step_changed` without positional ambiguity.

Make migration checks real:

- Replace stub-only `db-check.ts` behavior with executable checks.
- Define db-check contract: `tsx db-check.ts <projectDir>` with `DATABASE_URL`/`ARCH_BENCH_DATABASE_URL` in env.
- Add result fields:

  ```ts
  migrationCheckStatus?: "passed" | "failed" | "skipped" | "not_applicable";
  migrationDataPreserved?: boolean;
  migrationCheckReason?: string;
  ```

- In validation/paper mode, any `migration_data_preservation` task with skipped/failed db check fails scoring.
- Convert current migration db-check stubs into real Postgres checks for all 9 internal migration tasks.

Strengthen benchmark semantics:

- Add `arch-bench validate --strict` or equivalent strict manifest validation.
- Strict validation requires every `apply_passes` task to have an oracle, and every `guarantee_change` task to have a behavioral oracle or verifier-backed guarantee assertion.
- Add run modes:

  ```bash
  --task-mode sequential|isolated
  --failure-policy restore-from-spec|continue-contaminated
  ```

- Validation runs must include isolated mode to avoid sequential contamination, and sequential mode with `restore-from-spec` to test long-lived evolution without cascading failures.

Latency guarantees:

- A latency guarantee must have a real measurable benchmark/load oracle to count as behaviorally verified.
- Otherwise, classify it as `declared_but_not_behaviorally_verified` and exclude it from correctness claims.

## Phase 2: External Validation Starts Immediately

Collect at least 3 externally authored backend workflow service specs before implementing expressiveness fixes, then freeze the initial import and record all unsupported cases.

The point is not to pass at first. The point is to discover what breaks.

Formalize external validation data:

- Add `benchmarks/external/` or an equivalent manifest section for externally authored services.
- Each external task records author/source, whether it was held out during development, and unsupported outcome if Arch blocks it.
- Unsupported diffs are first-class results, not removed from the dataset.
- Once an external service is imported, its initial spec and evolution list are content-hashed.
- Any post-import modification creates a new dataset version and must be reported.

Classify every external evolution:

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

- `unsupported_rate_by_kind`
- `unsupported_rate_by_external_author`
- `unsupported_rate_by_domain`
- `unsupported_reasons_top_10`

Required failure analysis output for every failed external task:

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

- Add typed extension-point requirements beyond "preserve `src/custom/**`": policies, hooks, integrations, and custom workflow calls should produce typed stubs/contracts.
- External validation must include human code that is actually used, not merely preserved:

  ```text
  policy sanitizeText implemented_by "./src/custom/policies/sanitizeText.ts"
  hook before_insert Task implemented_by "./src/custom/hooks/beforeInsertTask.ts"
  integration SlackNotifier implemented_by "./src/custom/integrations/slack.ts"
  ```

- Acceptance for extension points requires:
  - Generated code imports the typed interface.
  - Human implementation compiles.
  - Regeneration preserves it.
  - Spec evolution does not break it silently.
  - If the contract changes, Arch emits a clear migration/error.

Add a capability matrix for supported/blocked diffs with structured reasons and suggested next steps.

Explicitly classify migration support:

- Additive nullable.
- Additive required with default.
- Index add/drop.
- Rename with explicit metadata.
- Destructive removal.
- Relation change.
- Type narrowing/widening.

Add a small brownfield validation:

```text
Given an existing generated Arch project with custom code and one manual integration,
can Arch evolve the spec without destroying local behavior?
```

## Phase 4: Go/No-Go Review

Platform continuation threshold:

- At least 70% of external evolutions pass or block for a correct/explicit reason.
- 0 human-owned file violations.
- 0 false migration-preservation claims.
- 100% of migration-preservation passes require real `dbCheck`.
- At least 90% of named workflow-step edits produce stable bounded diffs.
- Median off-scope churn is lower than protected regeneration and LLM baselines.
- Unsupported cases are reported, not removed.

Research/publication threshold:

- At least 5 external services.
- At least 50 external evolutions.
- Frozen dataset hash before final run.
- Reproducible Docker setup.
- Raw logs, diffs, failures, costs, and timings published.
- Independent oracles for all claimed behavioral guarantees.

Continue as a platform only if the validation gate passes. If it fails on expressiveness or user ergonomics, pivot to a smaller product: typed service scaffolding plus migration-aware regeneration.

## Realistic Baselines

The realistic baselines that matter most are:

1. Arch typed sync.
2. Protected full regeneration.
3. Manual/codemod/codegen-style patching.
4. LLM patching with tests.
5. Framework-native generator where applicable.

Multi-model Claude/Grok/Composer comparison is useful for variance and cost analysis, but secondary to whether Arch solves real service evolution better than realistic alternatives.

## Test Plan

Unit tests:

- Parser accepts both legacy and named workflow step syntax.
- IR canonicalization is stable when named steps are inserted, removed, or reordered.
- Diff engine matches named steps by ID, not position.
- Manifest strict validation rejects missing oracles for `apply_passes` and guarantee tasks.
- Migration check runner records passed, failed, skipped, and not-applicable statuses.
- Scoring fails validation-mode migration tasks unless `migrationCheckStatus === "passed"`.
- External outcome classification preserves unsupported cases as reportable results.
- Dataset locking detects post-import edits and creates a new dataset version.

Integration tests:

- A workflow insertion with named steps produces bounded workflow/test artifacts and no duplicate `const validation`.
- A migration task seeds Postgres before evolution, applies generated migration SQL, runs `db-check.ts`, and records `migrationDataPreserved: true`.
- Isolated mode runs a task from `fromSpec` without replaying previous baseline failures.
- Sequential restore mode recovers after a failed baseline before the next task.
- Strict benchmark validation passes only after required oracles and db checks are wired.
- An external validation task that hits an unsupported capability produces structured failure analysis.
- A brownfield project with custom code and one manual integration survives a spec evolution.

Validation commands:

```bash
pnpm typecheck
pnpm test
ARCH_BENCH_SMOKE=1 pnpm --filter @arch/bench test
pnpm bench:smoke
ARCH_BENCH_DB=1 ARCH_BENCH_DATABASE_URL=<url> pnpm bench:paper -- --task-mode isolated --failure-policy restore-from-spec
```

## Acceptance Criteria

- No migration preservation claim is made unless `dbCheck` actually ran against Postgres.
- Named workflow step edits are non-destructive and stable across insertion/reorder cases.
- Every safe/guarantee-bearing task has an independent oracle or explicit verifier-backed assertion.
- Latency guarantees are either measured by a real oracle or excluded from correctness claims.
- Benchmark reports separate results by task kind, run mode, baseline, model, failure class, unsupported diff type, and external dataset version.
- At least 3 external services and 20 external evolutions run without modifying the dataset to fit Arch after first import.
- The external dataset is frozen before final validation runs; any edits after first import are versioned and disclosed.
- A platform continuation decision is based on external validation metrics, not internal benchmark pass rate.
- Final claim is narrow and defensible: Arch synchronizes generated backend substrates under typed diffs, ownership boundaries, verification gates, and drift repair.

## Assumptions

- Current internal 100-task benchmark remains useful as regression coverage, not external proof.
- Postgres-gated migration checks are acceptable for validation/paper runs even if normal smoke runs skip them.
- Backward compatibility matters: existing unnamed `step ...` syntax should keep compiling, but external validation specs should use named steps.
- LLMs remain non-authoritative; correctness comes from typed plans, ownership rules, checks, oracles, and verified promotion.
- It is acceptable, and expected, that the first external validation run exposes unsupported cases. The goal is not first-run success; the goal is honest capability mapping.
