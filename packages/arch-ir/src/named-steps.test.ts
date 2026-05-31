import { describe, expect, it } from "vitest";
import type { WorkflowStepAst } from "@arch/language";

import { buildDraftIR } from "./draft-ir.js";
import { apiTrigger, archFile, fieldDecl, modelDecl, steps, workflowDecl } from "./test-builders.js";

function named(step: WorkflowStepAst, name: string): WorkflowStepAst {
  return { ...step, name };
}

function compile(stepNodes: WorkflowStepAst[]) {
  const ast = archFile({
    declarations: [
      modelDecl({
        name: "Post",
        fields: [
          fieldDecl({ name: "id", typeText: "id" }),
          fieldDecl({ name: "title", typeText: "string" }),
        ],
      }),
      workflowDecl({
        name: "CreatePost",
        trigger: apiTrigger("POST", "/posts", "none"),
        steps: stepNodes,
      }),
    ],
  });
  return buildDraftIR(ast).draft;
}

describe("IR: named workflow step identity", () => {
  it("gives a named step a stable id `step:<Workflow>.<name>` and records step_name", () => {
    const draft = compile([
      named(steps.validate("title", 0), "check_title"),
      steps.insert("Post", 1),
    ]);
    const wf = draft.workflows[0]!;
    const validate = wf.steps[0]!;
    expect(validate.id).toBe("step:CreatePost.check_title");
    expect(validate.step_name).toBe("check_title");
    expect(validate.order).toBe(0);

    // Legacy unnamed step keeps the positional id and has no step_name.
    const insert = wf.steps[1]!;
    expect(insert.id).toBe("step:CreatePost.1.InsertStep");
    expect(insert.step_name).toBeUndefined();
  });

  it("keeps a named step's id stable when an earlier step is inserted", () => {
    const before = compile([named(steps.insert("Post", 0), "persist")]);
    const after = compile([
      named(steps.validate("title", 0), "check_title"),
      named(steps.insert("Post", 1), "persist"),
    ]);
    const idBefore = before.workflows[0]!.steps.find((s) => s.step_name === "persist")!.id;
    const idAfter = after.workflows[0]!.steps.find((s) => s.step_name === "persist")!.id;
    expect(idBefore).toBe("step:CreatePost.persist");
    expect(idAfter).toBe("step:CreatePost.persist");
  });
});
