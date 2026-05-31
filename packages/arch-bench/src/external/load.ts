/**
 * Load + resolve an {@link ExternalManifest} from disk, run structural
 * validation, and check that every referenced spec exists. Also assembles the
 * {@link DatasetContent} (manifest JSON + referenced specs) used to hash/lock
 * the dataset.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { validateExternalManifest } from "./validate.js";
import type { ExternalManifest } from "./schema.js";
import type { DatasetContent } from "./dataset-lock.js";

export interface LoadedExternalManifest {
  readonly manifest: ExternalManifest;
  readonly dir: string;
  readonly path: string;
}

export class ExternalManifestError extends Error {}

export async function loadExternalManifest(manifestPath: string): Promise<LoadedExternalManifest> {
  const path = resolve(manifestPath);
  if (!existsSync(path)) throw new ExternalManifestError(`external manifest not found: ${path}`);
  const dir = dirname(path);

  let manifest: ExternalManifest;
  try {
    manifest = JSON.parse(await readFile(path, "utf8")) as ExternalManifest;
  } catch (err) {
    throw new ExternalManifestError(
      `failed to parse external manifest JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const structural = validateExternalManifest(manifest);
  const errors = [...structural.errors];

  for (const s of manifest.services ?? []) {
    if (s.baseSpec && !existsSync(resolve(dir, s.baseSpec))) {
      errors.push(`service ${s.id}: baseSpec not found on disk: ${s.baseSpec}`);
    }
  }
  for (const e of manifest.evolutions ?? []) {
    for (const rel of [e.fromSpec, e.toSpec]) {
      if (rel && !existsSync(resolve(dir, rel))) errors.push(`evolution ${e.id}: spec not found on disk: ${rel}`);
    }
  }

  if (errors.length > 0) {
    throw new ExternalManifestError(`invalid external manifest ${path}:\n  - ${errors.join("\n  - ")}`);
  }
  return { manifest, dir, path };
}

/**
 * Assemble the content to hash/lock: the manifest JSON plus every referenced
 * spec, keyed by manifest-relative POSIX path. Missing files are skipped (the
 * loader already validated existence; this is defensive for direct callers).
 */
export async function readDatasetContent(loaded: LoadedExternalManifest): Promise<DatasetContent> {
  const files: Record<string, string> = {};
  const manifestRel = toPosix(relative(loaded.dir, loaded.path)) || "manifest.json";
  files[manifestRel] = await readFile(loaded.path, "utf8");

  const specRels = new Set<string>();
  for (const s of loaded.manifest.services ?? []) if (s.baseSpec) specRels.add(s.baseSpec);
  for (const e of loaded.manifest.evolutions ?? []) {
    if (e.fromSpec) specRels.add(e.fromSpec);
    if (e.toSpec) specRels.add(e.toSpec);
  }
  for (const rel of [...specRels].sort()) {
    const abs = resolve(loaded.dir, rel);
    if (existsSync(abs)) files[toPosix(rel)] = await readFile(abs, "utf8");
  }

  return { datasetVersion: loaded.manifest.datasetVersion, files };
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
