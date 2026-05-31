import { describe, expect, it } from "vitest";
import {
  buildFailureAnalysis,
  classifyExternalOutcome,
  failureClassOf,
  type ExternalSignals,
} from "../src/external/classify.js";

function signals(over: Partial<ExternalSignals> = {}): ExternalSignals {
  return {
    blocked: false,
    verificationPassed: true,
    oraclePassed: true,
    humanOwnedViolations: 0,
    offScopeFilesTouched: 0,
    ...over,
  };
}

describe("classifyExternalOutcome", () => {
  it("passes a clean applied evolution", () => {
    expect(classifyExternalOutcome(signals())).toBe("passed");
  });

  it("human-code violation wins over everything (highest-severity gate)", () => {
    const o = classifyExternalOutcome(
      signals({ humanOwnedViolations: 1, blocked: true, verificationPassed: false, oraclePassed: false }),
    );
    expect(o).toBe("human_code_violation");
  });

  it("migration check failure outranks a block", () => {
    expect(classifyExternalOutcome(signals({ blocked: true, migrationCheckStatus: "failed" }))).toBe(
      "migration_check_failed",
    );
  });

  it("distinguishes an unsupported-capability block from a supported block", () => {
    expect(classifyExternalOutcome(signals({ blocked: true }))).toBe("blocked_supported_reason");
    expect(classifyExternalOutcome(signals({ blocked: true, unsupportedDiffType: "relation_cardinality_change" }))).toBe(
      "blocked_unsupported_capability",
    );
  });

  it("reports failed verification then failed oracle", () => {
    expect(classifyExternalOutcome(signals({ verificationPassed: false }))).toBe("failed_verification");
    expect(classifyExternalOutcome(signals({ oraclePassed: false }))).toBe("failed_oracle");
  });

  it("flags excessive churn above the threshold", () => {
    expect(classifyExternalOutcome(signals({ offScopeFilesTouched: 6 }))).toBe("excessive_churn");
    expect(classifyExternalOutcome(signals({ offScopeFilesTouched: 100, excessiveChurnThreshold: 1000 }))).toBe(
      "passed",
    );
  });
});

describe("buildFailureAnalysis", () => {
  it("returns undefined for a passed task (nothing to analyze)", () => {
    expect(buildFailureAnalysis({ task: "t", outcome: "passed" })).toBeUndefined();
  });

  it("produces the required failure-analysis JSON shape for an unsupported capability", () => {
    const fa = buildFailureAnalysis({
      task: "external-crm-07",
      outcome: "blocked_unsupported_capability",
      unsupportedReason: {
        code: "relation_cardinality_change",
        summary: "Changing relation cardinality requires data migration semantics not implemented.",
      },
      suggestedNextSteps: ["add explicit migration plan", "split into additive relation + backfill + deprecation"],
    });
    expect(fa).toBeDefined();
    expect(fa).toMatchObject({
      task: "external-crm-07",
      outcome: "blocked_unsupported_capability",
      unsupportedDiff: "relation_cardinality_change",
      shouldArchSupportThis: true,
      priority: "high",
    });
    expect(fa!.suggestedNextSteps).toHaveLength(2);
    expect(fa!.reason).toMatch(/relation cardinality/i);
    // Round-trips through JSON unchanged (it is serialized verbatim).
    expect(JSON.parse(JSON.stringify(fa))).toEqual(fa);
  });

  it("defaults shouldArchSupportThis to false for a non-capability failure", () => {
    const fa = buildFailureAnalysis({ task: "t", outcome: "failed_oracle" });
    expect(fa!.shouldArchSupportThis).toBe(false);
    expect(fa!.priority).toBe("medium");
    expect(fa!.unsupportedDiff).toBeUndefined();
  });
});

describe("failureClassOf", () => {
  it("maps outcomes to coarse classes", () => {
    expect(failureClassOf("passed")).toBe("pass");
    expect(failureClassOf("blocked_unsupported_capability")).toBe("unsupported");
    expect(failureClassOf("blocked_supported_reason")).toBe("blocked");
    expect(failureClassOf("human_code_violation")).toBe("human_code");
    expect(failureClassOf("migration_check_failed")).toBe("migration");
  });
});
