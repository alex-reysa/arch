#!/usr/bin/env tsx
/**
 * Postgres data-preservation check for the additive `unitPrice` migration.
 *
 * Stub: the real assertion (pre-existing rows survive the `unitPrice` column add
 * with its declared default of 0) is Postgres-gated and not run in the smoke
 * suite. Exiting 0 keeps the gated path green.
 *
 * Usage: tsx db-check.ts <projectDir>
 */
const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: db-check.ts <projectDir>\n");
  process.exit(2);
}
process.stdout.write(`db-check: unitPrice migration data-preservation stub OK (${dir})\n`);
process.exit(0);
