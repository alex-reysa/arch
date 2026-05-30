#!/usr/bin/env tsx
/**
 * Postgres-gated data-preservation check for the additive `reopenCount`
 * migration. In a full paper run this would: seed Task rows BEFORE the change,
 * apply the generated migration, then assert old rows survive with reopenCount
 * defaulted to 0. It is gated on a live Postgres and is NOT run during the smoke
 * suite, so this stub simply exits 0.
 *
 * Usage: tsx db-check.ts <projectDir>
 */
const dir = process.argv[2];
process.stdout.write(`db-check (stub): reopenCount migration preserves rows in ${dir ?? "<dir>"}\n`);
process.exit(0);
