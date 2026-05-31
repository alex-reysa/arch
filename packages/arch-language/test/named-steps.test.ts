import { describe, expect, it } from "vitest";

import type { ValidateStepAst, WorkflowDeclAst } from "../src/ast.js";
import { parse } from "../src/parser.js";

const FILE = "named-steps.arch";

function workflowOf(src: string): WorkflowDeclAst {
  const { ast, diagnostics } = parse(src, FILE);
  expect(diagnostics.hasErrors()).toBe(false);
  const wf = ast!.declarations.find(
    (d): d is WorkflowDeclAst => d.kind === "WorkflowDecl",
  );
  if (!wf) throw new Error("expected a workflow declaration");
  return wf;
}

describe("parser: named workflow steps", () => {
  it("captures the step name from `step <name>: <kind> ...`", () => {
    const wf = workflowOf(`model Post {
  id: id
  body: string
}

workflow CreatePost {
  trigger api POST /posts auth: none
  step check_body: validate body
  step persist: insert Post
}
`);
    expect(wf.steps.map((s) => s.kind)).toEqual(["ValidateStep", "InsertStep"]);
    expect(wf.steps.map((s) => s.name)).toEqual(["check_body", "persist"]);
    const validate = wf.steps[0] as ValidateStepAst;
    expect(validate.target).toBe("body");
    expect(wf.steps.map((s) => s.index)).toEqual([0, 1]);
  });

  it("leaves legacy unnamed steps with an undefined name", () => {
    const wf = workflowOf(`model Post {
  id: id
  body: string
}

workflow CreatePost {
  trigger api POST /posts auth: none
  step validate body
  step insert Post
}
`);
    expect(wf.steps.map((s) => s.kind)).toEqual(["ValidateStep", "InsertStep"]);
    expect(wf.steps.map((s) => s.name)).toEqual([undefined, undefined]);
  });

  it("accepts a step name that collides with a verb keyword", () => {
    const wf = workflowOf(`model Post {
  id: id
  body: string
}

workflow CreatePost {
  trigger api POST /posts auth: none
  step validate: validate body
}
`);
    expect(wf.steps[0]!.kind).toBe("ValidateStep");
    expect(wf.steps[0]!.name).toBe("validate");
    expect((wf.steps[0] as ValidateStepAst).target).toBe("body");
  });
});
