/**
 * Stage-then-promote metadata update.
 *
 * Apply executes in two phases:
 *
 *   1. **Stage**: `stageMetadata` writes the candidate `artifact-map.json`,
 *      `ownership.json`, and `source-map.json` to a sibling `staged/` dir
 *      under `.arch/`. Verification then runs against the freshly applied
 *      project.
 *
 *   2. **Promote**: `promoteStagedMetadata` is called ONLY after every
 *      verification step passes. It atomically renames the staged files
 *      into place, then promotes `ir.current.json → ir.previous.json`. If
 *      verification fails, the staged files are simply discarded; the
 *      previous IR baseline is left untouched.
 *
 * Atomicity: all file writes use the existing `atomicWriteJson` helper,
 * which writes to a temp file and renames into place. A failed promote is
 * never partially observable.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { atomicWriteJson } from "../atomic-write.js";
import { metadataPaths } from "../metadata-store.js";
import { snapshotPaths } from "../snapshots.js";

export interface StagedMetadataInputs {
  readonly artifactMap: unknown;
  readonly ownership: unknown;
  readonly sourceMap?: unknown;
}

export interface StageResult {
  readonly artifactMapStaged: string;
  readonly ownershipStaged: string;
  readonly sourceMapStaged?: string;
}

export interface PromoteResult {
  readonly promoted: readonly string[];
  readonly previousPromoted: boolean;
}

const STAGED_DIRNAME = "staged";

export async function stageMetadata(
  metadataDir: string,
  inputs: StagedMetadataInputs,
): Promise<StageResult> {
  const stagedDir = resolve(metadataDir, STAGED_DIRNAME);
  await mkdir(stagedDir, { recursive: true });

  const am = resolve(stagedDir, "artifact-map.json");
  const ow = resolve(stagedDir, "ownership.json");

  await atomicWriteJson(am, inputs.artifactMap);
  await atomicWriteJson(ow, inputs.ownership);

  let sm: string | undefined;
  if (inputs.sourceMap !== undefined) {
    sm = resolve(stagedDir, "source-map.json");
    await atomicWriteJson(sm, inputs.sourceMap);
  }

  return sm !== undefined
    ? { artifactMapStaged: am, ownershipStaged: ow, sourceMapStaged: sm }
    : { artifactMapStaged: am, ownershipStaged: ow };
}

export async function discardStagedMetadata(metadataDir: string): Promise<void> {
  const stagedDir = resolve(metadataDir, STAGED_DIRNAME);
  if (!existsSync(stagedDir)) return;
  await rm(stagedDir, { recursive: true, force: true });
}

/**
 * Atomically move staged files into place, then promote
 * `ir.current.json → ir.previous.json`. Caller must only invoke after
 * verification has passed.
 */
export async function promoteStagedMetadata(
  metadataDir: string,
): Promise<PromoteResult> {
  const promoted: string[] = [];
  const stagedDir = resolve(metadataDir, STAGED_DIRNAME);
  const paths = metadataPaths(metadataDir);

  if (!existsSync(stagedDir)) {
    return { promoted, previousPromoted: false };
  }

  const movePairs: { readonly from: string; readonly to: string }[] = [
    { from: resolve(stagedDir, "artifact-map.json"), to: paths.artifactMap },
    { from: resolve(stagedDir, "ownership.json"), to: paths.ownership },
    { from: resolve(stagedDir, "source-map.json"), to: paths.sourceMap },
  ];
  for (const pair of movePairs) {
    if (!existsSync(pair.from)) continue;
    await mkdir(dirname(pair.to), { recursive: true });
    await rename(pair.from, pair.to);
    promoted.push(pair.to);
  }

  // Clean staged dir.
  await rm(stagedDir, { recursive: true, force: true });

  // Promote ir.current.json → ir.previous.json.
  const snap = snapshotPaths(metadataDir);
  let previousPromoted = false;
  if (existsSync(snap.current)) {
    const text = await readFile(snap.current, "utf8");
    await mkdir(dirname(snap.previous), { recursive: true });
    await atomicWriteJson(snap.previous, JSON.parse(text));
    previousPromoted = true;
  }

  return { promoted, previousPromoted };
}

/**
 * Convenience: legacy hook used by very old call sites. Only runs when
 * verification has already passed; behaves like `promoteStagedMetadata` if
 * a `staged/` directory exists, otherwise just promotes the IR snapshot.
 */
export async function updateMetadataAfterSuccess(metadataDir: string): Promise<void> {
  await promoteStagedMetadata(metadataDir);
}

/**
 * Atomically copy a source file into a destination, going through a temp
 * file. Public for callers (e.g. CLI apply) that need the same primitive.
 */
export async function atomicCopy(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const tmp = `${destination}.tmp.${process.pid}.${Date.now()}`;
  try {
    await copyFile(source, tmp);
    await rename(tmp, destination);
  } catch (err) {
    try { await unlink(tmp); } catch { /* best-effort */ }
    throw err;
  }
}
