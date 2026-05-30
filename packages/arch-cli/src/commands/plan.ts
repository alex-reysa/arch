/**
 * `arch plan` — compute the typed diff between the previously-applied IR
 * (`ir.previous.json`) and the freshly-parsed `ir.current.json`, build a
 * `SyncPlanV1`, and write it to `.arch/plans/<plan-id>.plan.json` plus a
 * Markdown summary alongside.
 *
 * The command is read-only: it never writes implementation files. It also
 * never runs the verifier, mutates ownership, or promotes IR snapshots.
 *
 * Exit codes follow `SYNC_ENGINE_SPEC.md` §24.1.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import {
  buildPlanV1,
  diffIRV1,
  summarizePlanV1,
  type DiffV1Envelope,
} from "@arch/sync";
import { findProjectRoot } from "../project-root.js";
import { parseArchSource } from "./parse.js";

export async function runPlan(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const root = args.cwd ?? findProjectRootSafe();
  if (!root) {
    process.stderr.write("arch plan: no backend.arch found in cwd or ancestors\n");
    return 2;
  }

  const archFile = resolve(root, "backend.arch");
  const metadataDir = args.metadataDir ?? resolve(root, ".arch");

  const source = await readFile(archFile, "utf8");
  const parsed = parseArchSource(source, archFile);
  if (!parsed.ok) {
    for (const d of parsed.diagnostics) {
      process.stderr.write(`${archFile}:${d.line}:${d.column} error ${d.code}: ${d.message}\n`);
    }
    return 2;
  }
  const current = parsed.ir;

  // Always (re)write ir.current.json before producing a plan, so reviewers
  // can trust that the plan was built against this specific IR.
  await mkdir(metadataDir, { recursive: true });
  await writeFile(
    resolve(metadataDir, "ir.current.json"),
    JSON.stringify(current, null, 2) + "\n",
    "utf8",
  );

  const previousPath = resolve(metadataDir, "ir.previous.json");
  const previous = existsSync(previousPath)
    ? (JSON.parse(await readFile(previousPath, "utf8")) as CanonicalIR)
    : null;

  const result = diffIRV1(previous, current);
  const blockingDiagnostics = result.diagnostics;
  for (const d of blockingDiagnostics) {
    process.stderr.write(`arch plan: blocked: ${d.code}: ${d.message}\n`);
  }
  if (blockingDiagnostics.length > 0) return 1;

  const envelope: DiffV1Envelope = result.envelope;
  const plan = buildPlanV1({ previous, current, diff: envelope });

  const plansDir = resolve(metadataDir, "plans");
  await mkdir(plansDir, { recursive: true });
  const planJsonPath = resolve(plansDir, `${plan.plan_id}.plan.json`);
  const planMdPath = resolve(plansDir, `${plan.plan_id}.plan.md`);
  await writeFile(planJsonPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  await writeFile(planMdPath, summarizePlanV1(plan), "utf8");

  // Mirror the latest plan to a stable filename for tooling.
  await writeFile(
    resolve(plansDir, "latest.plan.json"),
    JSON.stringify(plan, null, 2) + "\n",
    "utf8",
  );

  process.stdout.write(`arch plan: ${plan.plan_id}\n`);
  process.stdout.write(`  diffs: ${envelope.diffs.length}\n`);
  process.stdout.write(`  affected files: ${plan.actions.length}\n`);
  process.stdout.write(`  plan json: ${planJsonPath}\n`);
  process.stdout.write(`  plan md:   ${planMdPath}\n`);

  return 0;
}

interface CliArgs {
  readonly help: boolean;
  readonly cwd: string | undefined;
  readonly metadataDir: string | undefined;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let help = false;
  let cwd: string | undefined;
  let metadataDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--cwd") cwd = absolutize(argv[++i]);
    else if (a === "--metadata-dir") metadataDir = absolutize(argv[++i]);
  }
  return { help, cwd, metadataDir };
}

function absolutize(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

const HELP = [
  "Usage: arch plan [--cwd <dir>] [--metadata-dir <dir>]",
  "",
  "Compute the typed diff vs ir.previous.json and write a SyncPlanV1.",
  "",
  "  --cwd <dir>           Project root (defaults to current working directory)",
  "  --metadata-dir <dir>  Override the .arch directory",
  "",
].join("\n");

function findProjectRootSafe(): string | null {
  try {
    return findProjectRoot().root;
  } catch {
    return null;
  }
}
