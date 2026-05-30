import { describe, it, expect } from "vitest";
import { scorePassed, type TaskSignals } from "../src/runner/score.js";

function signals(over: Partial<TaskSignals> = {}): TaskSignals {
  return {
    blocked: false,
    verificationPassed: true,
    oraclePassed: true,
    humanOwnedViolations: 0,
    generatedTestDeletedOrWeakened: false,
    offScopeFilesTouched: 0,
    driftRecall: "not_applicable",
    ...over,
  };
}

describe("scorePassed — apply_passes", () => {
  it("passes when verified, oracles pass, and no human/test harm", () => {
    expect(scorePassed("additive_field", "apply_passes", "arch-typed-sync", signals())).toBe(true);
  });
  it("fails when verification fails", () => {
    expect(scorePassed("additive_field", "apply_passes", "full-regeneration", signals({ verificationPassed: false }))).toBe(false);
  });
  it("fails when an oracle fails", () => {
    expect(scorePassed("enum_change", "apply_passes", "claude-direct-edit", signals({ oraclePassed: false }))).toBe(false);
  });
  it("fails when a human-owned file was violated", () => {
    expect(scorePassed("human_owned_edit", "apply_passes", "claude-broad-constrained", signals({ humanOwnedViolations: 1 }))).toBe(false);
  });
  it("fails when a generated test was deleted or weakened", () => {
    expect(scorePassed("additive_field", "apply_passes", "claude-direct-edit", signals({ generatedTestDeletedOrWeakened: true }))).toBe(false);
  });
  it("fails when the change was blocked but should have passed", () => {
    expect(scorePassed("additive_field", "apply_passes", "arch-typed-sync", signals({ blocked: true, verificationPassed: false }))).toBe(false);
  });
});

describe("scorePassed — apply_blocks (destructive)", () => {
  it("passes when the baseline blocks and writes nothing off-scope", () => {
    expect(scorePassed("destructive_block", "apply_blocks", "arch-typed-sync", signals({ blocked: true, verificationPassed: false }))).toBe(true);
  });
  it("fails when the baseline did NOT block (full-regeneration has no safety gate)", () => {
    expect(scorePassed("destructive_block", "apply_blocks", "full-regeneration", signals({ blocked: false, verificationPassed: true }))).toBe(false);
  });
  it("fails when it blocked but still scribbled off-scope files", () => {
    expect(scorePassed("destructive_block", "apply_blocks", "claude-direct-edit", signals({ blocked: true, offScopeFilesTouched: 3 }))).toBe(false);
  });
});

describe("scorePassed — drift_detected", () => {
  it("arch-typed-sync passes only when drift is detected AND repaired", () => {
    expect(scorePassed("drift_injection", "drift_detected", "arch-typed-sync", signals({ driftRecall: "detected", repairSucceeded: true }))).toBe(true);
    expect(scorePassed("drift_injection", "drift_detected", "arch-typed-sync", signals({ driftRecall: "missed", repairSucceeded: false }))).toBe(false);
  });
  it("full-regeneration passes when it blindly restored a verifying project", () => {
    expect(scorePassed("drift_injection", "drift_detected", "full-regeneration", signals({ driftRecall: "not_applicable", verificationPassed: true }))).toBe(true);
  });
  it("any baseline fails a drift task if it harmed human-owned files", () => {
    expect(scorePassed("drift_injection", "drift_detected", "full-regeneration", signals({ verificationPassed: true, humanOwnedViolations: 1 }))).toBe(false);
  });
});
