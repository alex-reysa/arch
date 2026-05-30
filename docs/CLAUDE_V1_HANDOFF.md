# Claude V1 handoff

This file is the compact context handoff for resuming Arch development in
Claude Code. It exists so `/goal` can stay short and reference this document.

## Claude Code setup

Recommended session setup:

```text
/plugin install superpowers@claude-plugins-official
/effort ultracode
```

Then use a short goal that references this file:

```text
/goal Read docs/CLAUDE_V1_HANDOFF.md and keep working until Arch reaches the V1 readiness definition in that file, with tests/e2e passing and a final readiness report produced.
```

For the next phase, use `docs/PUBLIC_V1_GOAL.md` as the active goal and
`docs/OPEN_SOURCE_READINESS_CHECKLIST.md` as the operational checklist.
`docs/V1_READINESS_REPORT.md` is the baseline, not the finish line.

Recommended short Public V1 goal:

```text
/goal Read docs/PUBLIC_V1_GOAL.md, docs/OPEN_SOURCE_READINESS_CHECKLIST.md, docs/V1_READINESS_REPORT.md, and founding-docs/CONCEPT.md. Using Superpowers-style test-first development, make Arch Public V1 ready for open-source release: real constrained LLM integration path, credible Prisma/Postgres persistence path, stress/e2e coverage, community docs, CI, and a final public readiness report. Do not call done unless every public claim has passing evidence or an explicit documented limitation.
```

If Superpowers is installed, use it as an engineering discipline layer only:
test-driven-development, systematic-debugging, code review, and
verification-before-completion. Do not let it replace Arch's roadmap or create
a second product plan.

## Objective

Get Arch to a fully working V1 state: a solid functional product, not just a
scrappy demo. Prioritize correctness, reliability, inspectability, safe sync
behavior, and trustworthy generated output.

## Source of truth

The canonical roadmap and specs are under `founding-docs/`:

- `founding-docs/IMPLEMENTATION_PLAN.md`
- `founding-docs/PRODUCT_SPEC.md`
- `founding-docs/LANGUAGE_SPEC.md`
- `founding-docs/IR_SPEC.md`
- `founding-docs/SYNC_ENGINE_SPEC.md`
- `founding-docs/ARCHITECTURE.md`
- `founding-docs/CONCEPT.md`
- `founding-docs/README.md`

`docs/IMPLEMENTATION_PLAN.md` is only a pointer back to the founding plan.
Treat the founding docs as product authority. Superpowers and Claude workflows
are process tools, not roadmap sources.

## Current baseline

Arch is a TypeScript/pnpm monorepo. Important packages:

- `packages/arch-language`
- `packages/arch-ir`
- `packages/arch-generator`
- `packages/arch-sync`
- `packages/arch-verifier`
- `packages/arch-cli`
- `scripts/run-e2e.ts`
- `examples/social-feed`

Previous verified state:

- M1-M10 are in a strong prototype state.
- The core loop works:
  `backend.arch -> parse -> canonical IR -> plan -> apply -> install -> verify -> promote metadata -> edit spec -> diff -> sync plan -> incremental apply -> verify -> drift check`.
- SocialFeed e2e passes without `--skip-verify`, including the v1 to v2
  `Post.visibility` sync.

Last known passing commands:

```sh
pnpm typecheck
pnpm test
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
pnpm e2e
git diff --check
```

Recent hardening already completed:

- stricter parser, semantic, and IR validation
- canonical hash verification
- generated package/dependency fixes
- valid Prisma schema generation
- model validation before generated workflow insert
- metadata promotion only after install and verify pass
- `--skip-verify` no longer promotes metadata
- corrupt/stale metadata blocks apply
- incremental apply requires latest plan
- `plan_hash` and `plan_id` are validated before incremental apply
- broader sync affected-artifact mapping
- improved e2e, CI, and docs

## Remaining V1 work

Target M11-M15 while confirming M1-M10 do not regress.

1. M11 deterministic patching
   - Move beyond broad whole-file rewrites where narrower deterministic
     patching is required.
   - Ensure patch validation is all-or-nothing.
   - Ensure every planned affected artifact is applied, intentionally skipped,
     or explicitly explained.
   - Complete migration scaffold/content handling.

2. M12 ownership and drift
   - Strengthen artifact-map, ownership, source-map, and metadata schema
     validation.
   - Detect missing, modified, and stale generated artifacts reliably.
   - Protect `src/custom` and human-owned files.
   - Make `arch check` and repair output actionable.

3. Generated backend behavior
   - Generated Prisma schema is valid, but verify whether runtime persistence
     still uses an in-memory abstraction.
   - For V1, generated SocialFeed should use Prisma-backed persistence where
     required by the founding plan.
   - Docker/Postgres integration can be gated, but V1 should have a credible
     path for validating real persistence.

4. M13 agent task protocol
   - Implement the constrained patch-agent protocol from the roadmap.
   - A deterministic/mock agent is acceptable for V1 if protocol schemas,
     allowlists, ownership checks, and verification gates are real.

5. M14 bounded repair loop
   - Implement repair with max attempts, allowlisted files, no human-owned
     edits, and verifier gating.

6. M15 demo polish
   - Make SocialFeed credible end-to-end.
   - Ensure docs, command help, CI, and examples match actual behavior.

## Working strategy

Use ultracode workflows where appropriate. Prefer a workflow audit first, with
independent scopes:

- Language/IR/spec compliance
- Generator/runtime/Prisma/backend behavior
- Sync/diff/planner/patching
- CLI/verifier/snapshot/drift/repair
- E2E/docs/CI/product readiness
- Cross-cutting safety/security/regression review

For implementation, use tests first:

1. Identify the exact acceptance criterion from the founding docs.
2. Write or update a focused failing test.
3. Confirm it fails for the intended reason.
4. Implement the smallest correct change.
5. Run the focused test.
6. Run relevant package checks.
7. Include the change in the final integration pass.

For existing behavior where pure TDD is awkward, write a characterization or
regression test first. Every meaningful behavior change should have one of:

- a failing unit test
- a failing integration test
- a failing e2e assertion
- a documented reason why another verification method is appropriate

## Final readiness definition

Do not call V1 done unless all of this is true:

- M1-M15 are implemented, or any deferrals are explicit and justified.
- The SocialFeed loop demonstrates parse, IR, generate, verify, spec edit,
  diff, plan, apply, verify, and drift check.
- Ownership and drift protections are tested.
- Generated backend behavior matches the V1 cutline in the founding plan.
- The final verification commands pass:

```sh
pnpm typecheck
pnpm test
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
pnpm e2e
git diff --check
```

- A final V1 readiness report is produced with:
  - what works
  - completed milestones
  - remaining deferrals, if any
  - exact verification commands and results
  - risks to monitor next

## Constraints

- Inspect `git status` before editing.
- Do not reset, revert, delete, or overwrite unrelated user changes.
- Prefer existing patterns over new abstractions.
- Keep edits scoped.
- Add tests for behavior changes.
- Do not weaken guarantees, ownership protection, or verification gates.
- Do not mark V1 complete based only on claims; require passing evidence.
