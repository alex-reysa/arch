import { describe, expect, it } from "vitest";
import { buildRunResults, type BenchResult } from "../src/report/results.js";
import { toCsv } from "../src/report/csv.js";
import { toSummaryMarkdown, type TaskIndexEntry } from "../src/report/summary.js";
import {
  classifyBenchResult,
  collectFailureAnalyses,
  externalResultRows,
  externalResultRowsFromExpectations,
  toExternalSummaryMarkdown,
} from "../src/external/report.js";
import { computeExternalMetrics } from "../src/external/metrics.js";
import type { ExternalManifest } from "../src/external/schema.js";

const META = {
  runId: "run-x",
  createdAt: "2026-05-31T00:00:00.000Z",
  suite: "external",
  manifestVersion: "arch.bench.external.v1",
};

const INDEX: Record<string, TaskIndexEntry> = {};

function result(over: Partial<BenchResult> = {}): BenchResult {
  return {
    taskId: "svc-a-01",
    baseline: "arch-typed-sync",
    repeat: 1,
    passed: true,
    blocked: false,
    durationMs: 1,
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

function manifest(): ExternalManifest {
  return {
    schema_version: "arch.bench.external.v1",
    datasetVersion: "fixture-1",
    fixture: true,
    services: [
      { id: "svc-a", title: "A", fixture: true, authorship: { author: "team-a", source: "f://a", domain: "crm", heldOut: false } },
    ],
    evolutions: [
      { id: "svc-a-01", service: "svc-a", order: 1, kind: "additive_field", intent: "i", fixture: true, externalOutcome: "passed" },
      {
        id: "svc-a-02",
        service: "svc-a",
        order: 2,
        kind: "migration_data_preservation",
        intent: "i",
        fixture: true,
        externalOutcome: "blocked_unsupported_capability",
        unsupportedReason: { code: "relation_cardinality_change", summary: "cardinality change unsupported" },
      },
    ],
  };
}

describe("CSV external columns", () => {
  it("includes the Phase 2 external columns and their values", () => {
    const run = buildRunResults(META, [
      result({
        externalOutcome: "blocked_unsupported_capability",
        unsupportedDiffType: "relation_cardinality_change",
        unsupportedReason: "cardinality change unsupported",
        failureClass: "unsupported",
        externalDatasetVersion: "fixture-1",
        externalDatasetHash: "abc123",
      }),
    ]);
    const csv = toCsv(run);
    const header = csv.split("\n")[0]!;
    const row = csv.split("\n")[1]!;
    for (const col of [
      "externalOutcome",
      "unsupportedDiffType",
      "unsupportedReason",
      "failureClass",
      "externalDatasetVersion",
      "externalDatasetHash",
    ]) {
      expect(header).toContain(col);
    }
    expect(row).toContain("blocked_unsupported_capability");
    expect(row).toContain("relation_cardinality_change");
    expect(row).toContain("fixture-1");
  });
});

describe("summary external section", () => {
  it("appends an External validation section when external records are present", () => {
    const run = buildRunResults(META, [
      result({ taskId: "svc-a-01", externalOutcome: "passed", taskKind: "additive_field", externalDatasetVersion: "fixture-1" }),
      result({
        taskId: "svc-a-02",
        passed: false,
        blocked: true,
        externalOutcome: "blocked_unsupported_capability",
        unsupportedDiffType: "relation_cardinality_change",
        unsupportedReason: "cardinality change unsupported",
        taskKind: "migration_data_preservation",
      }),
    ]);
    const md = toSummaryMarkdown(run, INDEX);
    expect(md).toContain("External validation");
    expect(md).toContain("blocked_unsupported_capability");
    expect(md).toContain("Unsupported rate by task kind");
    expect(md).toContain("fixture-1");
  });

  it("does NOT add an external section for internal-only runs", () => {
    const run = buildRunResults(META, [result({ taskKind: "additive_field" })]);
    const md = toSummaryMarkdown(run, INDEX);
    expect(md).not.toContain("External validation");
  });
});

describe("external report helpers", () => {
  it("classifies a blocked bench result as an unsupported capability when annotated", () => {
    const m = manifest();
    const evo = m.evolutions[1]!;
    const o = classifyBenchResult(result({ blocked: true, passed: false }), evo);
    expect(o).toBe("blocked_unsupported_capability");
  });

  it("builds rows from a real run joined to external metadata", () => {
    const m = manifest();
    const rows = externalResultRows(
      [result({ taskId: "svc-a-01" }), result({ taskId: "svc-a-02", blocked: true, passed: false })],
      m,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ author: "team-a", domain: "crm", outcome: "passed" });
    expect(rows[1]!.outcome).toBe("blocked_unsupported_capability");
  });

  it("builds rows from fixture expectations and preserves unsupported cases", () => {
    const rows = externalResultRowsFromExpectations(manifest());
    expect(rows.map((r) => r.outcome)).toEqual(["passed", "blocked_unsupported_capability"]);
    expect(rows[1]!.unsupportedDiffType).toBe("relation_cardinality_change");
  });

  it("collects failure analyses for non-passing rows only", () => {
    const m = manifest();
    const rows = externalResultRowsFromExpectations(m);
    const failures = collectFailureAnalyses(rows, m);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ task: "svc-a-02", outcome: "blocked_unsupported_capability" });
  });

  it("renders an external summary with a fixture banner", () => {
    const rows = externalResultRowsFromExpectations(manifest());
    const md = toExternalSummaryMarkdown(computeExternalMetrics(rows), { fixture: true, datasetVersion: "fixture-1" });
    expect(md).toContain("FIXTURE");
    expect(md).toContain("excluded from");
    expect(md).toContain("Unsupported rate by external author");
  });
});
