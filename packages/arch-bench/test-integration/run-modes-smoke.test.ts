import { describe, expect, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest } from "../src/manifest/load.js";
import { runSuite } from "../src/runner/orchestrator.js";

const RUN = process.env["ARCH_BENCH_SMOKE"] === "1";
const maybe = RUN ? it : it.skip;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

describe("run-mode smoke (real CLI)", () => {
  maybe(
    "isolated mode bootstraps each task from its own fromSpec",
    async () => {
      const loaded = await loadManifest(resolve(REPO_ROOT, "benchmarks", "manifest.json"));
      const results = await runSuite({
        loaded,
        repoRoot: REPO_ROOT,
        baselines: ["arch-typed-sync"],
        repeats: 1,
        subjects: ["social-feed"],
        maxTasksPerSubject: 2,
        taskMode: "isolated",
      });
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.verificationPassed).toBe(true);
        expect(r.taskMode).toBe("isolated");
        expect(r.taskKind).toBeDefined();
      }
    },
    600_000,
  );
});
