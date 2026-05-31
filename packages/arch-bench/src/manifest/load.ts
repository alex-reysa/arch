/**
 * Load + resolve a {@link BenchManifest} from disk. Runs the pure structural
 * {@link validateManifest} and additionally checks that every referenced spec,
 * oracle, drift, and db-check file actually exists relative to the manifest
 * directory (the `benchmarks/` root).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateManifest } from "./validate.js";
import type { BenchManifest, BenchTask } from "./schema.js";
import type { TaskIndex } from "../report/summary.js";

export interface LoadedManifest {
  readonly manifest: BenchManifest;
  /** Directory the manifest lives in; all task paths resolve against it. */
  readonly dir: string;
  readonly path: string;
}

export class ManifestError extends Error {}

export async function loadManifest(manifestPath: string): Promise<LoadedManifest> {
  const path = resolve(manifestPath);
  if (!existsSync(path)) throw new ManifestError(`manifest not found: ${path}`);
  const dir = dirname(path);

  let manifest: BenchManifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8")) as BenchManifest;
  } catch (err) {
    throw new ManifestError(`failed to parse manifest JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const structural = validateManifest(manifest);
  const errors = [...structural.errors];

  // On-disk existence of referenced files.
  for (const s of manifest.subjects ?? []) {
    if (s.baseSpec && !existsSync(resolve(dir, s.baseSpec))) {
      errors.push(`subject ${s.id}: baseSpec not found on disk: ${s.baseSpec}`);
    }
  }
  for (const t of manifest.tasks ?? []) {
    for (const rel of [t.fromSpec, t.toSpec]) {
      if (rel && !existsSync(resolve(dir, rel))) errors.push(`task ${t.id}: spec not found on disk: ${rel}`);
    }
    for (const rel of [...(t.oracleTests ?? []), ...(t.driftScripts ?? [])]) {
      if (rel && !existsSync(resolve(dir, rel))) errors.push(`task ${t.id}: file not found on disk: ${rel}`);
    }
    if (t.dbCheck && !existsSync(resolve(dir, t.dbCheck))) {
      errors.push(`task ${t.id}: dbCheck not found on disk: ${t.dbCheck}`);
    }
    if (t.guaranteeAssertion && !existsSync(resolve(dir, t.guaranteeAssertion))) {
      errors.push(`task ${t.id}: guaranteeAssertion not found on disk: ${t.guaranteeAssertion}`);
    }
  }

  if (errors.length > 0) {
    throw new ManifestError(`invalid manifest ${path}:\n  - ${errors.join("\n  - ")}`);
  }

  return { manifest, dir, path };
}

export function resolvePath(loaded: LoadedManifest, relPath: string): string {
  return resolve(loaded.dir, relPath);
}

export async function readSpecSource(loaded: LoadedManifest, relPath: string): Promise<string> {
  return readFile(resolvePath(loaded, relPath), "utf8");
}

export function tasksForSubject(manifest: BenchManifest, subjectId: string): BenchTask[] {
  return manifest.tasks.filter((t) => t.subject === subjectId).sort((a, b) => a.order - b.order);
}

export function buildTaskIndex(manifest: BenchManifest): TaskIndex {
  const index: Record<string, { subject: string; kind: string }> = {};
  for (const t of manifest.tasks) index[t.id] = { subject: t.subject, kind: t.kind };
  return index;
}
