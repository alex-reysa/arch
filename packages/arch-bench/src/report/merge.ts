/** Merge sharded benchmark result files into one stable run. */

import { BASELINE_IDS, type BaselineId, type BenchManifest } from "../manifest/schema.js";
import { BENCH_RESULTS_SCHEMA_VERSION, type BenchResult, type RunResults } from "./results.js";

export interface MergeMeta {
  readonly runId: string;
  readonly createdAt: string;
}

export function mergeRunResults(
  runs: readonly RunResults[],
  manifest: BenchManifest,
  meta: MergeMeta,
): RunResults {
  if (runs.length === 0) throw new Error("merge requires at least one run");
  const first = runs[0]!;
  for (const run of runs) {
    if (run.schema_version !== BENCH_RESULTS_SCHEMA_VERSION) {
      throw new Error(`schema_version mismatch: ${run.schema_version}`);
    }
    if (run.manifestVersion !== first.manifestVersion) {
      throw new Error(`manifestVersion mismatch: ${run.manifestVersion} !== ${first.manifestVersion}`);
    }
    if (run.suite !== first.suite) {
      throw new Error(`suite mismatch: ${run.suite} !== ${first.suite}`);
    }
  }

  const results = runs.flatMap((r) => r.results);
  assertNoDuplicateRecords(results);
  const sorted = [...results].sort((a, b) => compareResults(a, b, manifest));
  return {
    schema_version: BENCH_RESULTS_SCHEMA_VERSION,
    runId: meta.runId,
    createdAt: meta.createdAt,
    suite: first.suite,
    manifestVersion: first.manifestVersion,
    results: sorted,
  };
}

function assertNoDuplicateRecords(results: readonly BenchResult[]): void {
  const seen = new Set<string>();
  for (const r of results) {
    const key = `${r.taskId}\0${r.baseline}\0${r.repeat}`;
    if (seen.has(key)) throw new Error(`duplicate result record: ${r.taskId} ${r.baseline} repeat ${r.repeat}`);
    seen.add(key);
  }
}

function compareResults(a: BenchResult, b: BenchResult, manifest: BenchManifest): number {
  const taskCmp = taskRank(a.taskId, manifest) - taskRank(b.taskId, manifest);
  if (taskCmp !== 0) return taskCmp;
  const baselineCmp = baselineRank(a.baseline) - baselineRank(b.baseline);
  if (baselineCmp !== 0) return baselineCmp;
  return a.repeat - b.repeat;
}

function taskRank(taskId: string, manifest: BenchManifest): number {
  const idx = manifest.tasks.findIndex((t) => t.id === taskId);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function baselineRank(baseline: BaselineId): number {
  const idx = BASELINE_IDS.indexOf(baseline);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}
