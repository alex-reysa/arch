#!/usr/bin/env tsx
/**
 * Postgres data-preservation check for the `reviewedAt` migration. This stub is
 * Postgres-gated: it is not run in the smoke suite. In a full run it would, after
 * the migration, assert that pre-existing Invoice rows are preserved and that the
 * new `reviewedAt` column is backfilled with a non-null timestamp default.
 *
 * Usage: tsx db-check.ts <projectDir>
 */
const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: db-check.ts <projectDir>\n");
  process.exit(2);
}
process.stdout.write(`db-check (reviewedAt): skipped outside Postgres gate for ${dir}\n`);
process.exit(0);
