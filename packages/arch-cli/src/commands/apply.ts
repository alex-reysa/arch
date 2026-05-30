import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { generate, type GeneratedFile } from "@arch/generator";
import {
  applyPlan,
  atomicWriteJson,
  atomicWriteText,
  canonicalStringify,
  metadataPaths,
  renderInitialMigrationSql,
  renderMigrationSqlForDiff,
  snapshotPaths,
  type SyncPlanV1,
} from "@arch/sync";
import { runInstall, verify, writeReports, type VerificationRunResult } from "@arch/verifier";
import type { AgentProvider, AgentRunRecord } from "@arch/agents";
import { findProjectRoot } from "../project-root.js";
import { parseArchSource } from "./parse.js";
import { resolveAgentProvider, runAgentActions } from "../agent-apply.js";

/**
 * `arch apply` performs the initial-generation lifecycle:
 *   1. read backend.arch from the project root, parse it, and (re)build IR
 *   2. validate IR shape
 *   3. invoke the generator to produce a list of files
 *   4. write generated files into `--out-dir` (default: project root)
 *   5. run `pnpm install` inside the generated project so the verifier can
 *      resolve workspace + npm deps (skipped when `--skip-verify` is set)
 *   6. invoke the verifier (typecheck + tests) inside the generated project
 *   7. on success: atomically write artifact-map.json + ownership.json and
 *      promote ir.current.json → ir.previous.json
 *   8. on failure: leave ir.current.json in place; do NOT touch ir.previous
 *      or the metadata baseline
 *
 * The install step is fronted by `runInstall` from `@arch/verifier`, which
 * forwards child stdout/stderr to the parent's stderr and returns
 * `failure_reason: "install"` on non-zero exit. An install failure is
 * recorded in the run dir as a `VerificationRunResult` and gates verify —
 * we do NOT call `verify()` and do NOT promote the snapshot.
 *
 * Re-applies preserve user edits inside `src/custom/**` (stub-only ownership).
 */
export interface RunApplyOptions {
  /** Inject a provider to route generated-file actions through the constrained
   *  agent boundary (used by `--agent`, and by tests to supply a mock). */
  readonly agentProvider?: AgentProvider;
}

export async function runApply(argv: string[], opts: RunApplyOptions = {}): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const root = args.cwd ?? findProjectRootSafe();
  if (!root) {
    process.stderr.write("arch apply: no backend.arch found in cwd or ancestors\n");
    return 64;
  }

  const archFile = resolve(root, "backend.arch");
  const metadataDir = args.metadataDir ?? resolve(root, ".arch");
  const outDir = args.outDir ? (isAbsolute(args.outDir) ? args.outDir : resolve(root, args.outDir)) : root;

  const source = await readFile(archFile, "utf8");
  const parsed = parseArchSource(source, archFile);
  if (!parsed.ok) {
    for (const d of parsed.diagnostics) {
      process.stderr.write(`${archFile}:${d.line}:${d.column} error ${d.code}: ${d.message}\n`);
    }
    return 65;
  }
  const ir = parsed.ir;

  // Persist ir.current.json BEFORE generation so a verifier failure leaves
  // the snapshot in place.
  const snapshots = snapshotPaths(metadataDir);
  await mkdir(dirname(snapshots.current), { recursive: true });
  await atomicWriteJson(snapshots.current, ir);

  const previousSnapshot = await readPreviousSnapshot(metadataDir);
  if (!previousSnapshot.ok) {
    process.stderr.write(`arch apply: ${previousSnapshot.message}\n`);
    return 70;
  }

  const planSelection = await readApplicableLatestPlan(
    metadataDir,
    ir,
    previousSnapshot.ir,
  );
  if (!planSelection.ok) {
    process.stderr.write(`arch apply: ${planSelection.message}\n`);
    return 70;
  }

  const result = generate(ir);
  const latestPlan = planSelection.plan;

  // Resolve the optional constrained-agent provider (`--agent <name>` or an
  // injected one). When set, planned generated-file content is produced through
  // the AgentOrchestrator boundary instead of read straight from the generator.
  let agentProvider: AgentProvider | null = opts.agentProvider ?? null;
  if (!agentProvider && args.agent) {
    agentProvider = resolveAgentProvider(args.agent);
    if (!agentProvider) {
      process.stderr.write(`arch apply: unknown --agent provider '${args.agent}'\n`);
      return 64;
    }
  }

  // Apply ownership rules: stub-only files are written ONLY when absent.
  const writtenPaths: string[] = [];
  const skippedStubs: string[] = [];
  if (latestPlan) {
    const byPath = new Map(result.files.map((f) => [f.path, f]));
    // Migration SQL is diff-derived (not part of the file generator output),
    // so resolve content for every planned `create_migration` action up front.
    // This closes the "silently skipped migration" gap: a planned migration
    // artifact must be written, not dropped.
    const migrationByPath = buildMigrationContent(latestPlan, ir);

    // Constrained agent execution (opt-in). Every routed action's content is
    // re-validated by the orchestrator (allowlist / ownership / write_scope)
    // before it can be used; the patcher validates again before writing. A
    // rejected output aborts apply BEFORE any write or promotion.
    const agentContent = new Map<string, string>();
    if (agentProvider) {
      const agentResult = await runAgentActions({
        plan: latestPlan,
        ir,
        generatedByPath: byPath,
        provider: agentProvider,
      });
      await persistAgentRuns(metadataDir, agentProvider, agentResult.records);
      if (agentResult.error) {
        process.stderr.write(
          `arch apply: agent task rejected (${agentResult.error.record.outcome}) for ` +
            `${agentResult.error.record.artifact_id}: ${agentResult.error.message}\n`,
        );
        // Do NOT apply the plan, write files, or promote metadata.
        return 70;
      }
      for (const [path, content] of agentResult.contentByPath) agentContent.set(path, content);
      process.stdout.write(
        `arch apply: agent provider ${agentProvider.id} produced ${agentContent.size} validated patch(es)\n`,
      );
    }

    const applied = await applyPlan({
      projectRoot: outDir,
      plan: latestPlan,
      contentProvider: {
        contentFor(action) {
          if (action.kind === "create_migration") {
            return migrationByPath.get(action.path) ?? null;
          }
          // Agent-produced content (already orchestrator-validated) wins for
          // routed actions; the patcher still re-validates before writing.
          if (agentContent.has(action.path)) {
            return agentContent.get(action.path) ?? null;
          }
          const generated = byPath.get(action.path);
          if (!generated) return null;
          const target = resolve(outDir, generated.path);
          if (generated.stub_only && existsSync(target)) {
            skippedStubs.push(generated.path);
            return null;
          }
          return generated.content;
        },
      },
    });
    if (applied.errors.length > 0) {
      for (const err of applied.errors) {
        process.stderr.write(`arch apply: patch error: ${err}\n`);
      }
      return 70;
    }
    writtenPaths.push(...applied.applied);
    // Account for every planned non-metadata artifact: anything neither
    // applied nor an intentionally-preserved stub is surfaced, so a skip is
    // never silent.
    reportUnexplainedSkips(latestPlan, applied.applied, skippedStubs);
  } else {
    for (const f of result.files) {
      const target = resolve(outDir, f.path);
      if (f.stub_only && existsSync(target)) {
        skippedStubs.push(f.path);
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content, "utf8");
      writtenPaths.push(f.path);
    }
    // Initial generation also writes an inspectable initial migration scaffold
    // so the generated project carries a reviewable prisma/migrations entry.
    const initMigrationPath = "prisma/migrations/00000000000000_init/migration.sql";
    const initTarget = resolve(outDir, initMigrationPath);
    await mkdir(dirname(initTarget), { recursive: true });
    await writeFile(initTarget, renderInitialMigrationSql(ir), "utf8");
    writtenPaths.push(initMigrationPath);
  }

  const paths = metadataPaths(metadataDir);

  if (args.skipVerify) {
    process.stdout.write(`arch apply: --skip-verify set; not invoking verifier\n`);
    process.stdout.write(`arch apply: wrote ${writtenPaths.length} files; ${skippedStubs.length} stubs preserved\n`);
    process.stdout.write("arch apply: metadata and ir.previous were not promoted\n");
    return 0;
  }

  // Run verifier. Metadata is intentionally deferred until install + verify
  // both pass, so a failed run leaves the previous baseline untouched.
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomShort()}`;
  const runDir = resolve(paths.runsDir, runId);
  await mkdir(runDir, { recursive: true });

  // Install dependencies inside the generated project before verify.
  // `runInstall` forwards stdout/stderr to the parent's stderr by default;
  // a non-zero exit short-circuits with `failure_reason: "install"` and we
  // record that as a VerificationRunResult so downstream tooling
  // (`arch check`, the orchestrator) can distinguish install failures from
  // typecheck/test failures.
  const installResult = await runInstall({ projectRoot: outDir });
  if (!installResult.passed) {
    const installRunResult: VerificationRunResult = {
      run_id: runId,
      passed: false,
      steps: [
        {
          name: "install",
          passed: false,
          durationMs: installResult.durationMs,
          stderr: installResult.stderr,
        },
      ],
      failure_reason: "install",
    };
    await writeReports(runDir, installRunResult);
    process.stderr.write(
      `arch apply: pnpm install FAILED (run ${runId} → ${runDir})\n`,
    );
    process.stderr.write(`  reason: install (exit ${installResult.exitCode})\n`);
    // Do NOT call verify(); do NOT promote ir.current to ir.previous.
    return 70;
  }

  const runResult = withRunId(await verify({ projectRoot: outDir }), runId);
  await writeReports(runDir, runResult);

  if (!runResult.passed) {
    process.stderr.write(`arch apply: verification FAILED (run ${runResult.run_id} → ${runDir})\n`);
    process.stderr.write(`  reason: ${runResult.failure_reason ?? "unknown"}\n`);
    // Do NOT promote ir.current to ir.previous.
    return 70;
  }

  await writeArtifactMetadata(paths.artifactMap, paths.ownership, result.files, ir.canonical_hash);

  // Persist the entity → source-span map (§15.5) for plan traceability and
  // drift reports.
  await atomicWriteJson(paths.sourceMap, {
    schema_version: "arch.source-map.v1",
    entries: ir.source_locations,
  });

  // Success: promote ir.current → ir.previous
  await promoteCurrentSnapshot(metadataDir);
  process.stdout.write(`arch apply: ok (run ${runResult.run_id})\n`);
  process.stdout.write(`  files written: ${writtenPaths.length}\n`);
  process.stdout.write(`  stubs preserved: ${skippedStubs.length}\n`);
  return 0;
}

interface CliArgs {
  readonly help: boolean;
  readonly cwd: string | undefined;
  readonly outDir: string | undefined;
  readonly metadataDir: string | undefined;
  readonly skipVerify: boolean;
  readonly agent: string | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let help = false;
  let cwd: string | undefined;
  let outDir: string | undefined;
  let metadataDir: string | undefined;
  let skipVerify = false;
  let agent: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--cwd") cwd = argv[++i];
    else if (a === "--out-dir") outDir = argv[++i];
    else if (a === "--metadata-dir") metadataDir = argv[++i];
    else if (a === "--skip-verify") skipVerify = true;
    else if (a === "--agent") agent = argv[++i];
  }
  return { help, cwd, outDir, metadataDir, skipVerify, agent };
}

const HELP = [
  "Usage: arch apply [--cwd <dir>] [--out-dir <dir>] [--metadata-dir <dir>] [--skip-verify] [--agent <provider>]",
  "",
  "Apply backend.arch into a generated project. Verification gating is the default.",
  "",
  "--agent <provider>  Route planned generated-file content through the constrained",
  "                    AgentOrchestrator (incremental sync only). Providers:",
  "                    'deterministic' (planned-content) or 'claude' (claude -p).",
  "                    Every patch is re-validated before any write; run records",
  "                    are written to .arch/agent-runs/.",
  "",
].join("\n");

/**
 * Resolve migration SQL content for every `create_migration` action in the
 * plan. Each migration artifact corresponds to one or more schema diffs; we
 * concatenate the SQL for each so the written migration is complete.
 */
function buildMigrationContent(plan: SyncPlanV1, ir: CanonicalIR): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const action of plan.actions) {
    if (action.kind !== "create_migration") continue;
    const sqls: string[] = [];
    for (const diffId of action.diff_ids) {
      const diff = plan.diff_index.find((d) => d.diff_id === diffId);
      if (!diff) continue;
      const sql = renderMigrationSqlForDiff(diff, ir);
      if (sql) sqls.push(sql);
    }
    if (sqls.length > 0) byPath.set(action.path, sqls.join("\n"));
  }
  return byPath;
}

/**
 * Surface any planned implementation artifact that was neither applied nor an
 * intentionally-preserved stub. Metadata artifacts (`.arch/...`) are written by
 * the promotion step, not the patcher, so they are expected to be "skipped"
 * here and are explained rather than warned about.
 */
function reportUnexplainedSkips(
  plan: SyncPlanV1,
  applied: readonly string[],
  skippedStubs: readonly string[],
): void {
  const appliedSet = new Set(applied);
  const stubSet = new Set(skippedStubs);
  for (const action of plan.actions) {
    if (action.path.startsWith(".arch/")) continue; // written by promotion step
    if (appliedSet.has(action.path) || stubSet.has(action.path)) continue;
    if (action.kind === "no_op") continue;
    process.stderr.write(
      `arch apply: note: planned artifact not written by patcher: ${action.path} (kind=${action.kind})\n`,
    );
  }
}

/**
 * Persist the constrained-agent run records for an apply, so a reviewer can
 * audit which provider/model produced which patch, the task hash, the
 * independent validation verdict, and the outcome — `.arch/agent-runs/<id>.json`.
 */
async function persistAgentRuns(
  metadataDir: string,
  provider: AgentProvider,
  records: readonly AgentRunRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const dir = resolve(metadataDir, "agent-runs");
  await mkdir(dir, { recursive: true });
  const id = `agent-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomShort()}`;
  await atomicWriteJson(resolve(dir, `${id}.json`), {
    schema_version: "arch.agent-runs.v1",
    run_id: id,
    provider_id: provider.id,
    model_id: provider.model_id ?? "none",
    records,
  });
}

function findProjectRootSafe(): string | null {
  try {
    return findProjectRoot().root;
  } catch {
    return null;
  }
}

async function writeArtifactMetadata(
  artifactMapPath: string,
  ownershipPath: string,
  files: readonly GeneratedFile[],
  irHash: string,
): Promise<void> {
  // Per IMPLEMENTATION_PLAN §15.3, the artifact map carries schema_version,
  // ir_hash, and generator_version alongside the per-artifact entries.
  const generatorVersion = files[0]?.generator_id ?? "arch.generator.v1";
  const artifactMap = {
    schema_version: "arch.artifact-map.v1",
    ir_hash: irHash,
    generator_version: generatorVersion,
    entries: [...files]
      .sort((a, b) => (a.artifact_id < b.artifact_id ? -1 : 1))
      .map((f) => ({
        artifact_id: f.artifact_id,
        path: f.path,
        entity_ids: [...f.entity_ids],
        ir_fragment_hash: f.ir_fragment_hash,
        generator_id: f.generator_id,
        template_id: f.template_id ?? "",
      })),
  };

  // Per §15.4 the ownership map uses spec-compliant ownership_kind /
  // write_scope vocabulary (generated_file/extension_point + whole_file/
  // stub_only) — the same vocabulary the drift detector consumes.
  const ownership = {
    schema_version: "arch.ownership.v1",
    entries: [...files]
      .sort((a, b) => (a.artifact_id < b.artifact_id ? -1 : 1))
      .map((f) => ({
        artifact_id: f.artifact_id,
        ownership_kind: f.ownership_kind,
        write_scope: f.write_scope,
        content_hash: createHash("sha256").update(f.content).digest("hex"),
      })),
  };

  await atomicWriteJson(artifactMapPath, artifactMap);
  await atomicWriteJson(ownershipPath, ownership);
}

async function promoteCurrentSnapshot(metadataDir: string): Promise<void> {
  const { current, previous } = snapshotPaths(metadataDir);
  if (!existsSync(current)) return;
  await mkdir(dirname(previous), { recursive: true });
  // atomic copy
  const tmp = `${previous}.tmp.${process.pid}.${Date.now()}`;
  await copyFile(current, tmp);
  // Use atomicWriteText to land via rename — but we already have content;
  // simpler: read, then atomic write JSON.
  const text = await readFile(tmp, "utf8");
  await atomicWriteText(previous, text);
  // remove the staging copy
  try { await unlink(tmp); } catch { /* best-effort */ }
}

type PreviousSnapshotResult =
  | { readonly ok: true; readonly ir: CanonicalIR | null }
  | { readonly ok: false; readonly message: string };

async function readPreviousSnapshot(metadataDir: string): Promise<PreviousSnapshotResult> {
  const { previous } = snapshotPaths(metadataDir);
  if (!existsSync(previous)) return { ok: true, ir: null };

  try {
    const parsed = JSON.parse(await readFile(previous, "utf8")) as unknown;
    if (!isCanonicalIRSnapshot(parsed)) {
      return {
        ok: false,
        message: `ir.previous.json is corrupt or missing canonical_hash: ${previous}`,
      };
    }
    return { ok: true, ir: parsed };
  } catch (err) {
    return {
      ok: false,
      message: `failed to read ir.previous.json: ${describeError(err)}`,
    };
  }
}

type PlanSelectionResult =
  | { readonly ok: true; readonly plan: SyncPlanV1 | null }
  | { readonly ok: false; readonly message: string };

async function readApplicableLatestPlan(
  metadataDir: string,
  ir: CanonicalIR,
  previous: CanonicalIR | null,
): Promise<PlanSelectionResult> {
  if (!previous) return { ok: true, plan: null };

  const planPath = resolve(metadataDir, "plans", "latest.plan.json");
  if (!existsSync(planPath)) {
    return {
      ok: false,
      message: "incremental apply requires .arch/plans/latest.plan.json; run `arch plan` first",
    };
  }

  let plan: SyncPlanV1;
  try {
    plan = JSON.parse(await readFile(planPath, "utf8")) as SyncPlanV1;
  } catch (err) {
    return {
      ok: false,
      message: `failed to read latest plan: ${describeError(err)}`,
    };
  }

  if (plan.schema_version !== "arch.plan.v1") {
    return { ok: false, message: "latest plan has unsupported schema" };
  }
  if (!isUsablePlanShape(plan)) {
    return { ok: false, message: "latest plan is corrupt or incomplete" };
  }
  const planHash = computePlanHash(plan);
  if (plan.plan_hash !== planHash) {
    return {
      ok: false,
      message: "latest plan_hash does not match plan content; run `arch plan` again",
    };
  }
  if (plan.plan_id !== `plan.${plan.plan_hash.slice(0, 16)}`) {
    return {
      ok: false,
      message: "latest plan_id does not match plan_hash; run `arch plan` again",
    };
  }
  if (plan.target_ir_hash !== ir.canonical_hash) {
    return {
      ok: false,
      message: "latest plan target_ir_hash does not match current IR; run `arch plan` again",
    };
  }
  if (plan.base_ir_hash !== previous.canonical_hash) {
    return {
      ok: false,
      message: "latest plan base_ir_hash does not match ir.previous.json; run `arch plan` again",
    };
  }
  if (plan.diff.initial_generation) {
    return {
      ok: false,
      message: "latest plan is an initial-generation plan; incremental apply requires a non-initial plan",
    };
  }
  if (planRequiresConfirmation(plan)) {
    return {
      ok: false,
      message: "latest plan contains destructive or confirmation-required changes; apply refuses it by default",
    };
  }
  return { ok: true, plan };
}

function isCanonicalIRSnapshot(value: unknown): value is CanonicalIR {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { canonical_hash?: unknown }).canonical_hash !== undefined &&
    typeof (value as { canonical_hash?: unknown }).canonical_hash === "string"
  );
}

function planRequiresConfirmation(plan: SyncPlanV1): boolean {
  if (plan.destructive) return true;
  if (plan.confirmations_required.length > 0) return true;
  if (plan.actions.some((action) => action.destructive || action.requires_confirmation)) return true;
  return plan.diff_index.some(
    (diff) =>
      diff.requires_confirmation ||
      diff.risk === "destructive" ||
      diff.risk === "critical" ||
      diff.risk === "structural",
  );
}

function computePlanHash(plan: SyncPlanV1): string {
  const planBody = {
    schema_version: plan.schema_version,
    base_ir_hash: plan.base_ir_hash,
    target_ir_hash: plan.target_ir_hash,
    diff: plan.diff,
    diff_index: plan.diff_index,
    action_groups: plan.action_groups,
    actions: plan.actions,
    path_policy: plan.path_policy,
    verification: plan.verification,
    confirmations_required: plan.confirmations_required,
    destructive: plan.destructive,
  };
  return createHash("sha256").update(canonicalStringify(planBody)).digest("hex");
}

function isUsablePlanShape(plan: SyncPlanV1): boolean {
  return (
    typeof plan.base_ir_hash !== "undefined" &&
    typeof plan.plan_id === "string" &&
    typeof plan.plan_hash === "string" &&
    typeof plan.target_ir_hash === "string" &&
    typeof plan.destructive === "boolean" &&
    Array.isArray(plan.confirmations_required) &&
    Array.isArray(plan.actions) &&
    Array.isArray(plan.diff_index) &&
    typeof plan.diff === "object" &&
    plan.diff !== null &&
    typeof plan.diff.initial_generation === "boolean"
  );
}

function withRunId(result: VerificationRunResult, runId: string): VerificationRunResult {
  if (result.run_id === runId) return result;
  return { ...result, run_id: runId };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function randomShort(): string {
  return Math.random().toString(36).slice(2, 8);
}

// Re-export helpers used by tests / e2e harness.
export { writeArtifactMetadata as _writeArtifactMetadata };
