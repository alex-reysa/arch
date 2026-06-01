import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { BenchManifest } from "../manifest/schema.js";
import { buildRunResults, type BenchResult, type RunMeta, type RunResults } from "./results.js";
import { mergeRunResults } from "./merge.js";

export async function recoverRunResultsFromArtifacts(
  outDir: string,
  manifest: BenchManifest,
  meta: RunMeta,
): Promise<RunResults> {
  const results = await collectResultArtifacts(outDir);
  if (results.length === 0) {
    throw new Error(`no per-task result artifacts found under ${resolve(outDir, "logs")}`);
  }
  return mergeRunResults([buildRunResults(meta, results)], manifest, {
    runId: meta.runId,
    createdAt: meta.createdAt,
  });
}

export async function collectResultArtifacts(outDir: string): Promise<BenchResult[]> {
  const logsDir = resolve(outDir, "logs");
  const files = await walkFiles(logsDir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  });
  const results: BenchResult[] = [];
  for (const file of files.filter((f) => f.endsWith(".result.json")).sort()) {
    const raw = await readFile(file, "utf8");
    try {
      results.push(JSON.parse(raw) as BenchResult);
    } catch (err) {
      throw new Error(`failed to parse result artifact ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return results;
}

async function walkFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const p = resolve(root, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(p)));
    else if (entry.isFile()) out.push(p);
    else {
      const s = await stat(p).catch(() => undefined);
      if (s?.isFile()) out.push(p);
    }
  }
  return out;
}
