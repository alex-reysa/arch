/**
 * External-validation reporting: derive classified {@link ExternalResultRow}s
 * (from a real run's {@link BenchResult}s or from a fixture's declared
 * expectations), build per-failure analyses, and render the external summary.
 *
 * The summary always carries a fixture/demo banner when the dataset is fixture
 * data so it can never be mistaken for external evidence.
 */

import type { BenchResult } from "../report/results.js";
import { buildFailureAnalysis, classifyExternalOutcome, type ExternalSignals } from "./classify.js";
import { computeExternalMetrics, type ExternalMetrics, type ExternalResultRow } from "./metrics.js";
import {
  type ExternalEvolution,
  type ExternalFailureAnalysis,
  type ExternalManifest,
  type ExternalOutcome,
  type ExternalService,
} from "./schema.js";

function serviceIndex(manifest: ExternalManifest): Map<string, ExternalService> {
  const m = new Map<string, ExternalService>();
  for (const s of manifest.services) m.set(s.id, s);
  return m;
}

function evolutionIndex(manifest: ExternalManifest): Map<string, ExternalEvolution> {
  const m = new Map<string, ExternalEvolution>();
  for (const e of manifest.evolutions) m.set(e.id, e);
  return m;
}

/** Classify one real run record into an external outcome, using author annotation for block kind. */
export function classifyBenchResult(result: BenchResult, evolution: ExternalEvolution): ExternalOutcome {
  // A block is a capability gap only if the evolution is annotated as one (Arch
  // does not yet emit a structured "unsupported capability" signal): either via
  // the explicit `unsupportedDiffType` or the structured `unsupportedReason.code`.
  const diffType = evolution.unsupportedDiffType ?? evolution.unsupportedReason?.code;
  // Off-scope churn is only meaningful when the evolution declares an expected
  // affected-path allowlist. External evolutions usually don't, so EVERY
  // legitimately-generated file would look "off-scope" — never penalize that as
  // excessive churn. `expectedFilesTouched > 0` means an allowlist matched.
  const churnMeaningful = result.expectedFilesTouched > 0;
  const signals: ExternalSignals = {
    blocked: result.blocked,
    verificationPassed: result.verificationPassed,
    oraclePassed: result.oraclePassed,
    humanOwnedViolations: result.humanOwnedViolations,
    offScopeFilesTouched: churnMeaningful ? result.offScopeFilesTouched : 0,
    ...(result.migrationCheckStatus !== undefined ? { migrationCheckStatus: result.migrationCheckStatus } : {}),
    ...(diffType !== undefined ? { unsupportedDiffType: diffType } : {}),
  };
  return classifyExternalOutcome(signals);
}

/** Build classified rows from a real run's results, joined to external metadata. */
export function externalResultRows(results: readonly BenchResult[], manifest: ExternalManifest): ExternalResultRow[] {
  const services = serviceIndex(manifest);
  const evolutions = evolutionIndex(manifest);
  const rows: ExternalResultRow[] = [];
  for (const r of results) {
    const evo = evolutions.get(r.taskId);
    if (!evo) continue;
    const svc = services.get(evo.service);
    const outcome = classifyBenchResult(r, evo);
    rows.push(toRow(evo, svc, outcome));
  }
  return rows;
}

/**
 * Build rows from a dataset's AUTHOR-DECLARED expectations (no run). Only
 * evolutions that actually declare an `externalOutcome` are included — an
 * undeclared evolution is NEVER defaulted to `passed`, which would fabricate a
 * misleading all-green report on a runnable dataset. For observed outcomes, run
 * the dataset through the Arch CLI instead (`external run`).
 */
export function externalResultRowsFromExpectations(manifest: ExternalManifest): ExternalResultRow[] {
  const services = serviceIndex(manifest);
  return manifest.evolutions
    .filter((evo) => evo.externalOutcome !== undefined)
    .map((evo) => toRow(evo, services.get(evo.service), evo.externalOutcome!));
}

function toRow(
  evo: ExternalEvolution,
  svc: ExternalService | undefined,
  outcome: ExternalOutcome,
): ExternalResultRow {
  return {
    evolutionId: evo.id,
    service: evo.service,
    kind: evo.kind,
    author: svc?.authorship.author ?? "(unknown)",
    domain: svc?.authorship.domain ?? "(unknown)",
    outcome,
    ...(evo.unsupportedDiffType !== undefined
      ? { unsupportedDiffType: evo.unsupportedDiffType }
      : evo.unsupportedReason
        ? { unsupportedDiffType: evo.unsupportedReason.code }
        : {}),
    ...(evo.unsupportedReason?.summary !== undefined ? { unsupportedReason: evo.unsupportedReason.summary } : {}),
    fixture: evo.fixture,
  };
}

/** Build failure-analysis records for every non-passing evolution. */
export function collectFailureAnalyses(
  rows: readonly ExternalResultRow[],
  manifest: ExternalManifest,
): ExternalFailureAnalysis[] {
  const evolutions = evolutionIndex(manifest);
  const out: ExternalFailureAnalysis[] = [];
  for (const row of rows) {
    if (row.outcome === "passed") continue;
    const evo = evolutions.get(row.evolutionId);
    // Prefer an author-supplied failure analysis verbatim; else synthesize one.
    if (evo?.failureAnalysis) {
      out.push(evo.failureAnalysis);
      continue;
    }
    const analysis = buildFailureAnalysis({
      task: row.evolutionId,
      outcome: row.outcome,
      ...(evo?.unsupportedReason ? { unsupportedReason: evo.unsupportedReason } : {}),
      ...(evo?.suggestedNextSteps ? { suggestedNextSteps: evo.suggestedNextSteps } : {}),
    });
    if (analysis) out.push(analysis);
  }
  return out;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ratesTable(title: string, label: string, buckets: ExternalMetrics["unsupportedRateByKind"]): string {
  const header = `| ${label} | Total | Unsupported | Unsupported rate |`;
  const sep = "| --- | --- | --- | --- |";
  const rows =
    buckets.length === 0
      ? ["| (none) | 0 | 0 | — |"]
      : buckets.map((b) => `| ${b.key} | ${b.total} | ${b.unsupported} | ${pct(b.rate)} |`);
  return [`#### ${title}`, "", header, sep, ...rows, ""].join("\n");
}

export interface ExternalSummaryOptions {
  readonly fixture: boolean;
  readonly datasetVersion?: string;
  readonly datasetHash?: string;
}

export function toExternalSummaryMarkdown(metrics: ExternalMetrics, opts: ExternalSummaryOptions): string {
  const parts: string[] = ["## External validation", ""];
  if (opts.fixture || metrics.fixture) {
    parts.push(
      "> **FIXTURE / DEMO data — excluded from all claims.** This exercises the",
      "> Phase 2 plumbing only. Real external services/evolutions are pending",
      "> external input (see the validation-gate roadmap).",
      "",
    );
  }
  if (opts.datasetVersion) parts.push(`- External dataset version: \`${opts.datasetVersion}\``);
  if (opts.datasetHash) parts.push(`- External dataset hash: \`${opts.datasetHash}\``);
  parts.push(
    `- Evolutions classified: ${metrics.total}`,
    `- Pass-or-explicit-block rate: ${pct(metrics.passOrExplicitBlockRate)}`,
    "",
  );

  const outcomeHeader = "| Outcome | Count |";
  const outcomeSep = "| --- | --- |";
  const outcomeRows = Object.entries(metrics.outcomeCounts)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([o, n]) => `| ${o} | ${n} |`);
  parts.push(
    "#### Outcomes",
    "",
    outcomeHeader,
    outcomeSep,
    ...(outcomeRows.length > 0 ? outcomeRows : ["| (none) | 0 |"]),
    "",
  );

  parts.push(ratesTable("Unsupported rate by task kind", "Kind", metrics.unsupportedRateByKind));
  parts.push(ratesTable("Unsupported rate by external author", "Author", metrics.unsupportedRateByExternalAuthor));
  parts.push(ratesTable("Unsupported rate by domain", "Domain", metrics.unsupportedRateByDomain));

  const reasonHeader = "| Unsupported reason | Diff type | Count |";
  const reasonSep = "| --- | --- | --- |";
  const reasonRows =
    metrics.unsupportedReasonsTop10.length === 0
      ? ["| (none) | — | 0 |"]
      : metrics.unsupportedReasonsTop10.map((r) => `| ${r.reason} | ${r.diffType ?? "—"} | ${r.count} |`);
  parts.push("#### Top unsupported reasons", "", reasonHeader, reasonSep, ...reasonRows, "");

  return parts.join("\n").replace(/\n+$/, "\n");
}
