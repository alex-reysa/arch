import { describe, expect, it } from "vitest";
import { buildRunResults, type BenchResult } from "../src/report/results.js";
import { mergeRunResults } from "../src/report/merge.js";
import type { BenchManifest } from "../src/manifest/schema.js";

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

const meta = {
  runId: "run-a",
  createdAt: "2026-05-30T00:00:00.000Z",
  suite: "paper",
  manifestVersion: "arch.bench.manifest.v1",
};

describe("mergeRunResults", () => {
  it("concatenates compatible shards and sorts by task, baseline, repeat", () => {
    const a = buildRunResults(meta, [
      result({ taskId: "social-feed-02", baseline: "grok-direct-edit", repeat: 2 }),
    ]);
    const b = buildRunResults({ ...meta, runId: "run-b" }, [
      result({ taskId: "social-feed-01", baseline: "full-regeneration", repeat: 1 }),
      result({ taskId: "social-feed-01", baseline: "arch-typed-sync", repeat: 1 }),
    ]);

    const merged = mergeRunResults([a, b], manifest, {
      runId: "merged",
      createdAt: "2026-05-30T01:00:00.000Z",
    });

    expect(merged.runId).toBe("merged");
    expect(merged.results.map((r) => `${r.taskId}:${r.baseline}:r${r.repeat}`)).toEqual([
      "social-feed-01:arch-typed-sync:r1",
      "social-feed-01:full-regeneration:r1",
      "social-feed-02:grok-direct-edit:r2",
    ]);
  });

  it("rejects incompatible shards", () => {
    const a = buildRunResults(meta, [result()]);
    const b = buildRunResults({ ...meta, manifestVersion: "other" }, [result({ baseline: "full-regeneration" })]);
    expect(() => mergeRunResults([a, b], manifest, { runId: "merged", createdAt: meta.createdAt })).toThrow(
      /manifestVersion/,
    );
  });
});
