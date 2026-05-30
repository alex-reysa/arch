# Open Source Readiness Checklist

This checklist operationalizes `docs/PUBLIC_V1_GOAL.md`. It is intentionally
evidence-based: every checked item should map to a command, test, document, or
explicit limitation.

## Product Evidence

- [ ] Clean clone quickstart works on a developer machine.
- [ ] `backend.arch` is clearly documented as the source of truth.
- [ ] SocialFeed demo runs end to end.
- [ ] SocialFeed demonstrates spec edit -> typed diff -> plan -> apply.
- [ ] Drift detection demo includes a positive drift case.
- [ ] Repair demo shows bounded, allowlisted, verification-gated repair.
- [ ] Generated code carries traceability headers.
- [ ] Artifact map, ownership map, source map, and drift report are explained.
- [ ] Unsupported language features produce clear diagnostics.
- [ ] Known limitations are prominent and honest.

## Engineering Evidence

- [ ] `pnpm install` works from a clean clone.
- [ ] `pnpm build` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes.
- [ ] Gated CLI apply/verify integration test passes.
- [ ] `pnpm e2e` passes.
- [ ] `pnpm update-goldens` is deterministic.
- [ ] `git diff --check` passes.
- [ ] Generated package install/typecheck/test path is exercised.
- [ ] No local absolute paths are required by tests or docs.
- [ ] No committed secrets or provider credentials.

## LLM And Agent Boundary

- [ ] `AgentProvider` remains the only provider abstraction.
- [ ] At least one real provider adapter exists, or the deferral is explicit.
- [ ] Provider is disabled by default.
- [ ] Mocked provider integration tests exist.
- [ ] Optional live-provider tests are gated by env vars.
- [ ] Invalid provider output is rejected.
- [ ] Provider cannot write outside allowlists.
- [ ] Provider cannot modify human-owned files.
- [ ] Provider cannot weaken guarantees.
- [ ] Provider cannot mark verification passed.
- [ ] Agent run metadata is reviewable.

## Persistence And Runtime

- [ ] Hermetic in-memory generated tests still pass by default.
- [ ] Prisma schema is generated and valid.
- [ ] Migration scaffolds are generated for supported additive changes.
- [ ] Real Prisma/Postgres adapter exists, or the deferral is explicit.
- [ ] Docker/Postgres-gated integration test exists where feasible.
- [ ] Persistence docs explain default mode and real-DB mode.
- [ ] Generated runtime does not hide unsupported production behavior.

## Stress And Abuse Coverage

- [ ] Repeated spec edit/apply cycles are tested.
- [ ] Stale plan is rejected.
- [ ] Corrupted metadata is rejected.
- [ ] Path traversal is rejected.
- [ ] Forbidden `.git` and `node_modules` paths are rejected.
- [ ] `src/custom` and human-owned files are protected.
- [ ] Destructive changes are blocked by default.
- [ ] Confirmation-required changes are blocked by default.
- [ ] Failed install does not promote metadata.
- [ ] Failed verification does not promote metadata.
- [ ] `--skip-verify` does not promote metadata.
- [ ] Generated file hash drift is detected.
- [ ] Missing generated artifact is detected.
- [ ] Missing generated test is detected.
- [ ] Static guarantee drift is detected where supported.
- [ ] Repair fixes allowed generated drift.
- [ ] Repair refuses human-owned edits.
- [ ] Repair stops after max attempts.
- [ ] Invalid agent output is rejected.

## Documentation

- [ ] Top-level `README.md` explains what Arch is and is not.
- [ ] Quickstart commands are copy-pasteable.
- [ ] Example walkthrough exists.
- [ ] Architecture overview points to the founding docs.
- [ ] Contributor guide exists.
- [ ] Test-first workflow is documented for contributors.
- [ ] Security policy exists.
- [ ] Provider configuration is documented.
- [ ] Gated test commands are documented.
- [ ] Known limitations are documented.
- [ ] Roadmap or next issues are documented.
- [ ] Generated code inspection guide exists.

## Repository Hygiene

- [ ] License is present or intentionally deferred.
- [ ] Code of conduct is present or intentionally deferred.
- [ ] Issue templates are present or intentionally deferred.
- [ ] Pull request template is present or intentionally deferred.
- [ ] CI workflow reflects public support matrix.
- [ ] CI avoids requiring secrets for default checks.
- [ ] Optional provider/Docker tests are clearly gated.
- [ ] `.gitignore` excludes local scratch, build outputs, and secrets.
- [ ] Generated artifacts are deterministic.
- [ ] Branch is clean after final verification.

## Final Public V1 Report

Before release, create `docs/PUBLIC_V1_READINESS_REPORT.md` and include:

- [ ] verdict,
- [ ] commit and branch,
- [ ] exact commands and exit codes,
- [ ] product thesis evidence,
- [ ] open-source checklist status,
- [ ] LLM integration status,
- [ ] Prisma/Postgres status,
- [ ] stress/abuse coverage map,
- [ ] known limitations,
- [ ] community risks,
- [ ] recommended next issues.

## Recommended Short Goal

Use this with Claude Code after enabling ultracode:

```text
/goal Read docs/PUBLIC_V1_GOAL.md, docs/OPEN_SOURCE_READINESS_CHECKLIST.md, docs/V1_READINESS_REPORT.md, and founding-docs/CONCEPT.md. Using Superpowers-style test-first development, make Arch Public V1 ready for open-source release: real constrained LLM integration path, credible Prisma/Postgres persistence path, stress/e2e coverage, community docs, CI, and a final public readiness report. Do not call done unless every public claim has passing evidence or an explicit documented limitation.
```
