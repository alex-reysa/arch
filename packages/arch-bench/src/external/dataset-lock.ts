/**
 * External dataset hash/version lock (roadmap Phase 2).
 *
 * Once an external service is imported, its manifest + referenced specs are
 * content-hashed. Any post-import modification must bump `datasetVersion` and be
 * reported. The lock is the frozen record checked before a final validation run.
 *
 * Hashing is PURE (operates on provided file contents). The fs-touching loader
 * lives in `./load.ts`. Timestamps are passed in, never read here, so the lock
 * is reproducible.
 */

import { createHash } from "node:crypto";

export const DATASET_LOCK_SCHEMA_VERSION = "arch.bench.external.lock.v1" as const;

/** Logical content of a dataset for hashing: the manifest plus referenced files. */
export interface DatasetContent {
  readonly datasetVersion: string;
  /** Relative path → file content (manifest JSON + every referenced spec). */
  readonly files: Readonly<Record<string, string>>;
}

export interface DatasetHash {
  /** Overall sha256 over the canonical (path-sorted) file set. */
  readonly hash: string;
  /** Per-file sha256, so edits are attributable to a specific file. */
  readonly fileHashes: Readonly<Record<string, string>>;
}

export interface DatasetLock extends DatasetHash {
  readonly schema_version: typeof DATASET_LOCK_SCHEMA_VERSION;
  readonly datasetVersion: string;
  /** ISO timestamp the lock was written (supplied by the caller). */
  readonly lockedAt: string;
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeDatasetHash(content: DatasetContent): DatasetHash {
  const fileHashes: Record<string, string> = {};
  const paths = Object.keys(content.files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const canonical = createHash("sha256");
  // Bind the hash to the declared dataset version so a version bump alone is a
  // distinct hash even if files are byte-identical.
  canonical.update(`datasetVersion:${content.datasetVersion}\n`, "utf8");
  for (const path of paths) {
    const fileHash = sha256(content.files[path] ?? "");
    fileHashes[path] = fileHash;
    canonical.update(`${path}\0${fileHash}\n`, "utf8");
  }
  return { hash: canonical.digest("hex"), fileHashes };
}

export function buildDatasetLock(content: DatasetContent, lockedAt: string): DatasetLock {
  const { hash, fileHashes } = computeDatasetHash(content);
  return {
    schema_version: DATASET_LOCK_SCHEMA_VERSION,
    datasetVersion: content.datasetVersion,
    hash,
    fileHashes,
    lockedAt,
  };
}

export interface DatasetLockDiff {
  /** Whether the content hash changed vs the lock. */
  readonly changed: boolean;
  /** Whether `datasetVersion` changed vs the lock. */
  readonly versionChanged: boolean;
  readonly modifiedFiles: readonly string[];
  readonly addedFiles: readonly string[];
  readonly removedFiles: readonly string[];
  /**
   * A POLICY VIOLATION: content changed but `datasetVersion` was not bumped.
   * Post-import edits must create a new dataset version and be disclosed.
   */
  readonly unversionedChange: boolean;
}

/** Compare a previously written lock against the current on-disk content. */
export function diffDatasetLock(previous: DatasetLock, current: DatasetContent): DatasetLockDiff {
  const cur = computeDatasetHash(current);
  const prevPaths = new Set(Object.keys(previous.fileHashes));
  const curPaths = new Set(Object.keys(cur.fileHashes));

  const modifiedFiles: string[] = [];
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];

  for (const path of curPaths) {
    if (!prevPaths.has(path)) addedFiles.push(path);
    else if (previous.fileHashes[path] !== cur.fileHashes[path]) modifiedFiles.push(path);
  }
  for (const path of prevPaths) {
    if (!curPaths.has(path)) removedFiles.push(path);
  }

  const changed = cur.hash !== previous.hash;
  const versionChanged = current.datasetVersion !== previous.datasetVersion;
  // Content (files) changed but the version did not → unversioned change.
  const fileSetChanged = modifiedFiles.length > 0 || addedFiles.length > 0 || removedFiles.length > 0;
  return {
    changed,
    versionChanged,
    modifiedFiles: modifiedFiles.sort(),
    addedFiles: addedFiles.sort(),
    removedFiles: removedFiles.sort(),
    unversionedChange: fileSetChanged && !versionChanged,
  };
}
