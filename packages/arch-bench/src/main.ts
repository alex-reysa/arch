#!/usr/bin/env node
/**
 * `arch-bench` CLI.
 *
 *   arch-bench run --suite paper --out artifacts/bench/<run-id>
 *   arch-bench run --suite smoke --baselines arch-typed-sync,full-regeneration
 *   arch-bench summarize --input artifacts/bench/<run-id>/results.json
 *   arch-bench merge --inputs <paper-run-results-glob> --out artifacts/bench/paper-combined
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { BASELINE_IDS, isLiveBaseline, type BaselineId } from "./manifest/schema.js";
import { buildTaskIndex, loadManifest } from "./manifest/load.js";
import { validateManifest, validateManifestStrict } from "./manifest/validate.js";
import { parseFailurePolicy, parseTaskMode } from "./runner/run-modes.js";
import { resolveDatabaseUrl } from "./runner/db-check.js";
import type { FailurePolicy, TaskMode } from "./report/results.js";
import { runSuite } from "./runner/orchestrator.js";
import { buildRunResults, type RunResults } from "./report/results.js";
import { writeRunArtifacts } from "./report/write.js";
import { toSummaryMarkdown } from "./report/summary.js";
import { mergeRunResults } from "./report/merge.js";
import { spawnLiveAgentTransport, type LiveAgentProvider, type LiveAgentTransport } from "./llm/agent-runner.js";
import { preflightLiveProviders, type LiveCliConfig } from "./llm/preflight.js";
import { loadExternalManifest, readDatasetContent, type LoadedExternalManifest } from "./external/load.js";
import { buildDatasetLock, computeDatasetHash, diffDatasetLock, type DatasetLock } from "./external/dataset-lock.js";
import { projectExternalToBenchManifest, ExternalNotRunnableError } from "./external/project.js";
import {
  externalResultRows,
  externalResultRowsFromExpectations,
  classifyBenchResult,
  collectFailureAnalyses,
  toExternalSummaryMarkdown,
} from "./external/report.js";
import { computeExternalMetrics } from "./external/metrics.js";
import { failureClassOf } from "./external/classify.js";
import { capabilityMatrixJson, renderCapabilityMatrixMarkdown } from "./external/capability.js";
import type { ExternalEvolution, ExternalManifest } from "./external/schema.js";
import type { LoadedManifest } from "./manifest/load.js";
import type { BenchResult } from "./report/results.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "run") return runCommand(rest);
  if (command === "validate") return validateCommand(rest);
  if (command === "summarize") return summarizeCommand(rest);
  if (command === "merge") return mergeCommand(rest);
  if (command === "external") return externalCommand(rest);
  if (command === "capability-matrix") return capabilityMatrixCommand(rest);
  process.stderr.write(`arch-bench: unknown command '${command}'\n`);
  printHelp();
  return 64;
}

function printHelp(): void {
  process.stdout.write(
    [
      "arch-bench — Arch intent-to-code synchronization benchmark",
      "",
      "Usage:",
      "  arch-bench run --suite <paper|smoke> [options]",
      "  arch-bench validate [--strict] [--manifest <path>]",
      "  arch-bench summarize --input <results.json> [--manifest <path>]",
      "  arch-bench merge --inputs <results.json[,results.json]|glob> --out <dir> [--manifest <path>]",
      "  arch-bench external <validate|lock|run|analyze> [options]   (Phase 2 external validation)",
      "  arch-bench capability-matrix [--format md|json] [--out <file>]",
      "",
      "run options:",
      "  --suite <paper|smoke>     Preset (default: smoke)",
      "  --out <dir>               Output dir (default: artifacts/bench/<run-id>)",
      "  --manifest <path>         Manifest (default: benchmarks/manifest.json)",
      "  --baselines a,b,c         Override baselines",
      "  --subjects x,y            Restrict to subjects",
      "  --max-tasks <n>           Cap tasks per subject",
      "  --repeats <n>             Live-baseline repeats (default 3, env ARCH_BENCH_REPEATS)",
      "  --task-mode <sequential|isolated>          Run mode (default sequential)",
      "  --failure-policy <restore-from-spec|continue-contaminated>  (default continue-contaminated)",
      "  --strict                  Validation/paper scoring: migration tasks need a passing dbCheck",
      "  --keep                    Keep temp workspaces",
      "",
      "validate options:",
      "  --strict                  Require an oracle for every apply_passes task and a",
      "                            behavioral oracle/assertion for every guarantee_change task",
      "",
      "Live LLM baselines require ARCH_BENCH_LIVE=1 and authenticated provider CLIs.",
      "Models: ARCH_BENCH_CLAUDE_MODEL=sonnet, ARCH_BENCH_GROK_MODEL=grok-build,",
      "        ARCH_BENCH_COMPOSER_MODEL=composer-2.5. ARCH_BENCH_MODEL is a Claude fallback.",
      "",
    ].join("\n"),
  );
}

interface RunArgs {
  suite: "paper" | "smoke";
  out: string | undefined;
  manifest: string | undefined;
  baselines: BaselineId[] | undefined;
  subjects: string[] | undefined;
  maxTasks: number | undefined;
  repeats: number | undefined;
  keep: boolean;
  taskMode: TaskMode | undefined;
  failurePolicy: FailurePolicy | undefined;
  strict: boolean;
  parseErrors: string[];
}

function parseRunArgs(argv: readonly string[]): RunArgs {
  const args: RunArgs = {
    suite: "smoke",
    out: undefined,
    manifest: undefined,
    baselines: undefined,
    subjects: undefined,
    maxTasks: undefined,
    repeats: undefined,
    keep: false,
    taskMode: undefined,
    failurePolicy: undefined,
    strict: false,
    parseErrors: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--suite") args.suite = argv[++i] === "paper" ? "paper" : "smoke";
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--baselines") args.baselines = (argv[++i] ?? "").split(",").filter(Boolean) as BaselineId[];
    else if (a === "--subjects") args.subjects = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--max-tasks") args.maxTasks = Number(argv[++i]);
    else if (a === "--repeats") args.repeats = Number(argv[++i]);
    else if (a === "--task-mode") {
      const v = argv[++i];
      const mode = parseTaskMode(v);
      if (mode) args.taskMode = mode;
      else args.parseErrors.push(`invalid --task-mode: ${JSON.stringify(v)} (expected sequential|isolated)`);
    } else if (a === "--failure-policy") {
      const v = argv[++i];
      const policy = parseFailurePolicy(v);
      if (policy) args.failurePolicy = policy;
      else
        args.parseErrors.push(
          `invalid --failure-policy: ${JSON.stringify(v)} (expected restore-from-spec|continue-contaminated)`,
        );
    } else if (a === "--strict") args.strict = true;
    else if (a === "--keep") args.keep = true;
  }
  return args;
}

async function runCommand(argv: readonly string[]): Promise<number> {
  const args = parseRunArgs(argv);
  if (args.parseErrors.length > 0) {
    for (const e of args.parseErrors) process.stderr.write(`arch-bench: ${e}\n`);
    return 64;
  }
  const manifestPath = args.manifest ?? resolve(REPO_ROOT, "benchmarks", "manifest.json");

  let loaded;
  try {
    loaded = await loadManifest(manifestPath);
  } catch (err) {
    process.stderr.write(`arch-bench: ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }

  // Resolve baselines + per-suite defaults.
  const baselines = args.baselines ?? defaultBaselines(args.suite, loaded.manifest.baselines);
  const subjects = args.subjects ?? defaultSubjects(args.suite, loaded.manifest.subjects.map((s) => s.id));
  const maxTasksPerSubject = args.maxTasks ?? (args.suite === "smoke" ? 2 : undefined);
  const repeats = args.repeats ?? Number(process.env["ARCH_BENCH_REPEATS"] ?? "3");

  const live = process.env["ARCH_BENCH_LIVE"] === "1";
  const wantsLive = baselines.some(isLiveBaseline);
  const liveConfig = readLiveCliConfig();
  const liveProviders = providersForBaselines(baselines);

  if (args.suite === "paper" && wantsLive) {
    if (!live) {
      process.stderr.write("arch-bench: paper suite requires ARCH_BENCH_LIVE=1 for the live baselines\n");
      return 2;
    }
  }
  if (live && liveProviders.length > 0) {
    const preflight = preflightLiveProviders(liveProviders, liveConfig);
    if (!preflight.ok) {
      process.stderr.write(`arch-bench: ${preflight.errors.join("\narch-bench: ")}\n`);
      return 2;
    }
  }

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outDir = args.out ? resolve(args.out) : resolve(REPO_ROOT, "artifacts", "bench", runId);

  process.stdout.write(`arch-bench: suite=${args.suite} run=${runId}\n`);
  process.stdout.write(`  baselines: ${baselines.join(", ")}\n`);
  process.stdout.write(`  subjects:  ${subjects.join(", ")}\n`);
  process.stdout.write(`  live: ${live && wantsLive ? "yes" : "no"}  out: ${outDir}\n`);

  const liveTransports = live && wantsLive ? buildLiveTransports(liveProviders, liveConfig) : undefined;

  const databaseUrl = resolveDatabaseUrl(process.env);
  const validationMode = args.strict || args.suite === "paper";
  process.stdout.write(
    `  mode: task-mode=${args.taskMode ?? "sequential"} failure-policy=${args.failurePolicy ?? "continue-contaminated"} strict=${validationMode}\n`,
  );
  if (validationMode) {
    const strict = validateManifestStrict(loaded.manifest);
    if (!strict.ok) {
      process.stdout.write(
        `  WARNING: strict manifest validation found ${strict.errors.length} unproven task(s) ` +
          `(run 'arch-bench validate --strict' for the list); they remain unverified, not silently passed\n`,
      );
    }
  }

  const results = await runSuite({
    loaded,
    repoRoot: REPO_ROOT,
    baselines,
    repeats,
    subjects,
    ...(maxTasksPerSubject !== undefined ? { maxTasksPerSubject } : {}),
    ...(liveTransports ? { liveTransports } : {}),
    liveModels: liveConfig.models,
    artifactsDir: outDir,
    keepWorkspace: args.keep,
    ...(args.taskMode ? { taskMode: args.taskMode } : {}),
    ...(args.failurePolicy ? { failurePolicy: args.failurePolicy } : {}),
    ...(databaseUrl !== undefined ? { databaseUrl } : {}),
    validationMode,
    log: (m) => process.stdout.write(m + "\n"),
  });

  const run = buildRunResults(
    { runId, createdAt: new Date().toISOString(), suite: args.suite, manifestVersion: loaded.manifest.schema_version },
    results,
  );
  const taskIndex = buildTaskIndex(loaded.manifest);
  const written = await writeRunArtifacts(outDir, run, taskIndex);

  const passed = results.filter((r) => r.passed).length;
  process.stdout.write(`\narch-bench: ${passed}/${results.length} records passed\n`);
  process.stdout.write(`  results: ${written.resultsJson}\n  csv:     ${written.resultsCsv}\n  summary: ${written.summaryMd}\n`);
  return 0;
}

async function validateCommand(argv: readonly string[]): Promise<number> {
  let manifestPath: string | undefined;
  let strict = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--manifest") manifestPath = argv[++i];
    else if (a === "--strict") strict = true;
  }
  const mPath = manifestPath ?? resolve(REPO_ROOT, "benchmarks", "manifest.json");
  let loaded;
  try {
    loaded = await loadManifest(mPath);
  } catch (err) {
    process.stderr.write(`arch-bench validate: ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }
  const result = strict ? validateManifestStrict(loaded.manifest) : validateManifest(loaded.manifest);
  if (result.ok) {
    process.stdout.write(
      `arch-bench: manifest ${mPath} is valid (${strict ? "strict" : "structural"}; ${loaded.manifest.tasks.length} tasks)\n`,
    );
    return 0;
  }
  process.stderr.write(`arch-bench: manifest ${mPath} has ${result.errors.length} validation error(s):\n`);
  for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
  return 1;
}

async function summarizeCommand(argv: readonly string[]): Promise<number> {
  let input: string | undefined;
  let manifestPath: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--input") input = argv[++i];
    else if (a === "--manifest") manifestPath = argv[++i];
    else if (a === "--out") out = argv[++i];
  }
  if (!input) {
    process.stderr.write("arch-bench summarize: --input <results.json> is required\n");
    return 64;
  }
  const run = JSON.parse(await readFile(resolve(input), "utf8")) as RunResults;

  const mPath = manifestPath ?? resolve(REPO_ROOT, "benchmarks", "manifest.json");
  let taskIndex = {};
  if (existsSync(mPath)) {
    try {
      taskIndex = buildTaskIndex((await loadManifest(mPath)).manifest);
    } catch {
      /* fall back to empty index */
    }
  }

  const md = toSummaryMarkdown(run, taskIndex);
  if (out) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolve(out), md, "utf8");
    process.stdout.write(`arch-bench: wrote ${resolve(out)}\n`);
  } else {
    process.stdout.write(md + "\n");
  }
  return 0;
}

async function mergeCommand(argv: readonly string[]): Promise<number> {
  let inputsArg: string | undefined;
  let manifestPath: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--inputs") inputsArg = argv[++i];
    else if (a === "--manifest") manifestPath = argv[++i];
    else if (a === "--out") out = argv[++i];
  }
  if (!inputsArg) {
    process.stderr.write("arch-bench merge: --inputs <results.json[,results.json]|glob> is required\n");
    return 64;
  }
  if (!out) {
    process.stderr.write("arch-bench merge: --out <dir> is required\n");
    return 64;
  }

  const mPath = manifestPath ?? resolve(REPO_ROOT, "benchmarks", "manifest.json");
  let loaded;
  try {
    loaded = await loadManifest(mPath);
  } catch (err) {
    process.stderr.write(`arch-bench merge: ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }

  const inputs = await expandInputPatterns(inputsArg);
  if (inputs.length === 0) {
    process.stderr.write("arch-bench merge: no input files matched\n");
    return 66;
  }
  const runs = await Promise.all(inputs.map(async (p) => JSON.parse(await readFile(p, "utf8")) as RunResults));
  const runId = `merged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const merged = mergeRunResults(runs, loaded.manifest, { runId, createdAt: new Date().toISOString() });
  const written = await writeRunArtifacts(resolve(out), merged, buildTaskIndex(loaded.manifest));
  process.stdout.write(`arch-bench: merged ${inputs.length} runs (${merged.results.length} records)\n`);
  process.stdout.write(`  results: ${written.resultsJson}\n  csv:     ${written.resultsCsv}\n  summary: ${written.summaryMd}\n`);
  return 0;
}

// --------------------------------------------------------------------------
// Phase 2: external validation + capability matrix
// --------------------------------------------------------------------------

function defaultExternalManifest(): string {
  return resolve(REPO_ROOT, "benchmarks", "external", "manifest.json");
}

function parseManifestArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--manifest") return argv[i + 1];
  return undefined;
}

function printExternalHelp(): void {
  process.stdout.write(
    [
      "arch-bench external — Phase 2 external-validation plumbing",
      "",
      "  external validate [--manifest <ext-manifest>]",
      "      Structurally validate external metadata + check referenced specs exist.",
      "  external lock [--write|--check] [--manifest <ext>] [--lockfile <path>]",
      "      Freeze (--write) or verify (--check) the external dataset content hash.",
      "      --check fails if the dataset changed without a datasetVersion bump.",
      "  external run [--manifest <ext>] [--out <dir>] [--baselines a,b]",
      "      Project the external dataset onto the bench runner and run it. Errors",
      "      clearly when the dataset is representation-only (e.g. the fixture).",
      "  external analyze [--input <results.json>|--from-expectations] [--manifest <ext>] [--out <dir>]",
      "      Classify external outcomes, emit unsupported-rate metrics + per-failure",
      "      analysis JSON. --from-expectations classifies only DECLARED expected",
      "      outcomes (datasets that record them); use `external run` for observed ones.",
      "",
      "The committed benchmarks/external/ data is a FIXTURE — excluded from claims.",
      "",
    ].join("\n"),
  );
}

async function capabilityMatrixCommand(argv: readonly string[]): Promise<number> {
  let format: "md" | "json" = "md";
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--format") format = argv[++i] === "json" ? "json" : "md";
    else if (a === "--out") out = argv[++i];
  }
  const content =
    format === "json" ? JSON.stringify(capabilityMatrixJson(), null, 2) + "\n" : renderCapabilityMatrixMarkdown();
  if (out) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), content, "utf8");
    process.stdout.write(`arch-bench: wrote ${resolve(out)}\n`);
  } else {
    process.stdout.write(content.endsWith("\n") ? content : content + "\n");
  }
  return 0;
}

async function externalCommand(argv: readonly string[]): Promise<number> {
  const [action, ...rest] = argv;
  if (!action || action === "--help" || action === "-h") {
    printExternalHelp();
    return action ? 0 : 64;
  }
  if (action === "validate") return externalValidateCommand(rest);
  if (action === "lock") return externalLockCommand(rest);
  if (action === "run") return externalRunCommand(rest);
  if (action === "analyze") return externalAnalyzeCommand(rest);
  process.stderr.write(`arch-bench external: unknown action '${action}'\n`);
  printExternalHelp();
  return 64;
}

async function externalValidateCommand(argv: readonly string[]): Promise<number> {
  const manifestPath = parseManifestArg(argv) ?? defaultExternalManifest();
  try {
    const loaded = await loadExternalManifest(manifestPath);
    const m = loaded.manifest;
    process.stdout.write(
      `arch-bench: external manifest ${loaded.path} is valid ` +
        `(${m.services.length} service(s), ${m.evolutions.length} evolution(s)` +
        `${m.fixture ? "; FIXTURE/DEMO — excluded from claims" : ""})\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`arch-bench external validate: ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }
}

async function externalLockCommand(argv: readonly string[]): Promise<number> {
  let write = false;
  let manifestPath: string | undefined;
  let lockPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--write") write = true;
    else if (a === "--check") write = false;
    else if (a === "--manifest") manifestPath = argv[++i];
    else if (a === "--lockfile") lockPath = argv[++i];
  }
  const mPath = manifestPath ?? defaultExternalManifest();
  let loaded: LoadedExternalManifest;
  try {
    loaded = await loadExternalManifest(mPath);
  } catch (err) {
    process.stderr.write(`arch-bench external lock: ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }
  const lockFile = lockPath ?? resolve(dirname(loaded.path), "dataset.lock.json");
  const content = await readDatasetContent(loaded);
  const { readFile: rf, writeFile, mkdir } = await import("node:fs/promises");

  if (write) {
    const lock = buildDatasetLock(content, new Date().toISOString());
    await mkdir(dirname(lockFile), { recursive: true });
    await writeFile(lockFile, JSON.stringify(lock, null, 2) + "\n", "utf8");
    process.stdout.write(
      `arch-bench: wrote external dataset lock ${lockFile}\n  version=${lock.datasetVersion} hash=${lock.hash}\n`,
    );
    return 0;
  }

  if (!existsSync(lockFile)) {
    process.stderr.write(`arch-bench external lock: no lock at ${lockFile}; run 'external lock --write' first\n`);
    return 66;
  }
  const prev = JSON.parse(await rf(lockFile, "utf8")) as DatasetLock;
  const diff = diffDatasetLock(prev, content);
  if (!diff.changed) {
    process.stdout.write(
      `arch-bench: external dataset matches lock (version=${prev.datasetVersion} hash=${prev.hash})\n`,
    );
    return 0;
  }
  const lines: string[] = [];
  if (diff.modifiedFiles.length) lines.push(`modified: ${diff.modifiedFiles.join(", ")}`);
  if (diff.addedFiles.length) lines.push(`added: ${diff.addedFiles.join(", ")}`);
  if (diff.removedFiles.length) lines.push(`removed: ${diff.removedFiles.join(", ")}`);
  if (diff.unversionedChange) {
    process.stderr.write(
      `arch-bench external lock: dataset changed WITHOUT a datasetVersion bump ` +
        `(policy violation — post-import edits must be versioned and disclosed)\n  ${lines.join("\n  ")}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `arch-bench: external dataset changed and version bumped ${prev.datasetVersion} -> ${content.datasetVersion} (disclosed)\n` +
      `  ${lines.join("\n  ")}\n  run 'external lock --write' to refreeze\n`,
  );
  return 0;
}

function tagExternalResult(
  r: BenchResult,
  evo: ExternalEvolution | undefined,
  version: string,
  hash: string,
): BenchResult {
  if (!evo) return r;
  const outcome = classifyBenchResult(r, evo);
  const diffType =
    evo.unsupportedDiffType ?? evo.unsupportedReason?.code;
  return {
    ...r,
    externalOutcome: outcome,
    ...(diffType !== undefined ? { unsupportedDiffType: diffType } : {}),
    ...(evo.unsupportedReason?.summary !== undefined ? { unsupportedReason: evo.unsupportedReason.summary } : {}),
    failureClass: failureClassOf(outcome),
    externalDatasetVersion: version,
    externalDatasetHash: hash,
  };
}

async function externalRunCommand(argv: readonly string[]): Promise<number> {
  let manifestPath: string | undefined;
  let out: string | undefined;
  let baselines: BaselineId[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--manifest") manifestPath = argv[++i];
    else if (a === "--out") out = argv[++i];
    else if (a === "--baselines") baselines = (argv[++i] ?? "").split(",").filter(Boolean) as BaselineId[];
  }
  const mPath = manifestPath ?? defaultExternalManifest();
  let extLoaded: LoadedExternalManifest;
  try {
    extLoaded = await loadExternalManifest(mPath);
  } catch (err) {
    process.stderr.write(`arch-bench external run: ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }

  let projected;
  try {
    projected = projectExternalToBenchManifest(extLoaded.manifest, {
      ...(baselines ? { baselines } : {}),
    });
  } catch (err) {
    if (err instanceof ExternalNotRunnableError) {
      process.stderr.write(
        `arch-bench external run: ${err.message}\n` +
          `  The committed dataset is a representation-only FIXTURE. Provide an external\n` +
          `  manifest with runnable fromSpec/toSpec (and service baseSpec) to run.\n`,
      );
      return 3;
    }
    throw err;
  }

  const loaded: LoadedManifest = { manifest: projected, dir: extLoaded.dir, path: extLoaded.path };
  const databaseUrl = resolveDatabaseUrl(process.env);
  const runId = `external-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outDir = out ? resolve(out) : resolve(REPO_ROOT, "artifacts", "bench", runId);
  const content = await readDatasetContent(extLoaded);
  const { hash } = computeDatasetHash(content);
  const version = extLoaded.manifest.datasetVersion;

  process.stdout.write(`arch-bench: external run=${runId} dataset=${version} hash=${hash}\n`);
  if (extLoaded.manifest.fixture) {
    process.stdout.write("  NOTE: FIXTURE/DEMO dataset — results are excluded from all claims\n");
  }

  const raw = await runSuite({
    loaded,
    repoRoot: REPO_ROOT,
    baselines: projected.baselines,
    repeats: 1,
    artifactsDir: outDir,
    ...(databaseUrl !== undefined ? { databaseUrl } : {}),
    validationMode: true,
    log: (m) => process.stdout.write(m + "\n"),
  });

  const evoIndex = new Map<string, ExternalEvolution>();
  for (const e of extLoaded.manifest.evolutions) evoIndex.set(e.id, e);
  const results = raw.map((r) => tagExternalResult(r, evoIndex.get(r.taskId), version, hash));

  const run = buildRunResults(
    {
      runId,
      createdAt: new Date().toISOString(),
      suite: "external",
      manifestVersion: extLoaded.manifest.schema_version,
    },
    results,
  );
  await writeRunArtifacts(outDir, run, buildTaskIndex(projected));
  await writeExternalArtifacts(outDir, extLoaded.manifest, results, version, hash);
  // Freeze the external dataset lock alongside the run so the artifact dir is
  // self-describing (records exactly which dataset version/hash was run).
  {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      resolve(outDir, "dataset.lock.json"),
      JSON.stringify(buildDatasetLock(content, new Date().toISOString()), null, 2) + "\n",
      "utf8",
    );
  }

  const passed = results.filter((r) => r.passed).length;
  process.stdout.write(`\narch-bench: external ${passed}/${results.length} records passed (out: ${outDir})\n`);
  return 0;
}

async function externalAnalyzeCommand(argv: readonly string[]): Promise<number> {
  let input: string | undefined;
  let manifestPath: string | undefined;
  let out: string | undefined;
  let fromExpectations = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--input") input = argv[++i];
    else if (a === "--manifest") manifestPath = argv[++i];
    else if (a === "--out") out = argv[++i];
    else if (a === "--from-expectations") fromExpectations = true;
  }
  const mPath = manifestPath ?? defaultExternalManifest();
  let extLoaded: LoadedExternalManifest;
  try {
    extLoaded = await loadExternalManifest(mPath);
  } catch (err) {
    process.stderr.write(`arch-bench external analyze: ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }

  const content = await readDatasetContent(extLoaded);
  const { hash } = computeDatasetHash(content);
  const version = extLoaded.manifest.datasetVersion;

  let rows;
  if (fromExpectations || !input) {
    if (!fromExpectations) {
      process.stderr.write(
        "arch-bench external analyze: provide --input <results.json> or --from-expectations\n",
      );
      return 64;
    }
    rows = externalResultRowsFromExpectations(extLoaded.manifest);
  } else {
    const run = JSON.parse(await readFile(resolve(input), "utf8")) as RunResults;
    rows = externalResultRows(run.results, extLoaded.manifest);
  }

  if (fromExpectations && rows.length === 0) {
    process.stdout.write(
      "arch-bench: this manifest declares no expected outcomes; nothing to analyze from " +
        "expectations. Use `external run` to observe real outcomes through the Arch CLI.\n",
    );
    return 0;
  }

  const metrics = computeExternalMetrics(rows);
  const failures = collectFailureAnalyses(rows, extLoaded.manifest);
  const summary = toExternalSummaryMarkdown(metrics, {
    fixture: extLoaded.manifest.fixture,
    datasetVersion: version,
    datasetHash: hash,
  });

  if (out) {
    const outDir = resolve(out);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(resolve(outDir, "failures"), { recursive: true });
    await writeFile(resolve(outDir, "external-metrics.json"), JSON.stringify(metrics, null, 2) + "\n", "utf8");
    await writeFile(resolve(outDir, "external-summary.md"), summary, "utf8");
    for (const f of failures) {
      await writeFile(resolve(outDir, "failures", `${f.task}.failure.json`), JSON.stringify(f, null, 2) + "\n", "utf8");
    }
    process.stdout.write(
      `arch-bench: wrote external analysis to ${outDir} (${failures.length} failure record(s))\n`,
    );
  } else {
    process.stdout.write(summary + "\n");
    process.stdout.write(`\n${failures.length} failure record(s).\n`);
  }
  return 0;
}

/** Write Phase 2 external artifacts alongside the standard run artifacts. */
async function writeExternalArtifacts(
  outDir: string,
  manifest: ExternalManifest,
  results: readonly BenchResult[],
  version: string,
  hash: string,
): Promise<void> {
  const rows = externalResultRows(results, manifest);
  const metrics = computeExternalMetrics(rows);
  const failures = collectFailureAnalyses(rows, manifest);
  const summary = toExternalSummaryMarkdown(metrics, {
    fixture: manifest.fixture,
    datasetVersion: version,
    datasetHash: hash,
  });
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(resolve(outDir, "failures"), { recursive: true });
  await writeFile(resolve(outDir, "external-metrics.json"), JSON.stringify(metrics, null, 2) + "\n", "utf8");
  await writeFile(resolve(outDir, "external-summary.md"), summary, "utf8");
  for (const f of failures) {
    await writeFile(resolve(outDir, "failures", `${f.task}.failure.json`), JSON.stringify(f, null, 2) + "\n", "utf8");
  }
}

function defaultBaselines(suite: "paper" | "smoke", manifestBaselines: readonly BaselineId[]): BaselineId[] {
  if (suite === "smoke") return ["arch-typed-sync", "full-regeneration"];
  return manifestBaselines.length > 0 ? [...manifestBaselines] : [...BASELINE_IDS];
}

function defaultSubjects(suite: "paper" | "smoke", all: readonly string[]): string[] {
  if (suite === "smoke") return all.slice(0, 2);
  return [...all];
}

function readLiveCliConfig(): LiveCliConfig {
  return {
    bins: {
      "claude-code": process.env["ARCH_BENCH_CLAUDE_BIN"] ?? "claude",
      "grok-build": process.env["ARCH_BENCH_GROK_BIN"] ?? "grok",
      "cursor-composer": process.env["ARCH_BENCH_COMPOSER_BIN"] ?? "cursor-agent",
    },
    models: {
      "claude-code": process.env["ARCH_BENCH_CLAUDE_MODEL"] ?? process.env["ARCH_BENCH_MODEL"] ?? "sonnet",
      "grok-build": process.env["ARCH_BENCH_GROK_MODEL"] ?? "grok-build",
      "cursor-composer": process.env["ARCH_BENCH_COMPOSER_MODEL"] ?? "composer-2.5",
    },
  };
}

function buildLiveTransports(
  providers: readonly LiveAgentProvider[],
  config: LiveCliConfig,
): Partial<Record<LiveAgentProvider, LiveAgentTransport>> {
  const transports: Partial<Record<LiveAgentProvider, LiveAgentTransport>> = {};
  for (const provider of providers) transports[provider] = spawnLiveAgentTransport(config.bins[provider]);
  return transports;
}

function providersForBaselines(baselines: readonly BaselineId[]): LiveAgentProvider[] {
  const providers = new Set<LiveAgentProvider>();
  for (const baseline of baselines) {
    const provider = providerForBaseline(baseline);
    if (provider) providers.add(provider);
  }
  return [...providers];
}

function providerForBaseline(baseline: BaselineId): LiveAgentProvider | undefined {
  if (baseline === "claude-direct-edit" || baseline === "claude-broad-constrained") return "claude-code";
  if (baseline === "grok-direct-edit" || baseline === "grok-broad-constrained") return "grok-build";
  if (baseline === "composer-direct-edit" || baseline === "composer-broad-constrained") return "cursor-composer";
  return undefined;
}

async function expandInputPatterns(inputsArg: string): Promise<string[]> {
  const inputs = inputsArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const input of inputs) {
    if (input.includes("*")) out.push(...(await expandGlob(input)));
    else out.push(resolve(input));
  }
  return [...new Set(out)].sort();
}

async function expandGlob(pattern: string): Promise<string[]> {
  const absPattern = normalizePath(resolve(pattern));
  const root = globRoot(absPattern);
  if (!existsSync(root)) return [];
  const regex = globRegex(absPattern);
  const files = await walkFiles(root);
  return files.filter((f) => regex.test(normalizePath(f))).sort();
}

function globRoot(absPattern: string): string {
  const idx = absPattern.indexOf("*");
  if (idx === -1) return dirname(absPattern);
  const slash = absPattern.lastIndexOf("/", idx);
  return slash <= 0 ? "/" : absPattern.slice(0, slash);
}

function globRegex(absPattern: string): RegExp {
  let out = "";
  const pattern = normalizePath(absPattern);
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i++;
    } else if (ch === "*") {
      out += "[^/]*";
    } else {
      out += escapeRegex(ch);
    }
  }
  return new RegExp(`^${out}$`);
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const p = resolve(root, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(p)));
    else if (entry.isFile()) out.push(p);
    else {
      const s = await stat(p).catch(() => undefined);
      if (s?.isFile()) out.push(p);
    }
  }
  return out;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function escapeRegex(ch: string): string {
  return /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(70);
  },
);
