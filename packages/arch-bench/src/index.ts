/**
 * `@arch/bench` — the Arch intent-to-code synchronization benchmark.
 *
 * Public surface: the manifest schema + validator/loader, the typed result
 * model, the metric collectors, the report generators, the baseline registry,
 * and the suite orchestrator.
 */

export * from "./manifest/schema.js";
export { validateManifest, type ManifestValidation } from "./manifest/validate.js";
export {
  loadManifest,
  readSpecSource,
  resolvePath,
  tasksForSubject,
  buildTaskIndex,
  ManifestError,
  type LoadedManifest,
} from "./manifest/load.js";

export {
  diffSnapshots,
  collectChurn,
  snapshotOf,
  lineDiff,
  defaultIgnore,
  type FileSnapshot,
  type FileChange,
  type ChurnMetrics,
} from "./metrics/churn.js";
export { benchChurnIgnore } from "./runner/ignore.js";

export {
  BENCH_RESULTS_SCHEMA_VERSION,
  buildRunResults,
  type BenchResult,
  type RunResults,
  type RunMeta,
  type DriftRecall,
} from "./report/results.js";
export { toCsv } from "./report/csv.js";
export { toSummaryMarkdown, type TaskIndex, type TaskIndexEntry } from "./report/summary.js";
export { writeRunArtifacts, type WrittenArtifacts } from "./report/write.js";

export { compileSpec, type CompileResult } from "./runner/compile.js";
export { scorePassed, type TaskSignals } from "./runner/score.js";
export { runSuite, type SuiteOptions } from "./runner/orchestrator.js";

export { getBaseline, BASELINES } from "./baselines/registry.js";
export type { Baseline, EvolveContext, EvolveOutcome } from "./baselines/types.js";

export {
  runClaude,
  buildBenchClaudeArgs,
  spawnClaudeTransport,
  type ClaudeTransport,
  type ClaudeBenchRequest,
  type ClaudeBenchOutcome,
  type ClaudeProcessResult,
} from "./llm/claude-runner.js";
