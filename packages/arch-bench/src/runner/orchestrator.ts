/**
 * Suite orchestrator. For each (subject, baseline, repeat):
 *   1. bootstrap a clean, verified v00 project via the real Arch CLI,
 *   2. replay the subject's ordered tasks, each: write target spec → snapshot →
 *      run the baseline's evolution → snapshot → churn metrics → oracles →
 *      (drift detect/repair when applicable) → score → BenchResult.
 *
 * Deterministic baselines run once; live-agent baselines run `repeats` times.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isLiveBaseline, type BaselineId, type BenchSubject, type BenchTask } from "../manifest/schema.js";
import { loadManifestSubjects } from "./subjects.js";
import {
  loadManifest,
  readSpecSource,
  resolvePath,
  tasksForSubject,
  type LoadedManifest,
} from "../manifest/load.js";
import { getBaseline } from "../baselines/registry.js";
import type { EvolveContext, EvolveOutcome } from "../baselines/types.js";
import { makeArchCli, type ArchCli } from "./arch-cli.js";
import { createWorkspace, destroyWorkspace, readSnapshot, writeBackendSpec, type Workspace } from "./workspace.js";
import { benchChurnIgnore } from "./ignore.js";
import { collectChurn, diffSnapshots } from "../metrics/churn.js";
import { runOracles } from "./oracles.js";
import { applyDriftScripts, measureAndRepairArchDrift } from "./drift.js";
import { scorePassed, type TaskSignals } from "./score.js";
import type { BenchResult, DriftRecall } from "../report/results.js";
import type { ClaudeTransport } from "../llm/claude-runner.js";
import type { LiveAgentProvider, LiveAgentTransport } from "../llm/agent-runner.js";

export interface SuiteOptions {
  readonly loaded: LoadedManifest;
  readonly repoRoot: string;
  readonly baselines: readonly BaselineId[];
  readonly repeats: number;
  readonly subjects?: readonly string[];
  readonly maxTasksPerSubject?: number;
  readonly claudeTransport?: ClaudeTransport;
  readonly liveModel?: string;
  readonly artifactsDir?: string;
  readonly keepWorkspace?: boolean;
  readonly log?: (msg: string) => void;
  readonly liveTransports?: Partial<Record<LiveAgentProvider, LiveAgentTransport>>;
  readonly liveModels?: Partial<Record<LiveAgentProvider, string>>;
}

export async function runSuite(opts: SuiteOptions): Promise<BenchResult[]> {
  const log = opts.log ?? (() => {});
  const subjects = loadManifestSubjects(opts.loaded.manifest, opts.subjects);
  const results: BenchResult[] = [];

  for (const subject of subjects) {
    for (const baseline of opts.baselines) {
      if (isLiveBaseline(baseline) && !transportForBaseline(opts, baseline)) {
        log(`skip ${subject.id}/${baseline}: live baseline requires a ${providerForBaseline(baseline)} transport`);
        continue;
      }
      const repeats = isLiveBaseline(baseline) ? Math.max(1, opts.repeats) : 1;
      for (let repeat = 1; repeat <= repeats; repeat++) {
        log(`▶ ${subject.id} · ${baseline} · repeat ${repeat}`);
        results.push(...(await runSubjectBaseline(opts, subject, baseline, repeat, log)));
      }
    }
  }
  return results;
}

async function runSubjectBaseline(
  opts: SuiteOptions,
  subject: BenchSubject,
  baselineId: BaselineId,
  repeat: number,
  log: (msg: string) => void,
): Promise<BenchResult[]> {
  const tasks = capTasks(tasksForSubject(opts.loaded.manifest, subject.id), opts.maxTasksPerSubject);
  const ws = await createWorkspace(`${subject.id}-${baselineId}-r${repeat}`);
  const archCli = makeArchCli({ repoRoot: opts.repoRoot, env: ws.env });

  try {
    const boot = await bootstrapV00(opts.loaded, subject, ws, archCli);
    if (!boot.ok) {
      log(`  ✗ bootstrap failed: ${boot.reason}`);
      return tasks.map((t) => failedResult(t, baselineId, repeat, `bootstrap failed: ${boot.reason}`));
    }

    const out: BenchResult[] = [];
    for (const task of tasks) {
      const result = await runOneTask(opts, subject, task, baselineId, repeat, ws, archCli, log);
      out.push(result);
    }
    return out;
  } finally {
    if (!opts.keepWorkspace) await destroyWorkspace(ws);
    else log(`  kept workspace ${ws.dir}`);
  }
}

interface BootstrapResult {
  readonly ok: boolean;
  readonly reason?: string;
}

async function bootstrapV00(
  loaded: LoadedManifest,
  subject: BenchSubject,
  ws: Workspace,
  archCli: ArchCli,
): Promise<BootstrapResult> {
  const v00 = await readSpecSource(loaded, subject.baseSpec);
  await writeBackendSpec(ws, v00);
  const backend = resolve(ws.dir, "backend.arch");
  const steps: [string, readonly string[]][] = [
    ["init", ["init", "--cwd", ws.dir]],
    ["parse", ["parse", "--emit-ir", backend, "--cwd", ws.dir]],
    ["plan", ["plan", "--cwd", ws.dir]],
    ["apply", ["apply", "--cwd", ws.dir]],
  ];
  for (const [name, args] of steps) {
    const r = await archCli(args);
    if (r.code !== 0) return { ok: false, reason: `${name} exit ${r.code}: ${r.stderr.slice(-400)}` };
  }
  return { ok: true };
}

async function runOneTask(
  opts: SuiteOptions,
  subject: BenchSubject,
  task: BenchTask,
  baselineId: BaselineId,
  repeat: number,
  ws: Workspace,
  archCli: ArchCli,
  log: (msg: string) => void,
): Promise<BenchResult> {
  const startedAt = Date.now();
  let logs = "";
  try {
    const toSpec = await readSpecSource(opts.loaded, task.toSpec);

    // Seed a human-owned file BEFORE the before-snapshot so any overwrite shows
    // up as a modification/deletion under src/custom.
    if (task.humanOwnedSeed) {
      const target = resolve(ws.dir, task.humanOwnedSeed.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, task.humanOwnedSeed.content, "utf8");
    }

    const before = await readSnapshot(ws.dir, benchChurnIgnore);
    await writeBackendSpec(ws, toSpec); // task input; ignored by churn

    let evolve: EvolveOutcome;
    let driftRecall: DriftRecall = "not_applicable";
    let repairSucceeded: boolean | undefined;

    if (task.kind === "drift_injection") {
      const driftScripts = (task.driftScripts ?? []).map((p) => resolvePath(opts.loaded, p));
      const inject = await applyDriftScripts(opts.repoRoot, ws, driftScripts);
      logs += inject.logs;
      if (baselineId === "arch-typed-sync") {
        const m = await measureAndRepairArchDrift(archCli, ws, task.expectedDriftKinds ?? []);
        logs += m.logs;
        driftRecall = m.recall;
        repairSucceeded = m.repairSucceeded;
        evolve = { blocked: false, verificationPassed: m.repairSucceeded, logs: m.logs };
      } else {
        evolve = await getBaseline(baselineId).evolve(buildCtx(opts, task, ws, archCli, toSpec, log));
        repairSucceeded = evolve.verificationPassed;
      }
    } else {
      evolve = await getBaseline(baselineId).evolve(buildCtx(opts, task, ws, archCli, toSpec, log));
    }
    logs += evolve.logs;

    const after = await readSnapshot(ws.dir, benchChurnIgnore);
    const churn = collectChurn(diffSnapshots(before, after, benchChurnIgnore), {
      expectedPaths: task.expectedAffectedPaths,
    });

    logs += `\n=== churn (${churn.filesTouched} files, ${churn.offScopeFilesTouched} off-scope) ===\n`;
    logs += `touched: ${churn.touchedPaths.join(", ")}\n`;
    logs += `offscope: ${churn.offScopePaths.join(", ")}\n`;

    const oracleFiles = (task.oracleTests ?? []).map((p) => resolvePath(opts.loaded, p));
    const oracles = await runOracles({ ws, taskId: task.id, oracleFiles });
    logs += oracles.logs;

    const signals: TaskSignals = {
      blocked: evolve.blocked,
      verificationPassed: evolve.verificationPassed,
      oraclePassed: oracles.passed,
      humanOwnedViolations: churn.humanOwnedViolations,
      generatedTestDeletedOrWeakened: churn.generatedTestDeletedOrWeakened,
      offScopeFilesTouched: churn.offScopeFilesTouched,
      driftRecall,
      ...(repairSucceeded !== undefined ? { repairSucceeded } : {}),
    };
    const passed = scorePassed(task.kind, task.expectedOutcome, baselineId, signals);

    const result: BenchResult = {
      taskId: task.id,
      baseline: baselineId,
      repeat,
      passed,
      blocked: evolve.blocked,
      durationMs: Date.now() - startedAt,
      filesTouched: churn.filesTouched,
      changedLoc: churn.changedLoc,
      expectedFilesTouched: churn.expectedFilesTouched,
      offScopeFilesTouched: churn.offScopeFilesTouched,
      humanOwnedViolations: churn.humanOwnedViolations,
      generatedTestDeletedOrWeakened: churn.generatedTestDeletedOrWeakened,
      verificationPassed: evolve.verificationPassed,
      oraclePassed: oracles.passed,
      driftRecall,
      ...(repairSucceeded !== undefined ? { repairSucceeded } : {}),
      ...(evolve.planDeterministic !== undefined ? { planDeterministic: evolve.planDeterministic } : {}),
      ...(evolve.llm ? { llm: evolve.llm } : {}),
      ...(evolve.note ? { note: evolve.note } : {}),
    };

    log(`  ${passed ? "✓" : "✗"} ${task.id} (${baselineId}) files=${churn.filesTouched} offscope=${churn.offScopeFilesTouched}`);
    await maybeWriteArtifact(opts, subject, baselineId, repeat, task, logs, result);
    return result;
  } catch (err) {
    const note = `harness error: ${err instanceof Error ? err.message : String(err)}`;
    log(`  ✗ ${task.id} (${baselineId}) ${note}`);
    return { ...failedResult(task, baselineId, repeat, note), durationMs: Date.now() - startedAt };
  }
}

function buildCtx(
  opts: SuiteOptions,
  task: BenchTask,
  ws: Workspace,
  archCli: ArchCli,
  toSpecSource: string,
  log: (msg: string) => void,
): EvolveContext {
  return {
    task,
    loaded: opts.loaded,
    workspace: ws,
    archCli,
    toSpecSource,
    ...(opts.claudeTransport ? { claudeTransport: opts.claudeTransport } : {}),
    ...(opts.liveModel ? { liveModel: opts.liveModel } : {}),
    ...(opts.liveTransports ? { liveTransports: opts.liveTransports } : {}),
    ...(opts.liveModels ? { liveModels: opts.liveModels } : {}),
    log,
  };
}

function transportForBaseline(opts: SuiteOptions, baseline: BaselineId): LiveAgentTransport | ClaudeTransport | undefined {
  const provider = providerForBaseline(baseline);
  if (!provider) return undefined;
  return opts.liveTransports?.[provider] ?? (provider === "claude-code" ? opts.claudeTransport : undefined);
}

function providerForBaseline(baseline: BaselineId): LiveAgentProvider | undefined {
  if (baseline === "claude-direct-edit" || baseline === "claude-broad-constrained") return "claude-code";
  if (baseline === "grok-direct-edit" || baseline === "grok-broad-constrained") return "grok-build";
  if (baseline === "composer-direct-edit" || baseline === "composer-broad-constrained") return "cursor-composer";
  return undefined;
}

function failedResult(task: BenchTask, baseline: BaselineId, repeat: number, note: string): BenchResult {
  return {
    taskId: task.id,
    baseline,
    repeat,
    passed: false,
    blocked: false,
    durationMs: 0,
    filesTouched: 0,
    changedLoc: 0,
    expectedFilesTouched: 0,
    offScopeFilesTouched: 0,
    humanOwnedViolations: 0,
    generatedTestDeletedOrWeakened: false,
    verificationPassed: false,
    oraclePassed: false,
    driftRecall: "not_applicable",
    note,
  };
}

function capTasks(tasks: readonly BenchTask[], max?: number): BenchTask[] {
  return max && max > 0 ? tasks.slice(0, max) : [...tasks];
}

async function maybeWriteArtifact(
  opts: SuiteOptions,
  subject: BenchSubject,
  baseline: BaselineId,
  repeat: number,
  task: BenchTask,
  logs: string,
  result: BenchResult,
): Promise<void> {
  if (!opts.artifactsDir) return;
  const dir = resolve(opts.artifactsDir, "logs", subject.id, baseline, `r${repeat}`);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, `${task.id}.log`), logs, "utf8");
  await writeFile(resolve(dir, `${task.id}.result.json`), JSON.stringify(result, null, 2) + "\n", "utf8");
}

export { loadManifest };
