import { describe, expect, it } from "vitest";

import { planTaskExecution } from "../src/runner/run-modes.js";

describe("planTaskExecution", () => {
  it("isolated mode always uses a fresh per-task workspace", () => {
    expect(
      planTaskExecution({
        taskMode: "isolated",
        failurePolicy: "continue-contaminated",
        index: 3,
        priorTaskFailed: true,
      }),
    ).toEqual({ freshWorkspace: true, restoreFromSpec: false });
  });

  it("sequential + continue-contaminated never resets the workspace", () => {
    expect(
      planTaskExecution({
        taskMode: "sequential",
        failurePolicy: "continue-contaminated",
        index: 2,
        priorTaskFailed: true,
      }),
    ).toEqual({ freshWorkspace: false, restoreFromSpec: false });
  });

  it("sequential + restore-from-spec restores only after a prior failure", () => {
    expect(
      planTaskExecution({
        taskMode: "sequential",
        failurePolicy: "restore-from-spec",
        index: 2,
        priorTaskFailed: true,
      }).restoreFromSpec,
    ).toBe(true);
    expect(
      planTaskExecution({
        taskMode: "sequential",
        failurePolicy: "restore-from-spec",
        index: 2,
        priorTaskFailed: false,
      }).restoreFromSpec,
    ).toBe(false);
  });

  it("never restores before the first task in the chain", () => {
    expect(
      planTaskExecution({
        taskMode: "sequential",
        failurePolicy: "restore-from-spec",
        index: 0,
        priorTaskFailed: true,
      }).restoreFromSpec,
    ).toBe(false);
  });
});
