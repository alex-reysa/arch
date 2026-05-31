/**
 * Real end-to-end external-validation smoke: runs the committed external demo
 * dataset through the REAL Arch CLI (project → runSuite → classify), with no
 * mocks and no declared/expected outcomes — every outcome below is produced by
 * actually generating + applying the spec evolution and observing what Arch did.
 *
 * Gated by ARCH_BENCH_SMOKE=1 because each run does real `pnpm install`s in temp
 * workspaces. The demo dataset is synthetic (excluded from claims), but the run
 * and the outcomes are real.
 *
 *   ARCH_BENCH_SMOKE=1 pnpm --filter @arch/bench test external-run-smoke
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { loadExternalManifest } from "../src/external/load.js";
import { projectExternalToBenchManifest } from "../src/external/project.js";
import { runSuite } from "../src/runner/orchestrator.js";
import type { LoadedManifest } from "../src/manifest/load.js";
import { externalResultRows, collectFailureAnalyses } from "../src/external/report.js";
import { computeExternalMetrics } from "../src/external/metrics.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const RUN = process.env["ARCH_BENCH_SMOKE"] === "1";
const maybe = RUN ? it : it.skip;

describe("external demo run against the real Arch CLI (smoke)", () => {
  maybe(
    "produces real passed/blocked outcomes and classifies them",
    async () => {
      const externalManifest = resolve(REPO_ROOT, "benchmarks", "external", "manifest.json");
      const loaded = await loadExternalManifest(externalManifest);

      // Project the external dataset onto the bench shape and run it for real.
      const projected = projectExternalToBenchManifest(loaded.manifest, { baselines: ["arch-typed-sync"] });
      const benchLoaded: LoadedManifest = { manifest: projected, dir: loaded.dir, path: loaded.path };

      const results = await runSuite({
        loaded: benchLoaded,
        repoRoot: REPO_ROOT,
        baselines: ["arch-typed-sync"],
        repeats: 1,
      });

      // Classify the REAL run records (no declared outcomes).
      const rows = externalResultRows(results, loaded.manifest);
      const byId = new Map(rows.map((r) => [r.evolutionId, r]));

      // Additive/enum evolutions really applied + verified.
      expect(byId.get("demo-social-e01")?.outcome, "enum add applies").toBe("passed");
      expect(byId.get("demo-social-e02")?.outcome, "additive field applies").toBe("passed");
      // Destructive removal is correctly refused (a supported, explicit block).
      expect(byId.get("demo-social-e03")?.outcome, "destructive removal blocks").toBe(
        "blocked_supported_reason",
      );
      // The rename degrades to drop+add (destructive) → blocked; annotated as a
      // capability gap, so it classifies as an unsupported capability.
      expect(byId.get("demo-social-e04")?.outcome, "rename blocks as a capability gap").toBe(
        "blocked_unsupported_capability",
      );

      const metrics = computeExternalMetrics(rows);
      expect(metrics.total).toBe(4);
      expect(metrics.outcomeCounts.passed).toBe(2);
      expect(metrics.outcomeCounts.blocked_unsupported_capability).toBe(1);
      expect(metrics.unsupportedRateByKind.find((b) => b.unsupported > 0)).toBeDefined();

      // The unsupported case produces a structured failure-analysis record.
      const failures = collectFailureAnalyses(rows, loaded.manifest);
      const e04 = failures.find((f) => f.task === "demo-social-e04");
      expect(e04, "rename failure analysis").toBeDefined();
      expect(e04!.outcome).toBe("blocked_unsupported_capability");
      expect(e04!.unsupportedDiff).toBe("field_rename");
      expect(e04!.shouldArchSupportThis).toBe(true);
    },
    600_000,
  );
});
