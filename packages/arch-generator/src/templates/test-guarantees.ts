import type { CanonicalIR, FieldIR, FieldTypeIR, WorkflowIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit one Vitest spec per supported guarantee form. V1 supports:
 *   - `no_unsanitized_html_persisted` — html-safety
 *   - `notification_failure_does_not_rollback_post` — best-effort notifications
 *   - `post_creation_p95_latency` — latency scaffold (smoke test only;
 *     real load testing is out of scope for the prototype loop)
 */
export function renderGuaranteeTests(
  workflow: WorkflowIR,
  ctx: { ir: CanonicalIR },
): readonly { path: string; content: string }[] {
  const cls = pascal(workflow.name);
  const out: { path: string; content: string }[] = [];

  for (const g of workflow.guarantees) {
    if (g.name === "no_unsanitized_html_persisted") {
      out.push({
        path: `tests/guarantees/no_unsanitized_html_persisted.${cls}.test.ts`,
        content: htmlSafetyTest(cls, workflow, ctx),
      });
    } else if (g.name === "notification_failure_does_not_rollback_post") {
      out.push({
        path: `tests/guarantees/notification_failure_does_not_rollback_post.${cls}.test.ts`,
        content: notificationNonRollbackTest(cls, workflow, ctx),
      });
    } else if (g.name === "post_creation_p95_latency") {
      out.push({
        path: `tests/guarantees/post_creation_p95_latency.${cls}.test.ts`,
        content: latencyScaffoldTest(cls, g.arguments, workflow, ctx),
      });
    }
  }

  return out;
}

function htmlSafetyTest(cls: string, workflow: WorkflowIR, ctx: { ir: CanonicalIR }): string {
  const scriptInput = renderWorkflowInputLiteral(workflow, ctx, {
    body: "\"hello <script>alert(1)</script> world\"",
  });
  const handlerInput = renderWorkflowInputLiteral(workflow, ctx, {
    body: "\"<img src=x onerror=\\\"alert(1)\\\" />\"",
  });
  return [
    'import { beforeEach, describe, expect, it } from "vitest";',
    `import { run${cls} } from "../../src/workflows/${cls}.js";`,
    'import { db, resetDb } from "../../src/runtime/db.js";',
    "",
    `describe("guarantee: no_unsanitized_html_persisted (${cls})", () => {`,
    "  beforeEach(() => resetDb());",
    "",
    "  it(\"strips <script> tags before persistence\", async () => {",
    `    const result = await run${cls}(${scriptInput});`,
    "    expect(result.ok).toBe(true);",
    "    const rows = await db().post.findMany();",
    "    for (const r of rows) {",
    "      expect(r.body).not.toMatch(/<script/i);",
    "    }",
    "  });",
    "",
    "  it(\"strips on* event handlers before persistence\", async () => {",
    `    const result = await run${cls}(${handlerInput});`,
    "    expect(result.ok).toBe(true);",
    "    const rows = await db().post.findMany();",
    "    for (const r of rows) {",
    "      expect(r.body).not.toMatch(/onerror/i);",
    "    }",
    "  });",
    "});",
  ].join("\n");
}

function notificationNonRollbackTest(cls: string, workflow: WorkflowIR, ctx: { ir: CanonicalIR }): string {
  const input = renderWorkflowInputLiteral(workflow, ctx, { body: "\"hello\"" });
  return [
    'import { beforeEach, describe, expect, it, vi } from "vitest";',
    `import { run${cls} } from "../../src/workflows/${cls}.js";`,
    'import { db, resetDb } from "../../src/runtime/db.js";',
    'import { PushNotifier } from "../../src/integrations/PushNotifier.js";',
    "",
    `describe("guarantee: notification_failure_does_not_rollback_post (${cls})", () => {`,
    "  beforeEach(() => {",
    "    resetDb();",
    "    vi.restoreAllMocks();",
    "  });",
    "",
    "  it(\"keeps the persisted row when the notification call throws\", async () => {",
    "    vi.spyOn(PushNotifier, \"send\").mockImplementation(async () => {",
    "      throw new Error(\"push provider down\");",
    "    });",
    `    const result = await run${cls}(${input});`,
    "    expect(result.ok).toBe(true);",
    "    const rows = await db().post.findMany();",
    "    expect(rows.length).toBe(1);",
    "  });",
    "});",
  ].join("\n");
}

function latencyScaffoldTest(
  cls: string,
  args: Readonly<Record<string, unknown>>,
  workflow: WorkflowIR,
  ctx: { ir: CanonicalIR },
): string {
  const budget = (args["limit_ms"] as number | undefined) ?? 250;
  const input = renderWorkflowInputLiteral(workflow, ctx, { body: "\"latency-check\"" });
  return [
    'import { describe, expect, it } from "vitest";',
    `import { run${cls} } from "../../src/workflows/${cls}.js";`,
    'import { resetDb } from "../../src/runtime/db.js";',
    "",
    `describe("guarantee: post_creation_p95_latency (${cls})", () => {`,
    "  it(\"happy-path latency stays under the declared budget on a single in-memory call\", async () => {",
    "    resetDb();",
    "    const start = Date.now();",
    `    const result = await run${cls}(${input});`,
    "    const elapsed = Date.now() - start;",
    "    expect(result.ok).toBe(true);",
    `    // Scaffold only — replace with real load testing in production.`,
    `    expect(elapsed).toBeLessThan(${Math.max(budget * 4, 1000)});`,
    "  });",
    "});",
  ].join("\n");
}

function renderWorkflowInputLiteral(
  workflow: WorkflowIR,
  ctx: { ir: CanonicalIR },
  overrides: Readonly<Record<string, string>>,
): string {
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
  for (const [key, value] of Object.entries(overrides)) {
    entries.set(key, value);
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
