#!/usr/bin/env tsx
/**
 * Migration data-preservation check (real Postgres).
 *
 * Verifies the generated migration for this task is additive and preserves
 * existing rows. See benchmarks/_lib/db-check-lib.ts for the contract. Reports
 * `skipped` without DATABASE_URL/ARCH_BENCH_DATABASE_URL so smoke runs never
 * require a database.
 */
import { runMigrationDataCheck } from "../../../../_lib/db-check-lib.js";

runMigrationDataCheck().catch((err) => {
  process.stdout.write(
    `ARCH_DBCHECK_RESULT ${JSON.stringify({ status: "failed", reason: `db-check crashed: ${String(err)}` })}\n`,
  );
  process.exitCode = 1;
});
