/**
 * Unsupported-rate metrics for an external validation run (roadmap Phase 2).
 *
 * Reports unsupported outcomes as PRODUCT metrics, not as failures to hide:
 *   - unsupported_rate_by_kind
 *   - unsupported_rate_by_external_author
 *   - unsupported_rate_by_domain
 *   - unsupported_reasons_top_10
 *
 * Pure: same rows → byte-identical metrics. "Unsupported" means
 * `blocked_unsupported_capability` (a genuine Arch capability gap); other
 * non-pass outcomes are counted in `outcomeCounts` but are not capability gaps.
 */

import type { TaskKind } from "../manifest/schema.js";
import {
  EXTERNAL_OUTCOMES,
  isPassOrExplicitBlock,
  isUnsupportedCapability,
  type ExternalOutcome,
  type UnsupportedDiffType,
} from "./schema.js";

/** One classified external evolution, flattened for aggregation. */
export interface ExternalResultRow {
  readonly evolutionId: string;
  readonly service: string;
  readonly kind: TaskKind;
  readonly author: string;
  readonly domain: string;
  readonly outcome: ExternalOutcome;
  readonly unsupportedDiffType?: UnsupportedDiffType;
  /** One-line reason summary, for the top-reasons ranking. */
  readonly unsupportedReason?: string;
  /** True for synthetic demo rows (excluded from claims). */
  readonly fixture: boolean;
}

export interface RateBucket {
  readonly key: string;
  readonly total: number;
  readonly unsupported: number;
  /** unsupported / total, 0 when total is 0. */
  readonly rate: number;
}

export interface UnsupportedReasonCount {
  readonly reason: string;
  readonly diffType?: UnsupportedDiffType;
  readonly count: number;
}

export interface ExternalMetrics {
  readonly total: number;
  /** True when every counted row is fixture/demo data (excluded from claims). */
  readonly fixture: boolean;
  /** Count per outcome (sparse — only outcomes that occur). */
  readonly outcomeCounts: Partial<Record<ExternalOutcome, number>>;
  readonly unsupportedRateByKind: readonly RateBucket[];
  readonly unsupportedRateByExternalAuthor: readonly RateBucket[];
  readonly unsupportedRateByDomain: readonly RateBucket[];
  readonly unsupportedReasonsTop10: readonly UnsupportedReasonCount[];
  /** Fraction of evolutions that passed or blocked for a correct/explicit reason. */
  readonly passOrExplicitBlockRate: number;
}

function rateBuckets(rows: readonly ExternalResultRow[], keyOf: (r: ExternalResultRow) => string): RateBucket[] {
  const totals = new Map<string, number>();
  const unsupported = new Map<string, number>();
  for (const r of rows) {
    const key = keyOf(r);
    totals.set(key, (totals.get(key) ?? 0) + 1);
    if (isUnsupportedCapability(r.outcome)) unsupported.set(key, (unsupported.get(key) ?? 0) + 1);
  }
  return [...totals.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => {
      const total = totals.get(key) ?? 0;
      const uns = unsupported.get(key) ?? 0;
      return { key, total, unsupported: uns, rate: total === 0 ? 0 : uns / total };
    });
}

function topReasons(rows: readonly ExternalResultRow[], limit: number): UnsupportedReasonCount[] {
  const counts = new Map<string, { count: number; diffType?: UnsupportedDiffType }>();
  for (const r of rows) {
    if (!isUnsupportedCapability(r.outcome)) continue;
    const reason = r.unsupportedReason ?? r.unsupportedDiffType ?? "unspecified";
    const cur = counts.get(reason) ?? { count: 0, ...(r.unsupportedDiffType ? { diffType: r.unsupportedDiffType } : {}) };
    cur.count += 1;
    counts.set(reason, cur);
  }
  return [...counts.entries()]
    // Deterministic: by count desc, then reason asc.
    .sort((a, b) => (b[1].count - a[1].count) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([reason, { count, diffType }]) => ({ reason, count, ...(diffType ? { diffType } : {}) }));
}

export function computeExternalMetrics(rows: readonly ExternalResultRow[]): ExternalMetrics {
  const outcomeCounts: Partial<Record<ExternalOutcome, number>> = {};
  for (const o of EXTERNAL_OUTCOMES) {
    const n = rows.filter((r) => r.outcome === o).length;
    if (n > 0) outcomeCounts[o] = n;
  }
  const passOrBlock = rows.filter((r) => isPassOrExplicitBlock(r.outcome)).length;
  return {
    total: rows.length,
    fixture: rows.length > 0 && rows.every((r) => r.fixture),
    outcomeCounts,
    unsupportedRateByKind: rateBuckets(rows, (r) => r.kind),
    unsupportedRateByExternalAuthor: rateBuckets(rows, (r) => r.author),
    unsupportedRateByDomain: rateBuckets(rows, (r) => r.domain),
    unsupportedReasonsTop10: topReasons(rows, 10),
    passOrExplicitBlockRate: rows.length === 0 ? 0 : passOrBlock / rows.length,
  };
}
