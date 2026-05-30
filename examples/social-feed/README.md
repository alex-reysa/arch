# SocialFeed example

This example exercises the V1 prototype loop end-to-end from the repo-local
TypeScript CLI entrypoint. A packaged `arch` binary can use the same command
sequence once it is wired.

## Quickstart

```bash
pnpm install
pnpm e2e
```

`pnpm e2e` creates a clean temp project, copies `v1/backend.arch`, runs:

```bash
pnpm exec tsx packages/arch-cli/src/main.ts init --cwd "$tmpdir"
pnpm exec tsx packages/arch-cli/src/main.ts parse --emit-ir "$tmpdir/backend.arch"
pnpm exec tsx packages/arch-cli/src/main.ts plan --cwd "$tmpdir"
pnpm exec tsx packages/arch-cli/src/main.ts apply --cwd "$tmpdir"
(cd "$tmpdir" && pnpm typecheck && pnpm test)
cp examples/social-feed/v2-visibility/backend.arch "$tmpdir/backend.arch"
pnpm exec tsx packages/arch-cli/src/main.ts plan --cwd "$tmpdir"
pnpm exec tsx packages/arch-cli/src/main.ts apply --cwd "$tmpdir"
(cd "$tmpdir" && pnpm typecheck && pnpm test)
pnpm exec tsx packages/arch-cli/src/main.ts check --cwd "$tmpdir"
```

The first apply writes:

- `backend.arch` (the spec — never overwritten on re-run)
- `.arch/ir.current.json` (canonical IR with deterministic `canonical_hash`)
- `.arch/ir.previous.json` (promoted from current after verification passes)
- `.arch/artifact-map.json`, `.arch/ownership.json`
- A complete Fastify+Prisma backend project under the cwd.

If verification fails, `.arch/ir.previous.json` is **NOT** promoted and a
run record under `.arch/runs/<run-id>/{report.json,report.md}` captures the
failure for post-mortem.

Current verification is intentionally narrow: `arch apply` installs generated
project dependencies, then runs generated TypeScript typecheck and Vitest tests.
The e2e script repeats `pnpm typecheck` and `pnpm test` explicitly after each
apply. It does not start Docker, Postgres, or Redis, and it does not yet run a
Prisma migration lifecycle.

## v1 — initial generation

`v1/backend.arch` declares:

- `User` and `Post` models
- `FeedCache` (Redis) and `PushNotifier` (webhook) integrations
- A `sanitizeHtml` policy that strips `<script>` tags and `on*` handlers
- A `CreatePost` workflow with three guarantees:
  - `no_unsanitized_html_persisted` — html-safety
  - `notification_failure_does_not_rollback_post` — best-effort notifications
  - `post_creation_p95_latency <= 250` — latency scaffold

Running `arch parse --emit-ir` followed by `arch apply` generates the full
backend project (Prisma schema, Fastify routes, workflow implementations,
integration stubs, Vitest tests including one spec per guarantee) and
verifies it via generated `pnpm typecheck` + `pnpm test` inside the generated
dir.

## v2-visibility — incremental sync

`v2-visibility/backend.arch` adds a single indexed string field:
`Post.visibility` with default `"public"`.

Running `arch plan` against this spec produces a typed diff containing
`model_field_added(Post.visibility)`. Because the field is indexed, current
planner output can also include an index diff. The sync plan is expected to
touch only the generated artifacts that depend on `Post`.

This is the prototype's narrowest end-to-end demo: a meaningful intent change
flows through diff → plan → patch → verify without regenerating the codebase.
