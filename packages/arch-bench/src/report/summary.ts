/**
 * Deterministic Markdown summary of a {@link RunResults}. Aggregates by
 * baseline, task kind, subject, and (for live baselines) per-task repeat
 * variance. Pure: same input → byte-identical output.
 */

import { BASELINE_IDS, TASK_KINDS, isLiveBaseline, type BaselineId } from "../manifest/schema.js";
import { EXTERNAL_OUTCOMES, isUnsupportedCapability } from "../external/schema.js";
import type { BenchResult, RunResults } from "./results.js";

export interface TaskIndexEntry {
  readonly subject: string;
  readonly kind: string;
}

export type TaskIndex = Record<string, TaskIndexEntry>;

function pct(num: number, den: number): string {
  if (den === 0) return "—";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function mean(values: readonly number[]): string {
  if (values.length === 0) return "—";
  const sum = values.reduce((a, b) => a + b, 0);
  return (sum / values.length).toFixed(1);
}

function meanOrBlank(values: readonly number[]): string {
  if (values.length === 0) return "—";
  const sum = values.reduce((a, b) => a + b, 0);
  return (sum / values.length).toFixed(4);
}

function uniqueText(values: readonly (string | undefined)[]): string {
  const uniq = [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))].sort();
  return uniq.length > 0 ? uniq.join("+") : "—";
}

function row(cells: readonly (string | number)[]): string {
  return `| ${cells.map(String).join(" | ")} |`;
}

function baselineOrder(a: BaselineId, b: BaselineId): number {
  return BASELINE_IDS.indexOf(a) - BASELINE_IDS.indexOf(b);
}

function byBaselineTable(results: readonly BenchResult[]): string {
  const baselines = [...new Set(results.map((r) => r.baseline))].sort(baselineOrder);
  const header = row([
    "Baseline",
    "Tasks",
    "Pass %",
    "Verify %",
    "Oracle %",
    "Mean files",
    "Mean LOC",
    "Mean off-scope",
    "Human viol.",
    "Tests weakened",
    "Providers",
    "Models",
    "Billing",
    "Mean $",
  ]);
  const sep = row(new Array(14).fill("---"));
  const rows = baselines.map((b) => {
    const rs = results.filter((r) => r.baseline === b);
    const costs = rs.map((r) => r.llm?.costUsd).filter((c): c is number => typeof c === "number");
    return row([
      b,
      rs.length,
      pct(rs.filter((r) => r.passed).length, rs.length),
      pct(rs.filter((r) => r.verificationPassed).length, rs.length),
      pct(rs.filter((r) => r.oraclePassed).length, rs.length),
      mean(rs.map((r) => r.filesTouched)),
      mean(rs.map((r) => r.changedLoc)),
      mean(rs.map((r) => r.offScopeFilesTouched)),
      rs.reduce((a, r) => a + r.humanOwnedViolations, 0),
      rs.filter((r) => r.generatedTestDeletedOrWeakened).length,
      uniqueText(rs.map((r) => r.llm?.provider)),
      uniqueText(rs.map((r) => r.llm?.model)),
      uniqueText(rs.map((r) => r.llm?.billingMode)),
      costs.length > 0 ? meanOrBlank(costs) : "—",
    ]);
  });
  return ["### By baseline", "", header, sep, ...rows, ""].join("\n");
}

function groupedTable(
  title: string,
  groupLabel: string,
  results: readonly BenchResult[],
  groupKeyOrder: readonly string[],
  groupKeyOf: (r: BenchResult) => string,
): string {
  const baselines = [...new Set(results.map((r) => r.baseline))].sort(baselineOrder);
  const groupKeys = [...new Set(results.map(groupKeyOf))].sort((a, b) => {
    const ia = groupKeyOrder.indexOf(a);
    const ib = groupKeyOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a < b ? -1 : 1;
  });
  const header = row([groupLabel, "Baseline", "Tasks", "Pass %", "Off-scope mean", "Human viol."]);
  const sep = row(["---", "---", "---", "---", "---", "---"]);
  const rows: string[] = [];
  for (const g of groupKeys) {
    for (const b of baselines) {
      const rs = results.filter((r) => groupKeyOf(r) === g && r.baseline === b);
      if (rs.length === 0) continue;
      rows.push(
        row([
          g,
          b,
          rs.length,
          pct(rs.filter((r) => r.passed).length, rs.length),
          mean(rs.map((r) => r.offScopeFilesTouched)),
          rs.reduce((a, r) => a + r.humanOwnedViolations, 0),
        ]),
      );
    }
  }
  return [`### ${title}`, "", header, sep, ...rows, ""].join("\n");
}

function liveVarianceTable(results: readonly BenchResult[], index: TaskIndex): string {
  const live = results.filter((r) => isLiveBaseline(r.baseline));
  if (live.length === 0) return "";
  const groups = new Map<string, BenchResult[]>();
  for (const r of live) {
    const key = repeatGroupKey(r.taskId, r.baseline);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const header = row(["Task", "Baseline", "Repeats", "Passes", "Agreement"]);
  const sep = row(["---", "---", "---", "---", "---"]);
  const keys = [...groups.keys()].sort();
  const rows = keys.map((key) => {
    const rs = groups.get(key)!;
    const [taskId, baseline] = key.split("::") as [string, BaselineId];
    const passes = rs.filter((r) => r.passed).length;
    const agreement = passes === 0 || passes === rs.length ? "stable" : "flaky";
    void index;
    return row([taskId, baseline, rs.length, `${passes}/${rs.length}`, agreement]);
  });
  return ["### Live-repeat variance", "", header, sep, ...rows, ""].join("\n");
}

function repeatGroupKey(taskId: string, baseline: BaselineId): string {
  return `${taskId}::${baseline}`;
}

function migrationCheckTable(results: readonly BenchResult[]): string {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.migrationCheckStatus === undefined) continue;
    counts.set(r.migrationCheckStatus, (counts.get(r.migrationCheckStatus) ?? 0) + 1);
  }
  const header = row(["dbCheck status", "Records"]);
  const sep = row(["---", "---"]);
  const rows =
    counts.size === 0
      ? [row(["(no migration tasks)", 0])]
      : [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([s, n]) => row([s, n]));
  return ["### Migration dbCheck status", "", header, sep, ...rows, ""].join("\n");
}

function guaranteeVerificationTable(results: readonly BenchResult[]): string {
  const counts = new Map<string, { passed: number; total: number }>();
  for (const r of results) {
    if (r.guaranteeVerification === undefined) continue;
    const cur = counts.get(r.guaranteeVerification) ?? { passed: 0, total: 0 };
    cur.total += 1;
    if (r.passed) cur.passed += 1;
    counts.set(r.guaranteeVerification, cur);
  }
  const header = row(["Verification", "Passed", "Total", "Pass %"]);
  const sep = row(["---", "---", "---", "---"]);
  const rows =
    counts.size === 0
      ? [row(["(no guarantee tasks)", 0, 0, "—"])]
      : [...counts.entries()]
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([v, { passed, total }]) => row([v, passed, total, pct(passed, total)]));
  return [
    "### Guarantee verification",
    "",
    "`declared_but_not_behaviorally_verified` guarantees are excluded from correctness claims.",
    "",
    header,
    sep,
    ...rows,
    "",
  ].join("\n");
}

/**
 * External-validation section, emitted ONLY when the run has external records
 * (rows with an `externalOutcome`). Internal-only runs produce no section, so
 * their summaries are unchanged. The full authorship/domain breakdown and the
 * fixture banner live in the dedicated `external-summary.md`.
 */
function externalSection(results: readonly BenchResult[]): string {
  const ext = results.filter((r) => r.externalOutcome !== undefined);
  if (ext.length === 0) return "";

  const outcomeCounts = new Map<string, number>();
  for (const r of ext) outcomeCounts.set(r.externalOutcome!, (outcomeCounts.get(r.externalOutcome!) ?? 0) + 1);
  const outcomeRows = EXTERNAL_OUTCOMES.filter((o) => outcomeCounts.has(o)).map((o) =>
    row([o, outcomeCounts.get(o) ?? 0]),
  );

  // Unsupported (capability-gap) rate by task kind.
  const kinds = [...new Set(ext.map((r) => r.taskKind ?? "(unknown)"))].sort();
  const kindRows = kinds.map((k) => {
    const rs = ext.filter((r) => (r.taskKind ?? "(unknown)") === k);
    const uns = rs.filter((r) => r.externalOutcome && isUnsupportedCapability(r.externalOutcome)).length;
    return row([k, rs.length, uns, pct(uns, rs.length)]);
  });

  const reasonCounts = new Map<string, number>();
  for (const r of ext) {
    if (!r.externalOutcome || !isUnsupportedCapability(r.externalOutcome)) continue;
    const reason = r.unsupportedReason ?? r.unsupportedDiffType ?? "unspecified";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const reasonRows = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([reason, n]) => row([reason, n]));

  const version = ext.find((r) => r.externalDatasetVersion)?.externalDatasetVersion;
  const hash = ext.find((r) => r.externalDatasetHash)?.externalDatasetHash;

  const parts: string[] = [
    "### External validation",
    "",
    "External authorship/domain breakdown and fixture status: see `external-summary.md`.",
    "",
  ];
  if (version) parts.push(`- External dataset version: \`${version}\``);
  if (hash) parts.push(`- External dataset hash: \`${hash}\``);
  if (version || hash) parts.push("");
  parts.push(
    "#### External outcomes",
    "",
    row(["Outcome", "Count"]),
    row(["---", "---"]),
    ...(outcomeRows.length > 0 ? outcomeRows : [row(["(none)", 0])]),
    "",
    "#### Unsupported rate by task kind",
    "",
    row(["Kind", "Total", "Unsupported", "Unsupported %"]),
    row(["---", "---", "---", "---"]),
    ...(kindRows.length > 0 ? kindRows : [row(["(none)", 0, 0, "—"])]),
    "",
    "#### Top unsupported reasons",
    "",
    row(["Reason", "Count"]),
    row(["---", "---"]),
    ...(reasonRows.length > 0 ? reasonRows : [row(["(none)", 0])]),
    "",
  );
  return parts.join("\n");
}

export function toSummaryMarkdown(run: RunResults, index: TaskIndex): string {
  const subjectOf = (r: BenchResult) => index[r.taskId]?.subject ?? "(unknown)";
  const kindOf = (r: BenchResult) => index[r.taskId]?.kind ?? "(unknown)";

  const total = run.results.length;
  const passed = run.results.filter((r) => r.passed).length;

  const parts: string[] = [
    `# Arch Bench Results — ${run.suite}`,
    "",
    `- Run: \`${run.runId}\``,
    `- Created: ${run.createdAt}`,
    `- Manifest: \`${run.manifestVersion}\``,
    `- Records: ${total} (overall pass ${pct(passed, total)})`,
    "",
    byBaselineTable(run.results),
    groupedTable("By task kind", "Kind", run.results, TASK_KINDS, kindOf),
    groupedTable("By subject", "Subject", run.results, [], subjectOf),
    migrationCheckTable(run.results),
    guaranteeVerificationTable(run.results),
  ];
  const variance = liveVarianceTable(run.results, index);
  if (variance) parts.push(variance);

  const external = externalSection(run.results);
  if (external) parts.push(external);

  return parts.join("\n").replace(/\n+$/, "\n");
}
