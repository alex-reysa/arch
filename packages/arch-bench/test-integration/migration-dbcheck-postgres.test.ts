import { describe, expect, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest, tasksForSubject } from "../src/manifest/load.js";
import { runSuite } from "../src/runner/orchestrator.js";
import { resolveDatabaseUrl } from "../src/runner/db-check.js";

// Postgres-backed migration data-preservation integration test (roadmap Phase 1
// Test Plan: "A migration task seeds Postgres before evolution, applies
// generated migration SQL, runs db-check.ts, and records
// migrationDataPreserved: true").
//
// Double-gated: needs ARCH_BENCH_SMOKE=1 AND a Postgres URL
// (ARCH_BENCH_DATABASE_URL / DATABASE_URL). Without a DB it is skipped, so CI
// and laptop smoke runs never require Postgres. The check resets the target
// schema, so point the URL at a throwaway bench database.
//
//   docker run -d --name arch-bench-pg -e POSTGRES_USER=arch \
//     -e POSTGRES_PASSWORD=arch -e POSTGRES_DB=arch_bench -p 55432:5432 \
//     postgres:16-alpine
//   ARCH_BENCH_SMOKE=1 \
//   ARCH_BENCH_DATABASE_URL=postgres://arch:arch@localhost:55432/arch_bench \
//     pnpm --filter @arch/bench test -- migration-dbcheck-postgres

const SMOKE = process.env["ARCH_BENCH_SMOKE"] === "1";
const DB_URL = resolveDatabaseUrl(process.env);
const RUN = SMOKE && Boolean(DB_URL);
const maybe = RUN ? it : it.skip;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

describe("migration dbCheck against real Postgres", () => {
  maybe(
    "an additive migration task reports migrationCheckStatus=passed and migrationDataPreserved=true",
    async () => {
      const loaded = await loadManifest(resolve(REPO_ROOT, "benchmarks", "manifest.json"));

      // task-tracker's first migration_data_preservation task is at order 12;
      // run the chain up to it in isolated mode so its dbCheck executes.
      const migrationTask = tasksForSubject(loaded.manifest, "task-tracker").find(
        (t) => t.kind === "migration_data_preservation",
      );
      expect(migrationTask, "task-tracker has a migration_data_preservation task").toBeDefined();
      const upTo = migrationTask!.order;

      const results = await runSuite({
        loaded,
        repoRoot: REPO_ROOT,
        baselines: ["arch-typed-sync"],
        repeats: 1,
        subjects: ["task-tracker"],
        maxTasksPerSubject: upTo,
        taskMode: "isolated",
        failurePolicy: "restore-from-spec",
        validationMode: true,
        databaseUrl: DB_URL!,
      });

      const migrationResults = results.filter((r) => r.taskKind === "migration_data_preservation");
      expect(migrationResults.length).toBeGreaterThan(0);
      for (const r of migrationResults) {
        expect(r.migrationCheckStatus, `${r.taskId} dbCheck status`).toBe("passed");
        expect(r.migrationDataPreserved, `${r.taskId} dataPreserved`).toBe(true);
        // Under strict/validation scoring, a passing dbCheck is required to pass.
        expect(r.passed, `${r.taskId} passed`).toBe(true);
      }
    },
    600_000,
  );
});
