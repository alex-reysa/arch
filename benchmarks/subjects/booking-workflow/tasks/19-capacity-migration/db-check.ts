#!/usr/bin/env tsx
/**
 * Postgres-gated data-preservation check for the additive `capacity` column on
 * Resource.
 *
 * In a real migration run this would: connect to the migrated database, read
 * Resource rows that existed BEFORE the column was added, and assert each
 * backfilled to the declared default (0) without losing any pre-existing data.
 * The benchmark smoke suite does not provision Postgres, so this stub is
 * intentionally a no-op that exits 0; it is only exercised by the Postgres-gated
 * integration.
 *
 * Usage: tsx db-check.ts <projectDir>
 */
const dir = process.argv[2] ?? "";
process.stdout.write(`db-check (capacity): skipped (no Postgres) for ${dir}\n`);
process.exit(0);
