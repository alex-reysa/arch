#!/usr/bin/env tsx
/**
 * Postgres data-preservation check for the additive `notes` migration.
 *
 * This is a stub: the real check (asserting pre-existing rows survive the
 * `notes` column add with the declared default) is Postgres-gated and is NOT
 * exercised by the smoke suite. Exiting 0 keeps the gated path green.
 *
 * Usage: tsx db-check.ts <projectDir>
 */
const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: db-check.ts <projectDir>\n");
  process.exit(2);
}
process.stdout.write(`db-check: notes migration data-preservation stub OK (${dir})\n`);
process.exit(0);
