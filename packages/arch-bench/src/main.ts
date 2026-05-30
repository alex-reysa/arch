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
import { runSuite } from "./runner/orchestrator.js";
import { buildRunResults, type RunResults } from "./report/results.js";
import { writeRunArtifacts } from "./report/write.js";
import { toSummaryMarkdown } from "./report/summary.js";
import { mergeRunResults } from "./report/merge.js";
import { spawnLiveAgentTransport, type LiveAgentProvider, type LiveAgentTransport } from "./llm/agent-runner.js";
import { preflightLiveProviders, type LiveCliConfig } from "./llm/preflight.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "run") return runCommand(rest);
  if (command === "summarize") return summarizeCommand(rest);
  if (command === "merge") return mergeCommand(rest);
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
      "  arch-bench merge --inputs <results.json[,results.json]|glob> --out <dir> [--manifest <path>]",
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
