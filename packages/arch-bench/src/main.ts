#!/usr/bin/env node
/**
 * `arch-bench` CLI.
 *
 *   arch-bench run --suite paper --out artifacts/bench/<run-id>
 *   arch-bench run --suite smoke --baselines arch-typed-sync,full-regeneration
 *   arch-bench summarize --input artifacts/bench/<run-id>/results.json
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { BASELINE_IDS, isLiveBaseline, type BaselineId } from "./manifest/schema.js";
import { buildTaskIndex, loadManifest } from "./manifest/load.js";
import { runSuite } from "./runner/orchestrator.js";
import { spawnClaudeTransport } from "./llm/claude-runner.js";
import { buildRunResults, type RunResults } from "./report/results.js";
import { writeRunArtifacts } from "./report/write.js";
import { toSummaryMarkdown } from "./report/summary.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "run") return runCommand(rest);
  if (command === "summarize") return summarizeCommand(rest);
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
      "  arch-bench summarize --input <results.json> [--manifest <path>]",
      "",
      "run options:",
      "  --suite <paper|smoke>     Preset (default: smoke)",
      "  --out <dir>               Output dir (default: artifacts/bench/<run-id>)",
      "  --manifest <path>         Manifest (default: benchmarks/manifest.json)",
      "  --baselines a,b,c         Override baselines",
      "  --subjects x,y            Restrict to subjects",
      "  --max-tasks <n>           Cap tasks per subject",
      "  --repeats <n>             Live-baseline repeats (default 3, env ARCH_BENCH_REPEATS)",
      "  --keep                    Keep temp workspaces",
      "",
      "Live LLM baselines require ARCH_BENCH_LIVE=1 and an authenticated `claude` CLI.",
      "Optional: ARCH_BENCH_MODEL=<model-id>.",
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
    else if (a === "--keep") args.keep = true;
  }
  return args;
}

async function runCommand(argv: readonly string[]): Promise<number> {
  const args = parseRunArgs(argv);
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

  if (args.suite === "paper" && wantsLive) {
    if (!live) {
      process.stderr.write("arch-bench: paper suite requires ARCH_BENCH_LIVE=1 for the live Claude baselines\n");
      return 2;
    }
    if (!claudeAvailable()) {
      process.stderr.write("arch-bench: `claude` CLI not found on PATH; cannot run live baselines\n");
      return 2;
    }
  }

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outDir = args.out ? resolve(args.out) : resolve(REPO_ROOT, "artifacts", "bench", runId);

  process.stdout.write(`arch-bench: suite=${args.suite} run=${runId}\n`);
  process.stdout.write(`  baselines: ${baselines.join(", ")}\n`);
  process.stdout.write(`  subjects:  ${subjects.join(", ")}\n`);
  process.stdout.write(`  live: ${live && wantsLive ? "yes" : "no"}  out: ${outDir}\n`);

  const transport = live && wantsLive ? spawnClaudeTransport() : undefined;
  const liveModel = process.env["ARCH_BENCH_MODEL"];

  const results = await runSuite({
    loaded,
    repoRoot: REPO_ROOT,
    baselines,
    repeats,
    subjects,
    ...(maxTasksPerSubject !== undefined ? { maxTasksPerSubject } : {}),
    ...(transport ? { claudeTransport: transport } : {}),
    ...(liveModel ? { liveModel } : {}),
    artifactsDir: outDir,
    keepWorkspace: args.keep,
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

function defaultBaselines(suite: "paper" | "smoke", manifestBaselines: readonly BaselineId[]): BaselineId[] {
  if (suite === "smoke") return ["arch-typed-sync", "full-regeneration"];
  return manifestBaselines.length > 0 ? [...manifestBaselines] : [...BASELINE_IDS];
}

function defaultSubjects(suite: "paper" | "smoke", all: readonly string[]): string[] {
  if (suite === "smoke") return all.slice(0, 2);
  return [...all];
}

function claudeAvailable(): boolean {
  try {
    const r = spawnSync("claude", ["--version"], { stdio: "ignore" });
    return r.status === 0 || r.status === null ? r.error === undefined : false;
  } catch {
    return false;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(70);
  },
);
