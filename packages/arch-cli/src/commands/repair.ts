/**
 * `arch repair` — bounded, allowlisted, verification-gated repair.
 *
 * Repair recovers a generated project that has drifted from intent: a generated
 * file was hand-edited, deleted, or a generated guarantee test was removed. It
 * regenerates ONLY the affected arch-owned generated files from the current
 * canonical IR (the source of truth), then re-runs verification. It is bounded
 * (max 3 attempts), never touches human-owned files (`src/custom/**`,
 * extension-point stubs), and never promotes metadata unless verification
 * passes.
 *
 * Because the ownership baseline hashes were recorded from `generate(IR)` and
 * repair regenerates from the same IR, regenerating a drifted file restores it
 * to its recorded baseline — resolving drift deterministically. The loop +
 * attempt cap is the M14 contract; deterministic regeneration converges in one
 * attempt, and a persistently-failing verify is surfaced after the cap.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { generate, type GeneratedFile } from "@arch/generator";
import { atomicWriteJson, atomicWriteText, metadataPaths } from "@arch/sync";
import {
  detectDrift,
  runInstall,
  verify,
  writeReports,
  type DriftEntry,
  type VerificationRunResult,
} from "@arch/verifier";
import { findProjectRoot } from "../project-root.js";
import { parseArchSource } from "./parse.js";

const MAX_ATTEMPTS = 3;

const REPAIRABLE_KINDS = new Set<DriftEntry["kind"]>([
  "generated_file_modified",
  "generated_file_missing",
  "missing_generated_test",
  "guarantee_static_pattern",
]);

export async function runRepair(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const root = args.cwd ?? findProjectRootSafe();
  if (!root) {
    process.stderr.write("arch repair: no backend.arch found in cwd or ancestors\n");
    // Exit 2 = generic precondition error, matching `arch plan`/`arch check`
    // and the spec's exit-code table (a missing project is not a usage error).
    return 2;
  }

  const archFile = resolve(root, "backend.arch");
  const metadataDir = args.metadataDir ?? resolve(root, ".arch");
  const outDir = args.outDir ? (isAbsolute(args.outDir) ? args.outDir : resolve(root, args.outDir)) : root;
  const maxAttempts = args.maxAttempts ?? MAX_ATTEMPTS;
  // `--max-attempts` with a missing or non-numeric value parses to NaN; without
  // this guard the bounded loop (`1 <= NaN`) runs zero attempts and reports
  // "unresolved after NaN attempt(s)". Reject it as a usage error instead.
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    process.stderr.write("arch repair: --max-attempts must be a positive integer\n");
    return 64;
  }
  const paths = metadataPaths(metadataDir);

  // Compile the current spec — the IR is the source of truth for regeneration.
  const source = await readFile(archFile, "utf8");
  const parsed = parseArchSource(source, archFile);
  if (!parsed.ok) {
    for (const d of parsed.diagnostics) {
      process.stderr.write(`${archFile}:${d.line}:${d.column} error ${d.code}: ${d.message}\n`);
    }
    return 65;
  }
  const ir = parsed.ir;

  // Identify drift. Only arch-owned generated files are repairable; the
  // generator's output tells us which paths are safe to overwrite (stub-only
  // extension points are excluded — repair never overwrites human files).
  const generated = generate(ir);
  const repairableByPath = new Map<string, GeneratedFile>();
  for (const f of generated.files) {
    if (f.write_scope === "whole_file" && f.ownership_kind === "generated_file") {
      repairableByPath.set(f.path, f);
    }
  }

  const initialDrift = await detectDrift(metadataDir, outDir, { ir }).catch((err: unknown) => {
    process.stderr.write(`arch repair: metadata error: ${describeError(err)}\n`);
    return null;
  });
  if (!initialDrift) return 70;

  const targets = uniqueRepairTargets(initialDrift.entries, repairableByPath);
  const skippedHumanOwned = initialDrift.entries.filter(
    (e) => REPAIRABLE_KINDS.has(e.kind) && !repairableByPath.has(e.path),
  );
  for (const s of skippedHumanOwned) {
    process.stderr.write(
      `arch repair: leaving human-owned / non-generated artifact untouched: ${s.path}\n`,
    );
  }

  if (targets.length === 0) {
    process.stdout.write("arch repair: no repairable generated-file drift detected\n");
    return 0;
  }

  process.stdout.write(`arch repair: ${targets.length} repairable artifact(s):\n`);
  for (const t of targets) process.stdout.write(`  - ${t.path}\n`);

  const history: RepairAttempt[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Regenerate every repair target deterministically from the IR.
    for (const t of targets) {
      const target = resolve(outDir, t.path);
      await mkdir(dirname(target), { recursive: true });
      await atomicWriteText(target, t.content);
    }

    const runId = `repair-${attempt}-${randomShort()}`;
    const runDir = resolve(paths.runsDir, runId);
    await mkdir(runDir, { recursive: true });

    const installResult = await runInstall({ projectRoot: outDir });
    if (!installResult.passed) {
      history.push({ attempt, outcome: "install_failed", detail: `exit ${installResult.exitCode}` });
      continue;
    }

    const runResult = withRunId(await verify({ projectRoot: outDir }), runId);
    await writeReports(runDir, runResult);

    // Re-check drift after regeneration.
    const postDrift = await detectDrift(metadataDir, outDir, { ir }).catch(() => null);
    const remaining = postDrift
      ? postDrift.entries.filter((e) => REPAIRABLE_KINDS.has(e.kind) && repairableByPath.has(e.path)).length
      : -1;

    if (runResult.passed && remaining === 0) {
      history.push({ attempt, outcome: "repaired", detail: `${targets.length} regenerated` });
      await writeRepairHistory(metadataDir, { resolved: true, attempts: history, targets: targets.map((t) => t.path) });
      process.stdout.write(`arch repair: succeeded on attempt ${attempt} (run ${runResult.run_id})\n`);
      return 0;
    }

    history.push({
      attempt,
      outcome: runResult.passed ? "drift_remaining" : "verify_failed",
      detail: runResult.passed ? `${remaining} drift entries remain` : (runResult.failure_reason ?? "unknown"),
    });
  }

  // Bounded: give up after maxAttempts, preserving the unresolved report.
  await writeRepairHistory(metadataDir, { resolved: false, attempts: history, targets: targets.map((t) => t.path) });
  process.stderr.write(`arch repair: unresolved after ${maxAttempts} attempt(s); see ${paths.drift} and .arch/repair-history\n`);
  return 70;
}

interface RepairAttempt {
  readonly attempt: number;
  readonly outcome: "repaired" | "verify_failed" | "install_failed" | "drift_remaining";
  readonly detail: string;
}

function uniqueRepairTargets(
  entries: readonly DriftEntry[],
  repairableByPath: ReadonlyMap<string, GeneratedFile>,
): GeneratedFile[] {
  const seen = new Set<string>();
  const out: GeneratedFile[] = [];
  for (const e of entries) {
    if (!REPAIRABLE_KINDS.has(e.kind)) continue;
    const file = repairableByPath.get(e.path);
    if (!file || seen.has(e.path)) continue;
    seen.add(e.path);
    out.push(file);
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

async function writeRepairHistory(
  metadataDir: string,
  record: { resolved: boolean; attempts: readonly RepairAttempt[]; targets: readonly string[] },
): Promise<void> {
  const dir = resolve(metadataDir, "repair-history");
  await mkdir(dir, { recursive: true });
  const id = `repair-${record.attempts.length}-${randomShort()}`;
  await atomicWriteJson(resolve(dir, `${id}.json`), {
    schema_version: "arch.repair-history.v1",
    resolved: record.resolved,
    targets: record.targets,
    attempts: record.attempts,
  });
}

interface CliArgs {
  readonly help: boolean;
  readonly cwd: string | undefined;
  readonly outDir: string | undefined;
  readonly metadataDir: string | undefined;
  readonly maxAttempts: number | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let help = false;
  let cwd: string | undefined;
  let outDir: string | undefined;
  let metadataDir: string | undefined;
  let maxAttempts: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--cwd") cwd = argv[++i];
    else if (a === "--out-dir") outDir = argv[++i];
    else if (a === "--metadata-dir") metadataDir = argv[++i];
    else if (a === "--max-attempts") maxAttempts = Number(argv[++i]);
  }
  return { help, cwd, outDir, metadataDir, maxAttempts };
}

const HELP = [
  "Usage: arch repair [--cwd <dir>] [--out-dir <dir>] [--metadata-dir <dir>] [--max-attempts <n>]",
  "",
  "Regenerate drifted/missing arch-owned generated files from the current IR,",
  "re-run verification, and promote on success. Bounded (default 3 attempts);",
  "never touches src/custom or human-owned files.",
  "",
].join("\n");

function findProjectRootSafe(): string | null {
  try {
    return findProjectRoot().root;
  } catch {
    return null;
  }
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
