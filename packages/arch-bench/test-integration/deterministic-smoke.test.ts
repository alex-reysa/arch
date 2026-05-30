/**
 * Smoke integration: 2 subjects × 1 task × the two DETERMINISTIC baselines,
 * driving the real Arch CLI through real temp workspaces (install + verify).
 * Gated by ARCH_BENCH_SMOKE=1 because each run does several `pnpm install`s.
 *
 *   ARCH_BENCH_SMOKE=1 pnpm --filter @arch/bench test deterministic-smoke
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { loadManifest } from "../src/manifest/load.js";
import { runSuite } from "../src/runner/orchestrator.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RUN = process.env["ARCH_BENCH_SMOKE"] === "1";
const maybe = RUN ? it : it.skip;

describe("deterministic baselines (smoke)", () => {
  maybe(
    "arch-typed-sync and full-regeneration both apply, verify, and pass oracles",
    async () => {
      const loaded = await loadManifest(resolve(REPO_ROOT, "benchmarks", "manifest.json"));
      const results = await runSuite({
        loaded,
        repoRoot: REPO_ROOT,
        baselines: ["arch-typed-sync", "full-regeneration"],
        repeats: 1,
        subjects: ["social-feed", "task-tracker"],
        maxTasksPerSubject: 1,
      });

      // 2 subjects × 2 baselines × 1 task = 4 records.
      expect(results).toHaveLength(4);
      for (const r of results) {
        expect(r.passed, `${r.taskId}/${r.baseline}: ${r.note ?? ""}`).toBe(true);
        expect(r.verificationPassed).toBe(true);
        expect(r.oraclePassed).toBe(true);
        expect(r.blocked).toBe(false);
        expect(r.humanOwnedViolations).toBe(0);
        expect(r.generatedTestDeletedOrWeakened).toBe(false);
        expect(r.expectedFilesTouched).toBeGreaterThan(0);
      }

      // arch-typed-sync must produce a deterministic plan.
      for (const r of results.filter((x) => x.baseline === "arch-typed-sync")) {
        expect(r.planDeterministic).toBe(true);
      }
    },
    600_000,
  );
});
