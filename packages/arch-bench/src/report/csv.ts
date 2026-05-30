/** Flat CSV export of a {@link RunResults} — one row per BenchResult. */

import type { RunResults } from "./results.js";

const COLUMNS = [
  "taskId",
  "baseline",
  "repeat",
  "passed",
  "blocked",
  "durationMs",
  "filesTouched",
  "changedLoc",
  "expectedFilesTouched",
  "offScopeFilesTouched",
  "humanOwnedViolations",
  "generatedTestDeletedOrWeakened",
  "verificationPassed",
  "oraclePassed",
  "driftRecall",
  "repairSucceeded",
  "planDeterministic",
  "migrationDataPreserved",
  "provider",
  "model",
  "billingMode",
  "costUsd",
  "sessionId",
  "note",
] as const;

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(run: RunResults): string {
  const lines: string[] = [COLUMNS.join(",")];
  for (const r of run.results) {
    const row: Record<string, unknown> = {
      ...r,
      provider: r.llm?.provider,
      model: r.llm?.model,
      billingMode: r.llm?.billingMode,
      costUsd: r.llm?.costUsd,
      sessionId: r.llm?.sessionId,
    };
    lines.push(COLUMNS.map((c) => cell(row[c])).join(","));
  }
  return lines.join("\n") + "\n";
}
