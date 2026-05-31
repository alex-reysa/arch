import { describe, expect, it } from "vitest";
import type { WorkflowIR, WorkflowStepIR } from "@arch/ir";

import { renderWorkflowSimple } from "../workflow.js";

function validateStep(name: string, order: number): WorkflowStepIR {
  return {
    id: `step:CreatePost.${name}`,
    kind: "workflow_step",
    name: `step:CreatePost.${name}.ValidateStep`,
    workflow_id: "workflow:CreatePost",
    order,
    step_name: name,
    operation: { kind: "validate", target: order === 0 ? "body" : "title" },
    source_location_id: "src:step",
  };
}

const twoValidateWorkflow: WorkflowIR = {
  id: "workflow:CreatePost",
  kind: "workflow",
  name: "CreatePost",
  trigger: { kind: "api", method: "POST", path: "/posts", auth: "none" },
  steps: [validateStep("check_body", 0), validateStep("check_title", 1)],
  guarantees: [],
  source_location_id: "src:wf",
};

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe("generator: named steps don't produce duplicate locals", () => {
  it("emits a single `const validation` and `const payload` for two validate steps", () => {
    const code = renderWorkflowSimple(twoValidateWorkflow);
    expect(count(code, /const validation\b/g)).toBe(1);
    expect(count(code, /const payload\b/g)).toBe(1);
  });

  it("still generates the single-validate workflow unchanged", () => {
    const single: WorkflowIR = {
      ...twoValidateWorkflow,
      steps: [validateStep("check_body", 0)],
    };
    const code = renderWorkflowSimple(single);
    expect(count(code, /const validation\b/g)).toBe(1);
    expect(count(code, /const payload\b/g)).toBe(1);
  });
});
