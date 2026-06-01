/**
 * Suite orchestrator. For each (subject, baseline, repeat):
 *   1. bootstrap a clean, verified v00 project via the real Arch CLI,
 *   2. replay the subject's ordered tasks, each: write target spec → snapshot →
 *      run the baseline's evolution → snapshot → churn metrics → oracles →
 *      (drift detect/repair when applicable) → score → BenchResult.
 *
 * Deterministic baselines run once; live-agent baselines run `repeats` times.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { runDbCheck } from "./db-check.js";
import { DEFAULT_FAILURE_POLICY, DEFAULT_TASK_MODE, planTaskExecution } from "./run-modes.js";
import { runWithConcurrency } from "./concurrency.js";
import { computeGuaranteeVerification } from "./guarantee.js";
import type {
  BenchResult,
  DriftRecall,
  FailurePolicy,
  MigrationCheckStatus,
  TaskMode,
} from "../report/results.js";
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
  /** Run mode: `isolated` bootstraps each task from its own fromSpec. */
  readonly taskMode?: TaskMode;
  /** What to do with the workspace after a failed task in sequential mode. */
  readonly failurePolicy?: FailurePolicy;
  /** Validation/paper mode: strict scoring (migration tasks need a passing dbCheck). */
  readonly validationMode?: boolean;
  /** Per-task db-check timeout (ms). */
  readonly dbCheckTimeoutMs?: number;
  /**
   * DB URL for migration dbChecks, threaded from the bench process env. The
   * hermetic workspace env does not carry it, so without this a configured
   * Postgres would never reach the dbCheck (it would report `skipped`).
   */
  readonly databaseUrl?: string;
  /** Number of independent subject/baseline/repeat chains to run concurrently. */
  readonly jobs?: number;
  /** In isolated mode, reuse existing per-task `.result.json` artifacts. */
  readonly resume?: boolean;
}

export async function runSuite(opts: SuiteOptions): Promise<BenchResult[]> {
  const log = opts.log ?? (() => {});
  const subjects = loadManifestSubjects(opts.loaded.manifest, opts.subjects);
  const units: { subject: BenchSubject; baseline: BaselineId; repeat: number }[] = [];

  for (const subject of subjects) {
    for (const baseline of opts.baselines) {
      if (isLiveBaseline(baseline) && !transportForBaseline(opts, baseline)) {
        log(`skip ${subject.id}/${baseline}: live baseline requires a ${providerForBaseline(baseline)} transport`);
        continue;
      }
      const repeats = isLiveBaseline(baseline) ? Math.max(1, opts.repeats) : 1;
      for (let repeat = 1; repeat <= repeats; repeat++) {
        units.push({ subject, baseline, repeat });
      }
    }
  }
  const chunks = await runWithConcurrency<(typeof units)[number], BenchResult[]>(units, {
    jobs: opts.jobs,
    lockKey: (unit) => providerForBaseline(unit.baseline),
    run: async (unit) => {
      log(`▶ ${unit.subject.id} · ${unit.baseline} · repeat ${unit.repeat}`);
      return runSubjectBaseline(opts, unit.subject, unit.baseline, unit.repeat, log);
    },
  });
  return chunks.flat();
}

async function runSubjectBaseline(
  opts: SuiteOptions,
  subject: BenchSubject,
  baselineId: BaselineId,
  repeat: number,
  log: (msg: string) => void,
): Promise<BenchResult[]> {
  const tasks = capTasks(tasksForSubject(opts.loaded.manifest, subject.id), opts.maxTasksPerSubject);
  const taskMode = opts.taskMode ?? DEFAULT_TASK_MODE;
  const failurePolicy = opts.failurePolicy ?? DEFAULT_FAILURE_POLICY;

  if (taskMode === "isolated") {
    // Each task runs in its own fresh workspace bootstrapped from its fromSpec,
    // so it never replays a previous task's baseline failure.
    const out: BenchResult[] = [];
    for (const task of tasks) {
      if (opts.resume && opts.artifactsDir) {
        const existing = await readTaskResultArtifact(opts, subject, baselineId, repeat, task, taskMode, failurePolicy);
        if (existing) {
          log(`  ↻ ${task.id} (${baselineId}) reused existing result`);
          out.push(existing);
          continue;
        }
      }
      const ws = await createWorkspace(`${subject.id}-${baselineId}-r${repeat}-t${task.order}`);
      const archCli = makeArchCli({ repoRoot: opts.repoRoot, env: ws.env });
      try {
        const boot = await bootstrapSpec(opts.loaded, task.fromSpec, ws, archCli);
        if (!boot.ok) {
          log(`  ✗ bootstrap(fromSpec) failed: ${boot.reason}`);
          out.push(
            failedResult(
              task,
              baselineId,
              repeat,
              `bootstrap failed: ${boot.reason}`,
              taskMode,
              failurePolicy,
              opts.validationMode ?? false,
            ),
          );
          continue;
        }
        out.push(await runOneTask(opts, subject, task, baselineId, repeat, ws, archCli, log, taskMode, failurePolicy));
      } finally {
        if (!opts.keepWorkspace) await destroyWorkspace(ws);
        else log(`  kept workspace ${ws.dir}`);
      }
    }
    return out;
  }

  // Sequential: evolve one shared workspace through the ordered task chain.
  let ws = await createWorkspace(`${subject.id}-${baselineId}-r${repeat}`);
  let archCli = makeArchCli({ repoRoot: opts.repoRoot, env: ws.env });
  try {
    const boot = await bootstrapV00(opts.loaded, subject, ws, archCli);
    if (!boot.ok) {
      log(`  ✗ bootstrap failed: ${boot.reason}`);
      return tasks.map((t) =>
        failedResult(
          t,
          baselineId,
          repeat,
          `bootstrap failed: ${boot.reason}`,
          taskMode,
          failurePolicy,
          opts.validationMode ?? false,
        ),
      );
    }

    const out: BenchResult[] = [];
    let priorTaskFailed = false;
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const plan = planTaskExecution({ taskMode, failurePolicy, index: i, priorTaskFailed });
      if (plan.restoreFromSpec) {
        // restore-from-spec: rebuild this task's starting point from a clean
        // workspace so one failed baseline doesn't cascade into the next task.
        if (!opts.keepWorkspace) await destroyWorkspace(ws);
        ws = await createWorkspace(`${subject.id}-${baselineId}-r${repeat}-restore-t${task.order}`);
        archCli = makeArchCli({ repoRoot: opts.repoRoot, env: ws.env });
        const reboot = await bootstrapSpec(opts.loaded, task.fromSpec, ws, archCli);
        if (!reboot.ok) {
          log(`  ✗ restore(fromSpec) failed: ${reboot.reason}`);
          out.push(
            failedResult(
              task,
              baselineId,
              repeat,
              `restore failed: ${reboot.reason}`,
              taskMode,
              failurePolicy,
              opts.validationMode ?? false,
            ),
          );
          priorTaskFailed = true;
          continue;
        }
      }
      const result = await runOneTask(opts, subject, task, baselineId, repeat, ws, archCli, log, taskMode, failurePolicy);
      out.push(result);
      priorTaskFailed = !result.passed;
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
  return bootstrapSpec(loaded, subject.baseSpec, ws, archCli);
}

/** Bootstrap a clean, verified project at an arbitrary spec (v00 or a task fromSpec). */
async function bootstrapSpec(
  loaded: LoadedManifest,
  specRelPath: string,
  ws: Workspace,
  archCli: ArchCli,
): Promise<BootstrapResult> {
  const spec = await readSpecSource(loaded, specRelPath);
  await writeBackendSpec(ws, spec);
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
  taskMode: TaskMode = DEFAULT_TASK_MODE,
  failurePolicy: FailurePolicy = DEFAULT_FAILURE_POLICY,
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

    const migration = await runMigrationCheck(opts, task, ws);
    logs += migration.reason ? `\n=== dbCheck: ${migration.status} (${migration.reason}) ===\n` : "";
    const guaranteeVerification = computeGuaranteeVerification(task);

    const signals: TaskSignals = {
      blocked: evolve.blocked,
      verificationPassed: evolve.verificationPassed,
      oraclePassed: oracles.passed,
      humanOwnedViolations: churn.humanOwnedViolations,
      generatedTestDeletedOrWeakened: churn.generatedTestDeletedOrWeakened,
      offScopeFilesTouched: churn.offScopeFilesTouched,
      driftRecall,
      migrationCheckStatus: migration.status,
      ...(repairSucceeded !== undefined ? { repairSucceeded } : {}),
    };
    const passed = scorePassed(task.kind, task.expectedOutcome, baselineId, signals, {
      strict: opts.validationMode ?? false,
    });

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
      ...(migration.status !== "not_applicable" ? { migrationCheckStatus: migration.status } : {}),
      ...(migration.dataPreserved !== undefined ? { migrationDataPreserved: migration.dataPreserved } : {}),
      ...(migration.reason !== undefined ? { migrationCheckReason: migration.reason } : {}),
      ...(guaranteeVerification !== undefined ? { guaranteeVerification } : {}),
      taskKind: task.kind,
      taskMode,
      failurePolicy,
      validationMode: opts.validationMode ?? false,
      ...(evolve.llm ? { llm: evolve.llm } : {}),
      ...(evolve.note ? { note: evolve.note } : {}),
    };

    log(`  ${passed ? "✓" : "✗"} ${task.id} (${baselineId}) files=${churn.filesTouched} offscope=${churn.offScopeFilesTouched}`);
    await maybeWriteArtifact(opts, subject, baselineId, repeat, task, logs, result);
    return result;
  } catch (err) {
    const note = `harness error: ${err instanceof Error ? err.message : String(err)}`;
    log(`  ✗ ${task.id} (${baselineId}) ${note}`);
    logs += `\n=== harness error ===\n${note}\n`;
    const result = {
      ...failedResult(task, baselineId, repeat, note, taskMode, failurePolicy, opts.validationMode ?? false),
      durationMs: Date.now() - startedAt,
    };
    await maybeWriteArtifact(opts, subject, baselineId, repeat, task, logs, result);
    return result;
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

function failedResult(
  task: BenchTask,
  baseline: BaselineId,
  repeat: number,
  note: string,
  taskMode: TaskMode = DEFAULT_TASK_MODE,
  failurePolicy: FailurePolicy = DEFAULT_FAILURE_POLICY,
  validationMode = false,
): BenchResult {
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
    taskKind: task.kind,
    taskMode,
    failurePolicy,
    validationMode,
    note,
  };
}

/**
 * Run the migration data-preservation dbCheck for a migration task. Returns
 * `not_applicable` for non-migration tasks (and migration tasks with no dbCheck
 * script). Without a database configured the check reports `skipped`.
 */
async function runMigrationCheck(
  opts: SuiteOptions,
  task: BenchTask,
  ws: Workspace,
): Promise<{ status: MigrationCheckStatus; dataPreserved?: boolean; reason?: string }> {
  if (task.kind !== "migration_data_preservation") return { status: "not_applicable" };
  if (!task.dbCheck) return { status: "not_applicable", reason: "task declares no dbCheck script" };
  return runDbCheck({
    scriptPath: resolvePath(opts.loaded, task.dbCheck),
    projectDir: ws.dir,
    env: ws.env,
    ...(opts.databaseUrl !== undefined ? { databaseUrl: opts.databaseUrl } : {}),
    ...(opts.dbCheckTimeoutMs !== undefined ? { timeoutMs: opts.dbCheckTimeoutMs } : {}),
  });
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

async function readTaskResultArtifact(
  opts: SuiteOptions,
  subject: BenchSubject,
  baseline: BaselineId,
  repeat: number,
  task: BenchTask,
  taskMode: TaskMode,
  failurePolicy: FailurePolicy,
): Promise<BenchResult | undefined> {
  if (!opts.artifactsDir) return undefined;
  const file = resolve(opts.artifactsDir, "logs", subject.id, baseline, `r${repeat}`, `${task.id}.result.json`);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  const parsed = JSON.parse(raw) as BenchResult;
  if (parsed.taskId !== task.id || parsed.baseline !== baseline || parsed.repeat !== repeat) {
    throw new Error(
      `resume artifact key mismatch in ${file}: expected ${task.id}/${baseline}/r${repeat}, ` +
        `got ${parsed.taskId}/${parsed.baseline}/r${parsed.repeat}`,
    );
  }
  if (
    parsed.taskMode !== taskMode ||
    parsed.failurePolicy !== failurePolicy ||
    parsed.validationMode !== (opts.validationMode ?? false)
  ) {
    return undefined;
  }
  return parsed;
}

export { loadManifest };
