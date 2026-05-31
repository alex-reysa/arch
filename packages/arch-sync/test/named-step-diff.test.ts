import { describe, expect, it } from "vitest";
import type { CanonicalIR, WorkflowStepIR, WorkflowStepOperationIR } from "@arch/ir";

import { diffIRV1 } from "../src/diff/diff-engine.js";
import { socialFeedV1 } from "./fixtures.js";

interface StepSpec {
  readonly name?: string;
  readonly order: number;
  readonly op: WorkflowStepOperationIR;
}

function buildStep(spec: StepSpec): WorkflowStepIR {
  const id =
    spec.name !== undefined
      ? `step:CreatePost.${spec.name}`
      : `step:CreatePost.${spec.order}.${spec.op.kind}`;
  return {
    id,
    kind: "workflow_step",
    name: `${id}.${spec.op.kind}`,
    workflow_id: "workflow:CreatePost",
    order: spec.order,
    ...(spec.name !== undefined ? { step_name: spec.name } : {}),
    operation: spec.op,
    source_location_id: "src:0",
  };
}

// Build a CanonicalIR identical to the SocialFeed base except for the
// CreatePost workflow steps, so the only diffs are step-level.
function withSteps(specs: StepSpec[]): CanonicalIR {
  const base = socialFeedV1();
  const wf = base.workflows[0]!;
  return { ...base, workflows: [{ ...wf, steps: specs.map(buildStep) }] };
}

const validate = (target = "body"): WorkflowStepOperationIR => ({ kind: "validate", target });
const insert = (): WorkflowStepOperationIR => ({ kind: "insert", model_id: "model:Post" });
const sanitize = (target = "body"): WorkflowStepOperationIR => ({ kind: "sanitize", target });

function stepDiffTypes(a: CanonicalIR, b: CanonicalIR): string[] {
  return diffIRV1(a, b)
    .envelope.diffs.map((d) => d.type)
    .filter((t) => t.startsWith("workflow_step_"));
}

describe("diff: named workflow steps match by stable id, not position", () => {
  const v1 = () =>
    withSteps([
      { name: "check", order: 0, op: validate() },
      { name: "persist", order: 1, op: insert() },
    ]);

  it("a mid-list insertion of a named step yields exactly one workflow_step_added", () => {
    const after = withSteps([
      { name: "check", order: 0, op: validate() },
      { name: "clean", order: 1, op: sanitize() },
      { name: "persist", order: 2, op: insert() },
    ]);
    expect(stepDiffTypes(v1(), after)).toEqual(["workflow_step_added"]);
  });

  it("removing a named step yields exactly one workflow_step_removed", () => {
    const after = withSteps([{ name: "persist", order: 0, op: insert() }]);
    expect(stepDiffTypes(v1(), after)).toEqual(["workflow_step_removed"]);
  });

  it("reordering named steps yields workflow_step_reordered (not add/remove)", () => {
    const reordered = withSteps([
      { name: "persist", order: 0, op: insert() },
      { name: "check", order: 1, op: validate() },
    ]);
    expect(stepDiffTypes(v1(), reordered)).toEqual(["workflow_step_reordered"]);
  });

  it("changing a named step's operation yields workflow_step_changed", () => {
    const changed = withSteps([
      { name: "check", order: 0, op: validate("title") },
      { name: "persist", order: 1, op: insert() },
    ]);
    expect(stepDiffTypes(v1(), changed)).toEqual(["workflow_step_changed"]);
  });

  it("contrast: a mid-list insertion of UNNAMED steps is churny (positional ids unstable)", () => {
    const before = withSteps([
      { order: 0, op: validate() },
      { order: 1, op: insert() },
    ]);
    const after = withSteps([
      { order: 0, op: validate() },
      { order: 1, op: sanitize() },
      { order: 2, op: insert() },
    ]);
    const types = stepDiffTypes(before, after);
    expect(types.length).toBeGreaterThan(1);
    expect(types).toContain("workflow_step_removed");
  });
});
