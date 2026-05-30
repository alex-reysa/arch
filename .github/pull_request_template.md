<!-- Thanks for contributing to Arch! Please fill this in. -->

## What this changes

<!-- A short description of the change and the motivation. Link any issue. -->

## How it was tested (test-first)

<!-- Arch is test-first. Describe the failing test you wrote and how it proves
     the change. Paste the relevant test name(s). -->

- [ ] Added/updated a focused test (unit / integration / e2e) for this behavior
- [ ] Watched the new test fail for the intended reason before implementing
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm update-goldens` produces **no** changes (or the snapshot diff is
      explained below)
- [ ] `git diff --check` is clean

## Trust boundaries

- [ ] This change does **not** weaken ownership/allowlist checks, verification
      gating, or metadata-promotion rules (or the reasoning is explained below)
- [ ] Generated output remains deterministic (no timestamps/random/absolute paths)

## Limitations / follow-ups

<!-- Be honest: anything intentionally not done, deferred, or that needs a
     follow-up. Do not claim unsupported behavior as complete. -->
