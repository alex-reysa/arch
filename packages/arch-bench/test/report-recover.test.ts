import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recoverRunResultsFromArtifacts } from "../src/report/recover.js";
import type { BenchManifest } from "../src/manifest/schema.js";
import type { BenchResult } from "../src/report/results.js";

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    taskId: "social-feed-01",
    baseline: "arch-typed-sync",
    repeat: 1,
    passed: true,
    blocked: false,
    durationMs: 10,
    filesTouched: 1,
    changedLoc: 1,
    expectedFilesTouched: 1,
    offScopeFilesTouched: 0,
    humanOwnedViolations: 0,
    generatedTestDeletedOrWeakened: false,
    verificationPassed: true,
    oraclePassed: true,
    driftRecall: "not_applicable",
    ...over,
  };
}

const manifest = {
  schema_version: "arch.bench.manifest.v1",
  baselines: ["arch-typed-sync", "full-regeneration", "grok-direct-edit"],
  subjects: [{ id: "social-feed", title: "Social Feed", baseSpec: "subjects/social-feed/v00/backend.arch" }],
  tasks: [
    {
      id: "social-feed-01",
      subject: "social-feed",
      order: 1,
      kind: "additive_field",
      fromSpec: "a",
      toSpec: "b",
      intent: "one",
      expectedDiffTypes: [],
      expectedAffectedPaths: [],
      expectedOutcome: "apply_passes",
      oracleTests: [],
      driftScripts: [],
    },
    {
      id: "social-feed-02",
      subject: "social-feed",
      order: 2,
      kind: "enum_change",
      fromSpec: "b",
      toSpec: "c",
      intent: "two",
      expectedDiffTypes: [],
      expectedAffectedPaths: [],
      expectedOutcome: "apply_passes",
      oracleTests: [],
      driftScripts: [],
    },
  ],
} satisfies BenchManifest;

async function writeArtifact(root: string, r: BenchResult, subject = "social-feed"): Promise<void> {
  const dir = join(root, "logs", subject, r.baseline, `r${r.repeat}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${r.taskId}.result.json`), JSON.stringify(r), "utf8");
}

describe("recoverRunResultsFromArtifacts", () => {
  it("recovers per-task result artifacts and sorts them stably", async () => {
    const root = await mkdtemp(join(tmpdir(), "arch-bench-recover-"));
    await writeArtifact(root, result({ taskId: "social-feed-02", baseline: "grok-direct-edit", repeat: 2 }));
    await writeArtifact(root, result({ taskId: "social-feed-01", baseline: "full-regeneration", repeat: 1 }));
    await writeArtifact(root, result({ taskId: "social-feed-01", baseline: "arch-typed-sync", repeat: 1 }));

    const run = await recoverRunResultsFromArtifacts(root, manifest, {
      runId: "recovered",
      createdAt: "2026-06-01T00:00:00.000Z",
      suite: "paper",
      manifestVersion: manifest.schema_version,
    });

    expect(run.results.map((r) => `${r.taskId}:${r.baseline}:r${r.repeat}`)).toEqual([
      "social-feed-01:arch-typed-sync:r1",
      "social-feed-01:full-regeneration:r1",
      "social-feed-02:grok-direct-edit:r2",
    ]);
  });

  it("rejects duplicate recovered result records", async () => {
    const root = await mkdtemp(join(tmpdir(), "arch-bench-recover-"));
    await writeArtifact(root, result({ baseline: "arch-typed-sync" }));
    await writeArtifact(root, result({ baseline: "arch-typed-sync" }), "duplicate");

    await expect(
      recoverRunResultsFromArtifacts(root, manifest, {
        runId: "recovered",
        createdAt: "2026-06-01T00:00:00.000Z",
        suite: "paper",
        manifestVersion: manifest.schema_version,
      }),
    ).rejects.toThrow(/duplicate result record/);
  });
});
