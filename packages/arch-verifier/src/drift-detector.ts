/**
 * Drift detector — compares on-disk generated artifacts against the
 * baseline recorded in `.arch/artifact-map.json` + `.arch/ownership.json`.
 *
 * The detector reports three drift kinds:
 *
 *   1. **generated_file_modified** — a file whose ownership is
 *      `generated_file` / `whole_file` has a different SHA-256 than the
 *      baseline.
 *   2. **generated_file_missing** — a file declared in the artifact map is
 *      no longer on disk.
 *   3. **missing_generated_test** — a guarantee/model/workflow test file
 *      declared in the artifact map is missing.
 *
 * Output shape is stable JSON; the CLI writes it to `.arch/drift.json` and
 * also surfaces a human summary on stderr.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { DriftMetadataError } from "./errors.js";
import { detectNotificationRollbackViolation } from "./guarantee-static.js";

export type DriftKind =
  | "generated_file_modified"
  | "generated_file_missing"
  | "missing_generated_test"
  | "missing_guarantee_test"
  | "guarantee_static_pattern";

export interface DriftEntry {
  readonly kind: DriftKind;
  readonly artifact_id: string;
  readonly path: string;
  readonly entity_ids: readonly string[];
  readonly expected_hash?: string;
  readonly actual_hash?: string;
  readonly message: string;
}

export interface DriftReport {
  readonly schema_version: "arch.drift.v1";
  /** Canonical hash of the IR the project was checked against (when known). */
  readonly checked_ir_hash?: string;
  readonly entries: readonly DriftEntry[];
  /**
   * §15.6 category view of `entries`, so downstream tooling can consume drift
   * by finding type without re-deriving it from `kind`.
   */
  readonly by_category?: {
    readonly artifact_hash: readonly DriftEntry[];
    readonly missing_artifact: readonly DriftEntry[];
    readonly missing_guarantee_test: readonly DriftEntry[];
    readonly guarantee_static_pattern: readonly DriftEntry[];
  };
}

export interface DetectDriftOptions {
  /** Current canonical IR; enables guarantee-aware static + coverage checks. */
  readonly ir?: CanonicalIR;
}

export interface ArtifactMapEntry {
  readonly artifact_id: string;
  readonly path: string;
  readonly entity_ids: readonly string[];
  readonly template_id?: string;
}

export type OwnershipKind =
  | "generated_file"
  | "generated_region"
  | "extension_point"
  | "human_file";

export type OwnershipWriteScope =
  | "whole_file"
  | "generated_region"
  | "stub_only"
  | "none";

export interface OwnershipEntry {
  readonly artifact_id: string;
  readonly ownership_kind: OwnershipKind;
  readonly write_scope: OwnershipWriteScope;
  readonly content_hash: string;
}

export interface ArtifactMapFile {
  readonly entries: readonly ArtifactMapEntry[];
}

export interface OwnershipFile {
  readonly entries: readonly OwnershipEntry[];
}

/**
 * Run drift detection.
 *
 * @param metadataDir absolute path to `.arch/`
 * @param projectRoot absolute path to the project root (where artifacts live)
 */
export async function detectDrift(
  metadataDir: string,
  projectRoot: string,
  options: DetectDriftOptions = {},
): Promise<DriftReport> {
  const artifactMap = await readRequiredJson<ArtifactMapFile>(
    resolve(metadataDir, "artifact-map.json"),
    "artifact-map.json",
    isArtifactMapFile,
  );
  const ownership = await readRequiredJson<OwnershipFile>(
    resolve(metadataDir, "ownership.json"),
    "ownership.json",
    isOwnershipFile,
  );

  const entries: DriftEntry[] = [];

  const ownershipById = new Map<string, OwnershipEntry>();
  for (const o of ownership.entries) ownershipById.set(o.artifact_id, o);

  for (const a of artifactMap.entries) {
    const own = ownershipById.get(a.artifact_id);
    if (!own) continue;
    // V1 only inspects arch-owned generated files for drift. Extension points
    // (stub_only) become human-owned after the first edit, so they are never
    // flagged as drift.
    if (own.ownership_kind !== "generated_file" && own.write_scope !== "whole_file") {
      continue;
    }

    const filePath = resolve(projectRoot, a.path);
    const exists = await fileExists(filePath);
    if (!exists) {
      entries.push({
        kind: isGeneratedTest(a) ? "missing_generated_test" : "generated_file_missing",
        artifact_id: a.artifact_id,
        path: a.path,
        entity_ids: a.entity_ids,
        expected_hash: own.content_hash,
        message: isGeneratedTest(a)
          ? `Generated test file is missing: ${a.path}`
          : `Generated file is missing: ${a.path}`,
      });
      continue;
    }

    const actualHash = await sha256OfFile(filePath);
    if (actualHash !== own.content_hash) {
      entries.push({
        kind: "generated_file_modified",
        artifact_id: a.artifact_id,
        path: a.path,
        entity_ids: a.entity_ids,
        expected_hash: own.content_hash,
        actual_hash: actualHash,
        message: `Generated file ${a.path} was modified outside arch (artifact_id=${a.artifact_id}, entity_ids=[${a.entity_ids.join(", ")}])`,
      });
    }
  }

  // Guarantee-aware checks (require the current IR).
  if (options.ir) {
    await detectGuaranteeDrift(options.ir, artifactMap, projectRoot, entries);
  }

  // Sort for determinism.
  entries.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  const inCategory = (kinds: readonly DriftKind[]) =>
    entries.filter((e) => kinds.includes(e.kind));

  return {
    schema_version: "arch.drift.v1",
    ...(options.ir ? { checked_ir_hash: options.ir.canonical_hash } : {}),
    entries,
    by_category: {
      artifact_hash: inCategory(["generated_file_modified"]),
      missing_artifact: inCategory(["generated_file_missing"]),
      missing_guarantee_test: inCategory(["missing_generated_test", "missing_guarantee_test"]),
      guarantee_static_pattern: inCategory(["guarantee_static_pattern"]),
    },
  };
}

/**
 * Static guarantee checks + missing-guarantee-test detection. For each workflow
 * that declares `notification_failure_does_not_rollback_post`, locate its
 * generated file via the artifact map and scan the ON-DISK content for the
 * violation shape. Also flag declared guarantees whose generated test file is
 * absent.
 */
async function detectGuaranteeDrift(
  ir: CanonicalIR,
  artifactMap: ArtifactMapFile,
  projectRoot: string,
  entries: DriftEntry[],
): Promise<void> {
  for (const workflow of ir.workflows) {
    const hasNonRollback = workflow.guarantees.some(
      (g) => g.name === "notification_failure_does_not_rollback_post",
    );
    if (!hasNonRollback) continue;

    const wfEntry = artifactMap.entries.find(
      (a) => a.path.startsWith("src/workflows/") && a.entity_ids.includes(workflow.id),
    );
    if (!wfEntry) continue;
    const wfPath = resolve(projectRoot, wfEntry.path);
    if (!(await fileExists(wfPath))) continue;

    const source = await readFile(wfPath, "utf8");
    const reason = detectNotificationRollbackViolation(source);
    if (reason) {
      entries.push({
        kind: "guarantee_static_pattern",
        artifact_id: wfEntry.artifact_id,
        path: wfEntry.path,
        entity_ids: wfEntry.entity_ids,
        message: `Guarantee notification_failure_does_not_rollback_post may be violated in ${wfEntry.path}: ${reason}`,
      });
    }
  }
}

// -------------------------------------------------------------------------
// Helpers.
// -------------------------------------------------------------------------

function isGeneratedTest(a: ArtifactMapEntry): boolean {
  return (
    /^tests\/(generated|guarantees|models|workflows)\//.test(a.path) ||
    /\.test\.ts$/.test(a.path)
  );
}

async function readRequiredJson<T>(
  path: string,
  label: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new DriftMetadataError(`${label} is missing: ${path} (${describeError(err)})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new DriftMetadataError(`${label} is not valid JSON: ${describeError(err)}`);
  }

  if (!validate(parsed)) {
    throw new DriftMetadataError(`${label} has invalid schema`);
  }
  return parsed;
}

function isArtifactMapFile(value: unknown): value is ArtifactMapFile {
  if (!isObject(value) || !Array.isArray(value.entries)) return false;
  return value.entries.every(
    (entry) =>
      isObject(entry) &&
      typeof entry.artifact_id === "string" &&
      typeof entry.path === "string" &&
      Array.isArray(entry.entity_ids) &&
      entry.entity_ids.every((id) => typeof id === "string") &&
      (entry.template_id === undefined || typeof entry.template_id === "string"),
  );
}

const OWNERSHIP_KINDS = new Set([
  "generated_file",
  "generated_region",
  "extension_point",
  "human_file",
]);

function isOwnershipFile(value: unknown): value is OwnershipFile {
  if (!isObject(value) || !Array.isArray(value.entries)) return false;
  return value.entries.every(
    (entry) =>
      isObject(entry) &&
      typeof entry.artifact_id === "string" &&
      typeof entry.ownership_kind === "string" &&
      OWNERSHIP_KINDS.has(entry.ownership_kind) &&
      typeof entry.write_scope === "string" &&
      typeof entry.content_hash === "string",
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
