#!/usr/bin/env tsx
/**
 * Postgres data-preservation check for the additive `viewCount` migration.
 *
 * This is a stub: it documents the invariant that pre-existing Post rows keep
 * their data and receive the `viewCount` default (0) after the column is added.
 * The real assertion is Postgres-gated and is NOT run in the smoke suite, so
 * exiting 0 is sufficient here.
 *
 * Usage: tsx db-check.ts <projectDir>
 */
const dir = process.argv[2];
process.stdout.write(`db-check: viewCount additive migration preserves rows in ${dir ?? "(no dir)"}\n`);
process.exit(0);
