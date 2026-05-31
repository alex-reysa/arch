import { describe, expect, it } from "vitest";
import { computeExternalMetrics, type ExternalResultRow } from "../src/external/metrics.js";

function row(over: Partial<ExternalResultRow> = {}): ExternalResultRow {
  return {
    evolutionId: "e",
    service: "svc",
    kind: "additive_field",
    author: "team-a",
    domain: "crm",
    outcome: "passed",
    fixture: true,
    ...over,
  };
}

const ROWS: ExternalResultRow[] = [
  row({ evolutionId: "a1", kind: "additive_field", author: "team-a", domain: "crm", outcome: "passed" }),
  row({ evolutionId: "a2", kind: "enum_change", author: "team-a", domain: "crm", outcome: "passed" }),
  row({
    evolutionId: "a3",
    kind: "migration_data_preservation",
    author: "team-a",
    domain: "crm",
    outcome: "blocked_unsupported_capability",
    unsupportedDiffType: "relation_cardinality_change",
    unsupportedReason: "cardinality change unsupported",
  }),
  row({
    evolutionId: "b1",
    kind: "migration_data_preservation",
    author: "team-b",
    domain: "fintech",
    outcome: "blocked_unsupported_capability",
    unsupportedDiffType: "nullable_field",
    unsupportedReason: "nullable unsupported",
  }),
  row({ evolutionId: "b2", kind: "guarantee_change", author: "team-b", domain: "fintech", outcome: "failed_oracle" }),
];

describe("computeExternalMetrics", () => {
  it("counts outcomes and computes pass-or-explicit-block rate", () => {
    const m = computeExternalMetrics(ROWS);
    expect(m.total).toBe(5);
    expect(m.fixture).toBe(true);
    expect(m.outcomeCounts.passed).toBe(2);
    expect(m.outcomeCounts.blocked_unsupported_capability).toBe(2);
    expect(m.outcomeCounts.failed_oracle).toBe(1);
    // 2 passed + 2 unsupported blocks = 4 explicit; failed_oracle is not.
    expect(m.passOrExplicitBlockRate).toBeCloseTo(4 / 5, 6);
  });

  it("computes unsupported rate by kind", () => {
    const m = computeExternalMetrics(ROWS);
    const migration = m.unsupportedRateByKind.find((b) => b.key === "migration_data_preservation");
    expect(migration).toMatchObject({ total: 2, unsupported: 2, rate: 1 });
    const additive = m.unsupportedRateByKind.find((b) => b.key === "additive_field");
    expect(additive).toMatchObject({ total: 1, unsupported: 0, rate: 0 });
  });

  it("computes unsupported rate by external author and domain", () => {
    const m = computeExternalMetrics(ROWS);
    expect(m.unsupportedRateByExternalAuthor.find((b) => b.key === "team-a")).toMatchObject({ total: 3, unsupported: 1 });
    expect(m.unsupportedRateByExternalAuthor.find((b) => b.key === "team-b")).toMatchObject({ total: 2, unsupported: 1 });
    expect(m.unsupportedRateByDomain.find((b) => b.key === "fintech")).toMatchObject({ total: 2, unsupported: 1 });
  });

  it("ranks the top unsupported reasons", () => {
    const m = computeExternalMetrics(ROWS);
    expect(m.unsupportedReasonsTop10).toHaveLength(2);
    const reasons = m.unsupportedReasonsTop10.map((r) => r.reason).sort();
    expect(reasons).toEqual(["cardinality change unsupported", "nullable unsupported"]);
    expect(m.unsupportedReasonsTop10.every((r) => r.count === 1)).toBe(true);
  });

  it("is empty-safe", () => {
    const m = computeExternalMetrics([]);
    expect(m.total).toBe(0);
    expect(m.fixture).toBe(false);
    expect(m.passOrExplicitBlockRate).toBe(0);
    expect(m.unsupportedReasonsTop10).toEqual([]);
  });
});
