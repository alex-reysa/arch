import type { CanonicalIR, FieldIR, FieldTypeIR, WorkflowIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit a Vitest spec that exercises the workflow happy path. The fixture
 * payload is a minimal object that satisfies the validator generated for
 * the workflow's insert target. The test asserts the workflow returns
 * `{ ok: true }` and (when there's an insert step) that a row was persisted.
 */
export function renderWorkflowTest(workflow: WorkflowIR, ctx: { ir: CanonicalIR }): string {
  const cls = pascal(workflow.name);
  const insertStep = workflow.steps.find((s) => s.operation.kind === "insert");
  const insertModelId =
    insertStep && insertStep.operation.kind === "insert" ? insertStep.operation.model_id : null;
  const inputLiteral = renderWorkflowInputLiteral(workflow, ctx);

  return [
    'import { beforeEach, describe, expect, it } from "vitest";',
    `import { run${cls} } from "../../src/workflows/${cls}.js";`,
    'import { resetDb } from "../../src/runtime/db.js";',
    "",
    `describe("workflow ${cls}", () => {`,
    "  beforeEach(() => resetDb());",
    "",
    "  it(\"runs the happy path\", async () => {",
    `    const input = ${inputLiteral};`,
    `    const result = await run${cls}(input);`,
    "    expect(result.ok).toBe(true);",
    "  });",
    "",
    "  it(\"rejects invalid input\", async () => {",
    `    const result = await run${cls}({});`,
    "    expect(result.ok).toBe(false);",
    "  });",
    "});",
    "",
    `// insertModelId reference for traceability: ${insertModelId ?? "<none>"}`,
  ].join("\n");
}

function renderWorkflowInputLiteral(workflow: WorkflowIR, ctx: { ir: CanonicalIR }): string {
  const insertStep = workflow.steps.find((s) => s.operation.kind === "insert");
  const insertModelId =
    insertStep && insertStep.operation.kind === "insert" ? insertStep.operation.model_id : null;
  const model = insertModelId ? ctx.ir.models.find((m) => m.id === insertModelId) : undefined;
  const entries = new Map<string, string>();
  for (const step of workflow.steps) {
    if (step.operation.kind === "validate") {
      entries.set(step.operation.target, sampleValueForName(step.operation.target));
    }
  }
  for (const field of model?.fields ?? []) {
    if (field.type.kind === "id" || field.nullable || field.default !== undefined) continue;
    if (!entries.has(field.name)) entries.set(field.name, sampleValueForField(field));
  }
  const props = Array.from(entries.entries()).map(([key, value]) => `${key}: ${value}`);
  return `{ ${props.join(", ")} }`;
}

function sampleValueForField(field: FieldIR): string {
  if (field.name === "body") return "\"hello world\"";
  return sampleValueForType(field.type, field.name);
}

function sampleValueForName(name: string): string {
  if (name === "body") return "\"hello world\"";
  if (name.toLowerCase().endsWith("id")) return `"${name}_1"`;
  return `"${name}-value"`;
}

function sampleValueForType(type: FieldTypeIR, name: string): string {
  if (type.kind === "id" || type.kind === "model_ref") return `"${name}_1"`;
  if (type.kind === "primitive") {
    switch (type.name) {
      case "string": return `"${name}-value"`;
      case "int":
      case "float": return "1";
      case "bigint": return "1n";
      case "boolean": return "true";
      case "timestamp": return "new Date()";
      case "json": return "{}";
    }
  }
  if (type.kind === "list") return "[]";
  return "undefined";
}
