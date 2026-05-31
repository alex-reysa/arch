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
  type LlmMetadata,
  type LlmProvider,
  type BillingMode,
} from "./report/results.js";
export { toCsv } from "./report/csv.js";
export { toSummaryMarkdown, type TaskIndex, type TaskIndexEntry } from "./report/summary.js";
export { mergeRunResults, type MergeMeta } from "./report/merge.js";
export { writeRunArtifacts, type WrittenArtifacts } from "./report/write.js";

export { compileSpec, type CompileResult } from "./runner/compile.js";
export { scorePassed, type TaskSignals } from "./runner/score.js";
export { runSuite, type SuiteOptions } from "./runner/orchestrator.js";

export { getBaseline, BASELINES } from "./baselines/registry.js";
export type { Baseline, EvolveContext, EvolveOutcome } from "./baselines/types.js";

// Phase 2 external-validation plumbing (representation, lock, classify, report).
export {
  EXTERNAL_MANIFEST_SCHEMA_VERSION,
  EXTERNAL_OUTCOMES,
  UNSUPPORTED_DIFF_TYPES,
  isExternalOutcome,
  isUnsupportedDiffType,
  isPassOrExplicitBlock,
  isUnsupportedCapability,
  type ExternalManifest,
  type ExternalService,
  type ExternalEvolution,
  type ExternalAuthorship,
  type ExternalOutcome,
  type UnsupportedDiffType,
  type UnsupportedReason,
  type ExternalFailureAnalysis,
  type FailurePriority,
} from "./external/schema.js";
export { validateExternalManifest, type ExternalValidation } from "./external/validate.js";
export {
  loadExternalManifest,
  readDatasetContent,
  ExternalManifestError,
  type LoadedExternalManifest,
} from "./external/load.js";
export {
  computeDatasetHash,
  buildDatasetLock,
  diffDatasetLock,
  DATASET_LOCK_SCHEMA_VERSION,
  type DatasetContent,
  type DatasetHash,
  type DatasetLock,
  type DatasetLockDiff,
} from "./external/dataset-lock.js";
export {
  classifyExternalOutcome,
  buildFailureAnalysis,
  failureClassOf,
  DEFAULT_EXCESSIVE_CHURN_THRESHOLD,
  type ExternalSignals,
  type FailureAnalysisInput,
} from "./external/classify.js";
export {
  computeExternalMetrics,
  type ExternalMetrics,
  type ExternalResultRow,
  type RateBucket,
  type UnsupportedReasonCount,
} from "./external/metrics.js";
export {
  DIFF_CAPABILITY_MATRIX,
  MIGRATION_CAPABILITY_MATRIX,
  capabilityMatrixJson,
  renderCapabilityMatrixMarkdown,
  renderDiffCapabilityMatrixMarkdown,
  renderMigrationCapabilityMatrixMarkdown,
  type CapabilityEntry,
  type CapabilitySupport,
  type MigrationCapabilityEntry,
  type MigrationDataPreserving,
  type CapabilityMatrixJson,
} from "./external/capability.js";
export {
  projectExternalToBenchManifest,
  ExternalNotRunnableError,
  type ProjectOptions,
} from "./external/project.js";
export {
  externalResultRows,
  externalResultRowsFromExpectations,
  classifyBenchResult,
  collectFailureAnalyses,
  toExternalSummaryMarkdown,
  type ExternalSummaryOptions,
} from "./external/report.js";

export {
  runLiveAgent,
  buildLiveAgentInvocation,
  buildLiveAgentArgs,
  spawnLiveAgentTransport,
  type LiveAgentProvider,
  type LiveAgentTransport,
  type LiveAgentRequest,
  type LiveAgentOutcome,
  type LiveAgentProcessResult,
} from "./llm/agent-runner.js";

export {
  runClaude,
  buildBenchClaudeArgs,
  spawnClaudeTransport,
  type ClaudeTransport,
  type ClaudeBenchRequest,
  type ClaudeBenchOutcome,
  type ClaudeProcessResult,
} from "./llm/claude-runner.js";
