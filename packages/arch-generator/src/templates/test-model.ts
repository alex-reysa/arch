import type { FieldIR, ModelIR } from "@arch/ir";
import { pascal } from "../naming.js";

/** Emit a Vitest spec covering basic CRUD shapes for the model. */
export function renderModelTest(model: ModelIR): string {
  const cls = pascal(model.name);
  const sample = sampleObject(model);
  return [
    'import { beforeEach, describe, expect, it } from "vitest";',
    `import { create${cls}, find${cls}ById, list${cls}s } from "../../src/models/${cls}.js";`,
    'import { resetDb } from "../../src/runtime/db.js";',
    "",
    `describe("${cls} model", () => {`,
    "  beforeEach(() => resetDb());",
    "",
    "  it(\"creates and reads a row\", async () => {",
    `    const created = await create${cls}(${sample});`,
    "    expect(created.id).toBeTruthy();",
    `    const fetched = await find${cls}ById(created.id);`,
    "    expect(fetched).toEqual(created);",
    "  });",
    "",
    "  it(\"lists rows\", async () => {",
    `    await create${cls}(${sample});`,
    `    await create${cls}(${sample});`,
    `    const all = await list${cls}s();`,
    "    expect(all.length).toBe(2);",
    "  });",
    "});",
  ].join("\n");
}

function sampleObject(model: ModelIR): string {
  const parts: string[] = [];
  for (const f of model.fields) {
    if (f.type.kind === "id") continue;
    if (f.default !== undefined) continue;
    parts.push(`${f.name}: ${sampleValue(f)}`);
  }
  return `{ ${parts.join(", ")} }`;
}

function sampleValue(f: FieldIR): string {
  const t = f.type;
  if (t.kind === "id") return '"sample"';
  if (t.kind === "primitive") {
    switch (t.name) {
      case "string": return '"sample"';
      case "int":
      case "float": return "1";
      case "bigint": return "1n";
      case "boolean": return "true";
      case "timestamp": return "new Date(0)";
      case "json": return "{}";
    }
  }
  if (t.kind === "model_ref") return '"ref-id"';
  if (t.kind === "list") return "[]";
  return "null";
}
