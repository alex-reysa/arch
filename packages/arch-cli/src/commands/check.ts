/**
 * `arch check` — drift, ownership, and metadata-integrity audit.
 *
 *  - Reads `.arch/artifact-map.json` and `.arch/ownership.json`.
 *  - Walks every arch-owned generated file and re-hashes it.
 *  - Reports `generated_file_modified`, `generated_file_missing`, and
 *    `missing_generated_test` drift entries with artifact + entity IDs.
 *  - Writes the structured report to `.arch/drift.json` and prints a
 *    human-readable summary on stderr.
 *
 * Exit codes follow `SYNC_ENGINE_SPEC.md` §24.3:
 *   0  — no drift detected
 *   1  — drift detected (report written)
 *   2  — invalid input or metadata corruption
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { detectDrift } from "@arch/verifier";
import { findProjectRoot } from "../project-root.js";
import { parseArchSource } from "./parse.js";

export async function runCheck(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const root = args.cwd ?? findProjectRootSafe();
  if (!root) {
    process.stderr.write("arch check: no backend.arch found in cwd or ancestors\n");
    return 2;
  }

  const metadataDir = args.metadataDir ?? resolve(root, ".arch");

  // Best-effort compile of the current spec so drift checks can be
  // guarantee-aware (static pattern + missing-guarantee-test) and so we can
  // refresh .arch/source-map.json. A compile failure does not abort the
  // hash-based drift check.
  let ir: CanonicalIR | undefined;
  const archFile = resolve(root, "backend.arch");
  if (existsSync(archFile)) {
    const parsed = parseArchSource(await readFile(archFile, "utf8"), archFile);
    if (parsed.ok) ir = parsed.ir;
  }

  const report = await detectDrift(metadataDir, root, ir ? { ir } : {}).catch((err: unknown) => {
    process.stderr.write(`arch check: metadata error: ${describeError(err)}\n`);
    return null;
  });
  if (!report) return 2;

  await mkdir(metadataDir, { recursive: true });
  const driftPath = resolve(metadataDir, "drift.json");
  await writeFile(driftPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  // Refresh the entity → source-span map (§15.5) from the compiled IR.
  if (ir) {
    await writeFile(
      resolve(metadataDir, "source-map.json"),
      JSON.stringify(
        { schema_version: "arch.source-map.v1", entries: ir.source_locations },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  }

  if (report.entries.length === 0) {
    process.stdout.write("arch check: no drift detected\n");
    return 0;
  }

  process.stderr.write(`arch check: ${report.entries.length} drift entr${report.entries.length === 1 ? "y" : "ies"} detected\n`);
  for (const e of report.entries) {
    process.stderr.write(
      `  - ${e.kind} ${e.path} (artifact=${e.artifact_id}, entities=[${e.entity_ids.join(", ")}])\n`,
    );
  }
  process.stderr.write(`drift report: ${driftPath}\n`);
  return 1;
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
  "Usage: arch check [--cwd <dir>] [--metadata-dir <dir>]",
  "",
  "Detect drift between ownership.json and on-disk arch-owned files.",
  "",
].join("\n");

function findProjectRootSafe(): string | null {
  try {
    return findProjectRoot().root;
  } catch {
    return null;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
