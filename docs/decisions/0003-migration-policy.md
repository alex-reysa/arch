# 0003 — Migration policy

## Status

Accepted (V1 plan §3.5)

## Context

V1 generates Prisma schema and migration files from canonical IR. The plan is
explicit: silent destructive migrations are unacceptable, and partial
verification of migrations should still happen locally when Docker Compose is
available.

## Decision

- Generate Prisma schema deterministically from canonical IR.
- Generate migration files (or scaffolds) for **additive** intent changes
  (`model_added`, `model_field_added`, etc.).
- Validate migrations against an isolated test database when Docker Compose is
  available. This is the `prisma-validate` verification step plus, optionally,
  a `prisma migrate deploy` against a throwaway container.
- **Never** silently apply destructive migrations.
- Block destructive migrations unless the operator passes explicit
  confirmation **and** the plan includes a manual migration strategy
  (`destructive_changes` is non-empty in the sync plan).

## Consequences

- `arch-generator/src/prisma-migration-writer.ts` refuses to emit destructive
  migrations on its own; classification lives in `arch-sync` (`classify(change)`
  → `"destructive"`) and the planner records destructive changes in
  `SyncPlan.destructive_changes`.
- `arch apply` checks `destructive_changes` and fails closed unless an
  explicit confirmation flag was passed.
- The verifier runs `prisma validate` as a default step; full migrate-deploy
  in CI is a follow-up after the prototype path is proven.
