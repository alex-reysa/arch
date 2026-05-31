import { describe, expect, it } from "vitest";
import type { WorkflowStepAst } from "@arch/language";

import { buildDraftIR } from "./draft-ir.js";
import { SEM_CODES, validateSemantics } from "./semantic-validator.js";
import { apiTrigger, archFile, fieldDecl, modelDecl, steps, workflowDecl } from "./test-builders.js";

function named(step: WorkflowStepAst, name: string): WorkflowStepAst {
  return { ...step, name };
}

function codes(stepNodes: WorkflowStepAst[]): string[] {
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
  const { draft } = buildDraftIR(ast);
  return validateSemantics(draft).diagnostics.all().map((d) => d.code);
}

describe("semantic: duplicate named workflow steps", () => {
  it("rejects two steps in the same workflow sharing a name", () => {
    expect(
      codes([named(steps.validate("title", 0), "check"), named(steps.validate("body", 1), "check")]),
    ).toContain(SEM_CODES.DUPLICATE_STEP_NAME);
  });

  it("allows distinct names", () => {
    expect(
      codes([named(steps.validate("title", 0), "check"), named(steps.insert("Post", 1), "persist")]),
    ).not.toContain(SEM_CODES.DUPLICATE_STEP_NAME);
  });

  it("does not flag legacy unnamed steps", () => {
    expect(codes([steps.validate("title", 0), steps.insert("Post", 1)])).not.toContain(
      SEM_CODES.DUPLICATE_STEP_NAME,
    );
  });
});
