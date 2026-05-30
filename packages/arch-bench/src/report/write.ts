/** Write the three run artifacts: results.json, results.csv, summary.md. */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toCsv } from "./csv.js";
import { toSummaryMarkdown, type TaskIndex } from "./summary.js";
import type { RunResults } from "./results.js";

export interface WrittenArtifacts {
  readonly resultsJson: string;
  readonly resultsCsv: string;
  readonly summaryMd: string;
}

export async function writeRunArtifacts(
  outDir: string,
  run: RunResults,
  taskIndex: TaskIndex,
): Promise<WrittenArtifacts> {
  await mkdir(outDir, { recursive: true });
  const resultsJson = resolve(outDir, "results.json");
  const resultsCsv = resolve(outDir, "results.csv");
  const summaryMd = resolve(outDir, "summary.md");

  await writeFile(resultsJson, JSON.stringify(run, null, 2) + "\n", "utf8");
  await writeFile(resultsCsv, toCsv(run), "utf8");
  await writeFile(summaryMd, toSummaryMarkdown(run, taskIndex), "utf8");

  return { resultsJson, resultsCsv, summaryMd };
}
