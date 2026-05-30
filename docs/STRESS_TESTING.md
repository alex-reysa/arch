# Stress Testing Arch's Trust Boundaries

This guide is for security-minded contributors who want to **stress Arch's trust
boundaries** and confirm they hold. Arch's core promise is that the only thing
that ever flows from a spec into your codebase is *generated, owned, verified*
code — and that no path, plan, metadata file, or agent/LLM output can talk Arch
into writing somewhere it shouldn't or promoting state it shouldn't.

Every claim below is backed by a real test. The coverage table maps each
abuse/stress scenario to the **exact `it()` name** that proves it, the file it
lives in, and (further down) how to run it. The `it()` names are quoted verbatim
from the source — if a name here ever drifts from the test, treat the test as
the source of truth and fix this doc.

## Trust boundaries at a glance

Arch defends a small number of boundaries. Each row in the table maps to one of
these:

1. **Plan integrity** — a plan must match the IR it was built from
   (`base_ir_hash`, `target_ir_hash`) and its own `plan_hash`. A stale or
   tampered plan is refused before anything is written.
2. **Path policy** — writes must stay inside the repo, inside the plan's
   allowlist, and out of forbidden globs (`.git`, `node_modules`,
   human-owned `src/custom/**`).
3. **Ownership** — Arch never overwrites human-owned files; it only rewrites
   files it generated and only patches/stubs where ownership permits.
4. **Change safety** — destructive and confirmation-required changes are
   blocked unless explicitly authorized.
5. **State promotion** — metadata (`artifact-map.json`, `ownership.json`,
   `ir.previous.json`) is promoted **only** after install *and* verify pass.
   Any failure (or `--skip-verify`) leaves the baseline untouched.
6. **Agent/LLM containment** — an agent or LLM provider is a hostile input.
   Its output is independently re-validated against the same path/ownership
   rules; it cannot widen its own permissions or have its self-claims trusted.

## Coverage table

| Scenario | Status | Test file | Exact `it()` name |
| --- | --- | --- | --- |
| Repeated spec edit → plan → apply cycles stay drift-free | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `supports repeated spec edit -> plan -> apply cycles, promoting metadata and staying drift-free` |
| Stale plan rejected — base hash mismatch | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `rejects latest plans whose base hash does not match ir.previous` |
| Stale plan rejected — target hash mismatch | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `rejects latest plans whose target hash does not match current IR` |
| Stale plan rejected — `plan_hash` mismatch (tampered content) | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `rejects latest plans whose content no longer matches plan_hash` |
| Corrupt metadata rejected (`arch check`, fail closed) | covered | `packages/arch-cli/test/check.test.ts` | `exits 2 when metadata JSON is corrupt` |
| Corrupt metadata rejected (drift detector, fail closed) | covered | `packages/arch-verifier/test-drift/drift-detector.test.ts` | `fails closed when metadata JSON is corrupt` |
| Path traversal rejected (absolute paths) | covered | `packages/arch-sync/test/patch-validator.test.ts` | `rejects absolute paths` |
| Path traversal rejected (parent-escape `../`) | covered | `packages/arch-sync/test/patch-validator.test.ts` | `rejects parent-escape segments` |
| Forbidden `.git` paths rejected | covered | `packages/arch-sync/test/patch-validator.test.ts` | `rejects writes inside .git` |
| Forbidden `node_modules` (and backslash) paths rejected | covered | `packages/arch-sync/test/patch-validator.test.ts` | `rejects node_modules segments and backslashes` |
| Write matching a forbidden glob rejected even if allowlisted | covered | `packages/arch-sync/test/patch-validator.test.ts` | `rejects a write that matches a forbidden glob, even if allowlisted` |
| Write outside the allowlist rejected | covered | `packages/arch-sync/test/patch-validator.test.ts` | `rejects a write outside the allowlist` |
| `src/custom` human-owned file protected (drift detector ignores it) | covered | `packages/arch-verifier/test-drift/drift-detector.test.ts` | `ignores human-owned artifacts even if they exist with different bytes` |
| Human-owned file protected (non-stub write refused) | covered | `packages/arch-sync/test/patch-validator.test.ts` | `rejects a non-stub write to a human-owned file` |
| Human-owned file protected (`repair` never touches `src/custom`) | covered | `packages/arch-cli/test/repair.test.ts` | `never touches human-owned src/custom files` |
| Destructive changes blocked by default | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `rejects destructive plans by default` |
| Confirmation-required changes blocked by default | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `rejects confirmation-required plans by default` |
| Failed install → no metadata promotion | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `leaves baseline metadata untouched when install fails` |
| Failed verify → no metadata promotion | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `leaves baseline metadata untouched when verification fails and normalizes run id` |
| `--skip-verify` → no promotion | covered | `packages/arch-cli/test/apply-lifecycle.test.ts` | `does not promote snapshots or metadata when --skip-verify is used` |
| Generated file hash drift detected (`arch check`) | covered | `packages/arch-cli/test/check.test.ts` | `reports drift with artifact_id and entity_ids when a generated file is hand-edited` |
| Generated file hash drift detected (detector unit) | covered | `packages/arch-verifier/test-drift/drift-detector.test.ts` | `reports generated_file_modified when bytes diverge from content_hash` |
| Missing generated artifact detected | covered | `packages/arch-verifier/test-drift/drift-detector.test.ts` | `reports generated_file_missing for a deleted, non-test artifact` |
| Missing generated test detected | covered | `packages/arch-verifier/test-drift/drift-detector.test.ts` | `reports missing_generated_test for a deleted test artifact` |
| Static guarantee drift detected (`arch check`) | covered | `packages/arch-cli/test/check.test.ts` | `detects a guarantee_static_pattern violation when a workflow drops its try/catch` |
| Static guarantee drift detected (analyzer unit) | covered | `packages/arch-verifier/test-drift/guarantee-static.test.ts` | `flags an awaited post-persistence integration call not wrapped in try/catch` |
| Repair fixes an allowed (generated-file) drift | covered | `packages/arch-cli/test/repair.test.ts` | `restores a hand-edited generated file to its generated content` |
| Repair refuses human-owned files | covered | `packages/arch-cli/test/repair.test.ts` | `never touches human-owned src/custom files` |
| Repair stops after max attempts | covered | `packages/arch-cli/test/repair.test.ts` | `stops after max attempts and exits non-zero when verification keeps failing` |
| Invalid agent output rejected (out-of-allowlist patch) | covered | `packages/arch-agents/test/agent-protocol.test.ts` | `rejects a patch that writes outside the allowlist` |
| Invalid agent output rejected (escapes repo root) | covered | `packages/arch-agents/test/agent-protocol.test.ts` | `rejects a patch that escapes the repo root` |
| Invalid LLM output rejected (unparseable model output) | covered | `packages/arch-agents/test/http-llm-provider.test.ts` | `records a provider_error (not a crash) when the model returns unparseable output` |
| LLM provider cannot widen permissions | covered | `packages/arch-agents/test/http-llm-provider.test.ts` | `cannot widen its own permissions: an out-of-allowlist path is rejected by the orchestrator` |

### Supporting boundary tests worth knowing

These reinforce the same boundaries and are useful when you go probing:

- Plan-stage refusal to even write a plan when diagnostics block it, and refusal
  to overwrite an existing plan — `packages/arch-cli/test/plan.test.ts`:
  `does not write plan files when diffIRV1 reports blocking diagnostics` and
  `does not overwrite an existing latest plan when diagnostics block planning`.
- Incremental apply refuses to run without a committed plan —
  `packages/arch-cli/test/apply-lifecycle.test.ts`:
  `rejects incremental apply without a latest plan and avoids full regeneration`.
- Drift detector and `arch check` fail closed when metadata is **missing**, not
  just corrupt — `drift-detector.test.ts`: `fails closed when artifact-map.json
  is absent` / `fails closed when ownership.json is absent`; `check.test.ts`:
  `exits 2 when required metadata is missing`.
- The patch applier validates the **whole plan before writing any file**, so one
  bad action aborts the batch — `patch-validator.test.ts`:
  `validates the whole plan before writing any file`.
- An agent's self-reported `satisfied_criteria` is never trusted; Arch
  re-checks acceptance criteria against the actual patch bytes —
  `agent-protocol.test.ts`: `fails the task when a content acceptance criterion
  is not met`, plus `independently verifies a string_present acceptance
  criterion against patch content`.
- The agent orchestrator caps retries on a hostile provider —
  `agent-protocol.test.ts`: `stops after max_attempts when the provider keeps
  producing invalid output`.
- The HTTP/LLM provider is **disabled by default** (no API key, no transport) —
  `http-llm-provider.test.ts`: `is disabled by default: run() refuses without an
  API key and no injected transport`, and the metadata-trail tests in
  `run-metadata.test.ts` (e.g. `preserves metadata and structured validation on
  the error record when output is rejected`) prove a rejected output still
  yields an auditable record instead of a crash.

## How to run

All commands are run from the repo root. The unit suites are the fast feedback
loop; the integration and Postgres suites are **gated behind env vars** so they
never slow down the default run.

### Unit tests (fast, default)

Runs every package's `vitest run` — this is the whole coverage table above
**except** the two gated integration files.

```bash
pnpm test
```

To stress one boundary at a time, target a single package:

```bash
pnpm --filter @arch/cli test          # apply lifecycle, check, repair, plan
pnpm --filter @arch/sync test         # path policy + ownership (patch validator)
pnpm --filter @arch/verifier test     # drift detection + static guarantees
pnpm --filter @arch/agents test       # agent protocol + LLM containment
```

### Gated: full apply + verify integration (slow, network)

Generates the SocialFeed v1 example, runs a real `pnpm install`, then real
`typecheck` + `tests` inside the generated project. Proves the end-to-end
spec-to-running-code path. Expect roughly 60–120 s.

```bash
ARCH_RUN_INTEGRATION=1 pnpm --filter @arch/cli test -- src/__tests__/apply-verify.test.ts
```

This drives the `it()` named
`init → parse → apply with verify exits 0 and reports typecheck=pass + tests=pass`.
Without `ARCH_RUN_INTEGRATION=1` the test is skipped via `it.skipIf`.

### Gated: real Prisma/Postgres persistence (slow, needs a database)

Proves the generated backend persists and reads through the **real**
Prisma/Postgres adapter (not the in-memory default). Needs **both**
`ARCH_RUN_POSTGRES=1` and a reachable `DATABASE_URL`.

```bash
# Spin up a throwaway Postgres first:
docker run --rm -d --name arch-pg \
  -e POSTGRES_PASSWORD=arch -e POSTGRES_USER=arch -e POSTGRES_DB=arch_app \
  -p 5432:5432 postgres:16-alpine

ARCH_RUN_POSTGRES=1 DATABASE_URL=postgres://arch:arch@localhost:5432/arch_app \
  pnpm --filter @arch/cli test -- src/__tests__/prisma-postgres.test.ts
```

This drives the `it()` named
`createUser → createPost → findPostById round-trips through a real Postgres`.
Without both env vars it is skipped.

### End-to-end transcript

Runs the scripted user transcript end to end:

```bash
pnpm e2e
```

## Try to break it yourself

The fastest way to trust a boundary is to attack it by hand and watch Arch
refuse. Each experiment below maps to a row in the coverage table — if Arch
*doesn't* stop you, you've found a real bug, so file it.

1. **Hand-edit a generated file, then run `arch check`.**
   Apply the SocialFeed example, then append a line to a generated file such as
   `src/models/Post.ts` and run `arch check`. It should exit non-zero and write
   `.arch/drift.json` with a `generated_file_modified` entry carrying the
   `artifact_id` and the source `entity_ids`. (Boundary: generated-file hash
   drift.) Now run `arch repair` and watch it restore the file byte-for-byte —
   *but* hand-edit `src/custom/README.md` first and confirm repair leaves your
   human file untouched.

2. **Delete a generated artifact or test.**
   Remove a generated route file or a file under `tests/` and run `arch check`.
   Expect `generated_file_missing` (non-test) or `missing_generated_test`
   (under `tests/`). Then corrupt `.arch/artifact-map.json` to `{not-json` and
   re-run — `arch check` must fail closed (exit 2), never silently pass.

3. **Point a plan at the wrong base.**
   After `arch plan`, open `.arch/plans/latest.plan.json` and change
   `base_ir_hash` (or `target_ir_hash`, or any field inside `actions`) to a
   bogus value. Run `arch apply`. It must refuse with a `base_ir_hash` /
   `target_ir_hash` / `plan_hash` mismatch and run **no** install. Changing a
   field without refreshing the hash exercises the `plan_hash` guard; refreshing
   only `base_ir_hash` exercises the base-mismatch guard.

4. **Craft an agent output that writes outside the allowlist.**
   Using the `@arch/agents` API, feed `AgentOrchestrator` a provider whose
   patch targets `../../etc/passwd`, `node_modules/evil.ts`, or
   `src/custom/handler.ts`. The orchestrator must reject it with an
   `AgentTaskError` (escapes repo root / forbidden glob / not in allowlist) and
   record an auditable `validation_failed` outcome — it must **never** write the
   file. Try also returning valid JSON whose `satisfied_criteria` *claims* an
   acceptance criterion that the patch bytes don't actually meet; Arch must
   re-check and fail the task rather than trust the claim.

5. **Try to enable the LLM provider implicitly.**
   Construct an `HttpLlmProvider` with no API key and no transport. It should
   report `enabled === false` and `run()` should refuse. The LLM path is
   opt-in; nothing should reach a network model unless `ARCH_LLM_API_KEY` is
   set.

If you discover a boundary that *isn't* in the coverage table, the right fix is
a new failing test in the relevant package first, then the code change — never
the other way around.
