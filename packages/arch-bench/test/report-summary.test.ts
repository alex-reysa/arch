import { describe, it, expect } from "vitest";
import { buildRunResults, type BenchResult } from "../src/report/results.js";
import { toCsv } from "../src/report/csv.js";
import { toSummaryMarkdown, type TaskIndexEntry } from "../src/report/summary.js";

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    taskId: "social-feed-01",
    baseline: "arch-typed-sync",
    repeat: 1,
    passed: true,
    blocked: false,
    durationMs: 1000,
    filesTouched: 2,
    changedLoc: 10,
    expectedFilesTouched: 2,
    offScopeFilesTouched: 0,
    humanOwnedViolations: 0,
    generatedTestDeletedOrWeakened: false,
    verificationPassed: true,
    oraclePassed: true,
    driftRecall: "not_applicable",
    ...over,
  };
}

const TASK_INDEX: Record<string, TaskIndexEntry> = {
  "social-feed-01": { subject: "social-feed", kind: "additive_field" },
  "social-feed-02": { subject: "social-feed", kind: "enum_change" },
};

const META = {
  runId: "run-fixed-1",
  createdAt: "2026-05-30T00:00:00.000Z",
  suite: "smoke",
  manifestVersion: "arch.bench.manifest.v1",
};

describe("toCsv", () => {
  it("emits one header row and one row per result with stable columns", () => {
    const run = buildRunResults(META, [
      result(),
      result({ baseline: "full-regeneration", filesTouched: 30, changedLoc: 600, offScopeFilesTouched: 28 }),
    ]);
    const csv = toCsv(run);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).toContain("taskId");
    expect(lines[0]).toContain("baseline");
    expect(lines[0]).toContain("offScopeFilesTouched");
    expect(lines[1]).toContain("social-feed-01");
    expect(lines[1]).toContain("arch-typed-sync");
    expect(lines[2]).toContain("full-regeneration");
    expect(lines[2]).toContain("600");
  });

  it("is deterministic for the same input", () => {
    const run = buildRunResults(META, [result(), result({ baseline: "full-regeneration" })]);
    expect(toCsv(run)).toBe(toCsv(run));
  });

  it("quotes fields containing commas", () => {
    const run = buildRunResults(META, [result({ note: "blocked, as expected" })]);
    const csv = toCsv(run);
    expect(csv).toContain('"blocked, as expected"');
  });

  it("emits live provider model and billing metadata", () => {
    const run = buildRunResults(META, [
      result({
        baseline: "grok-direct-edit",
        llm: { provider: "grok-build", model: "grok-build", billingMode: "subscription" },
      }),
    ]);
    const csv = toCsv(run);
    const header = csv.split("\n")[0]!;
    const row = csv.split("\n")[1]!;
    expect(header).toContain("provider");
    expect(header).toContain("model");
    expect(header).toContain("billingMode");
    expect(row).toContain("grok-build");
    expect(row).toContain("subscription");
  });
});

describe("toSummaryMarkdown", () => {
  it("produces a by-baseline table with pass rates and mean churn", () => {
    const run = buildRunResults(META, [
      result({ baseline: "arch-typed-sync", filesTouched: 2, offScopeFilesTouched: 0, passed: true }),
      result({
        taskId: "social-feed-02",
        baseline: "arch-typed-sync",
        filesTouched: 4,
        offScopeFilesTouched: 0,
        passed: true,
      }),
      result({ baseline: "full-regeneration", filesTouched: 30, offScopeFilesTouched: 28, passed: true }),
      result({
        taskId: "social-feed-02",
        baseline: "full-regeneration",
        filesTouched: 32,
        offScopeFilesTouched: 30,
        passed: false,
      }),
    ]);
    const md = toSummaryMarkdown(run, TASK_INDEX);
    expect(md).toContain("arch-typed-sync");
    expect(md).toContain("full-regeneration");
    // arch-typed-sync: 2/2 passed = 100%
    expect(md).toMatch(/arch-typed-sync.*100/);
    // full-regeneration: 1/2 passed = 50%
    expect(md).toMatch(/full-regeneration.*50/);
    // mean off-scope for arch-typed-sync is 0, for full-regeneration is 29
    expect(md).toContain("By baseline");
    expect(md).toContain("By task kind");
    expect(md).toContain("By subject");
  });

  it("is deterministic for the same input", () => {
    const run = buildRunResults(META, [result(), result({ taskId: "social-feed-02" })]);
    expect(toSummaryMarkdown(run, TASK_INDEX)).toBe(toSummaryMarkdown(run, TASK_INDEX));
  });

  it("reports live-repeat variance for live baselines", () => {
    const run = buildRunResults(META, [
      result({ baseline: "claude-direct-edit", repeat: 1, passed: true }),
      result({ baseline: "claude-direct-edit", repeat: 2, passed: false }),
      result({ baseline: "claude-direct-edit", repeat: 3, passed: true }),
    ]);
    const md = toSummaryMarkdown(run, TASK_INDEX);
    expect(md).toContain("Live-repeat variance");
    expect(md).toContain("claude-direct-edit");
  });

  it("includes live provider and model metadata in the baseline summary", () => {
    const run = buildRunResults(META, [
      result({
        baseline: "composer-direct-edit",
        llm: { provider: "cursor-composer", model: "composer-2.5", billingMode: "subscription" },
      }),
    ]);
    const md = toSummaryMarkdown(run, TASK_INDEX);
    expect(md).toContain("Providers");
    expect(md).toContain("cursor-composer");
    expect(md).toContain("composer-2.5");
    expect(md).toContain("subscription");
  });
});

describe("report dimensions: migration + guarantee + run mode", () => {
  it("CSV includes the migration / guarantee / run-mode columns", () => {
    const run = buildRunResults(META, [
      result({
        taskId: "social-feed-12",
        taskKind: "migration_data_preservation",
        migrationCheckStatus: "passed",
        migrationDataPreserved: true,
        taskMode: "isolated",
        failurePolicy: "restore-from-spec",
      }),
    ]);
    const csv = toCsv(run);
    const header = csv.split("\n")[0]!;
    const row1 = csv.split("\n")[1]!;
    for (const col of [
      "migrationCheckStatus",
      "guaranteeVerification",
      "taskKind",
      "taskMode",
      "failurePolicy",
    ]) {
      expect(header).toContain(col);
    }
    expect(row1).toContain("passed");
    expect(row1).toContain("isolated");
    expect(row1).toContain("restore-from-spec");
  });

  it("summary reports migration dbCheck status", () => {
    const run = buildRunResults(META, [
      result({
        taskId: "social-feed-12",
        taskKind: "migration_data_preservation",
        migrationCheckStatus: "skipped",
      }),
    ]);
    const md = toSummaryMarkdown(run, TASK_INDEX);
    expect(md).toContain("Migration dbCheck status");
    expect(md).toContain("skipped");
  });

  it("summary reports guarantee verification and flags declared-but-not-verified", () => {
    const run = buildRunResults(META, [
      result({
        taskId: "social-feed-08",
        taskKind: "guarantee_change",
        guaranteeVerification: "declared_but_not_behaviorally_verified",
        passed: true,
      }),
    ]);
    const md = toSummaryMarkdown(run, TASK_INDEX);
    expect(md).toContain("Guarantee verification");
    expect(md).toContain("declared_but_not_behaviorally_verified");
  });
});
