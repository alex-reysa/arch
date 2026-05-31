import { describe, it, expect } from "vitest";
import { computeGuaranteeVerification } from "../src/runner/guarantee.js";
import type { BenchTask } from "../src/manifest/schema.js";

function gtask(over: Partial<BenchTask> = {}): BenchTask {
  return {
    id: "social-feed-08",
    subject: "social-feed",
    order: 8,
    kind: "guarantee_change",
    fromSpec: "subjects/social-feed/tasks/07/backend.arch",
    toSpec: "subjects/social-feed/tasks/08/backend.arch",
    intent: "add a latency guarantee",
    expectedDiffTypes: ["guarantee_added"],
    expectedAffectedPaths: ["src/workflows/CreatePost.ts"],
    expectedOutcome: "apply_passes",
    oracleTests: [],
    driftScripts: [],
    ...over,
  };
}

describe("computeGuaranteeVerification", () => {
  it("returns undefined for non-guarantee tasks", () => {
    expect(computeGuaranteeVerification(gtask({ kind: "additive_field" }))).toBeUndefined();
  });

  it("keeps a latency guarantee declared even when a verifier assertion is attached", () => {
    // The crux: a structural assertion satisfies strict validation but must NOT
    // promote an unmeasured latency guarantee to behaviorally verified.
    const t = gtask({
      guaranteeVerification: "declared_but_not_behaviorally_verified",
      guaranteeAssertion: "subjects/x/assertions/latency.guarantee.json",
    });
    expect(computeGuaranteeVerification(t)).toBe("declared_but_not_behaviorally_verified");
  });

  it("honors an explicit behavioral classification", () => {
    expect(computeGuaranteeVerification(gtask({ guaranteeVerification: "behavioral" }))).toBe("behavioral");
  });

  it("infers behavioral from a real oracle test when unclassified", () => {
    expect(computeGuaranteeVerification(gtask({ oracleTests: ["subjects/x/oracles/lat.test.ts"] }))).toBe("behavioral");
  });

  it("defaults to declared when unclassified and only a structural assertion exists", () => {
    expect(
      computeGuaranteeVerification(gtask({ guaranteeAssertion: "subjects/x/assertions/a.guarantee.json" })),
    ).toBe("declared_but_not_behaviorally_verified");
  });
});
