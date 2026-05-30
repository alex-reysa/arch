import type { FieldIR, FieldTypeIR, ModelIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit a request/payload validator. We don't pull in a runtime dependency
 * (zod, ajv) — V1's validators are hand-rolled type-narrowing functions so
 * the generated project compiles without extra installs.
 */
export function renderValidator(model: ModelIR): string {
  const cls = pascal(model.name);
  const fields = model.fields.filter((f) => f.type.kind !== "id");
  const checks = fields.map((f) => renderCheck(f)).join("\n");
  const requiredFields = fields.filter((f) => !f.nullable && f.default === undefined);
  const optionalFields = fields.filter((f) => f.nullable || f.default !== undefined);
  const requiredKeys = requiredFields.map((f) => `"${f.name}"`).join(", ");
  // After the per-field `errors.length` short-circuit returns, every field is
  // known to be either present-and-narrowed (required) or undefined-or-narrowed
  // (optional). We construct `${cls}Input` field-by-field with a single
  // narrowing `as <type>` per field — no `as unknown as ${cls}Input` laundering
  // of the loosely-typed `Record<string, unknown>`.
  const requiredAssignments = requiredFields.map(
    (f) => `    ${f.name}: obj["${f.name}"] as ${tsType(f.type)},`,
  );
  const optionalSpreads = optionalFields.map(
    (f) =>
      `    ...(obj["${f.name}"] !== undefined ? { ${f.name}: obj["${f.name}"] as ${tsType(f.type)} } : {}),`,
  );
  return [
    "export interface ValidationFailure {",
    "  readonly ok: false;",
    "  readonly errors: readonly { path: string; message: string }[];",
    "}",
    "export interface ValidationSuccess<T> {",
    "  readonly ok: true;",
    "  readonly value: T;",
    "}",
    "export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;",
    "",
    `export interface ${cls}Input {`,
    fields.map((f) => `  ${f.name}${f.nullable || f.default !== undefined ? "?" : ""}: ${tsType(f.type)};`).join("\n"),
    "}",
    "",
    `export function validate${cls}(raw: unknown): ValidationResult<${cls}Input> {`,
    "  const errors: { path: string; message: string }[] = [];",
    `  if (typeof raw !== "object" || raw === null) {`,
    `    return { ok: false, errors: [{ path: "$", message: "expected object" }] };`,
    "  }",
    `  const obj = raw as Record<string, unknown>;`,
    `  const required: string[] = [${requiredKeys}];`,
    "  for (const k of required) {",
    `    if (!(k in obj)) errors.push({ path: k, message: "required" });`,
    "  }",
    checks,
    "  if (errors.length) return { ok: false, errors };",
    `  const value: ${cls}Input = {`,
    ...requiredAssignments,
    ...optionalSpreads,
    `  };`,
    `  return { ok: true, value };`,
    "}",
  ].join("\n");
}

function renderCheck(field: FieldIR): string {
  const path = field.name;
  const guard = guardForType(field.type, `obj["${path}"]`);
  const condition = field.nullable || field.default !== undefined
    ? `if (obj["${path}"] !== undefined && !(${guard}))`
    : `if (obj["${path}"] !== undefined && !(${guard}))`;
  // JSON.stringify the whole message so type descriptions containing quotes
  // (e.g. an enum union `"public" | "private"`) cannot break the string literal.
  const message = JSON.stringify(`expected ${describeTypeForMessage(field.type)}`);
  return `  ${condition} errors.push({ path: "${path}", message: ${message} });`;
}

/** A human-readable, quote-safe description of a field type for error messages. */
function describeTypeForMessage(t: FieldTypeIR): string {
  if (t.kind === "enum") return `one of: ${t.values.join(", ")}`;
  return tsType(t);
}

function guardForType(t: FieldTypeIR, expr: string): string {
  if (t.kind === "id") return `typeof ${expr} === "string"`;
  if (t.kind === "enum") {
    // Membership check: only the declared enum members are accepted.
    const members = t.values.map((v) => `${expr} === ${JSON.stringify(v)}`).join(" || ");
    return `(${members})`;
  }
  if (t.kind === "primitive") {
    switch (t.name) {
      case "string": return `typeof ${expr} === "string"`;
      case "int":
      case "float": return `typeof ${expr} === "number"`;
      case "bigint": return `typeof ${expr} === "bigint"`;
      case "boolean": return `typeof ${expr} === "boolean"`;
      case "timestamp": return `${expr} instanceof Date || typeof ${expr} === "string"`;
      case "json": return `${expr} !== undefined`;
    }
  }
  if (t.kind === "model_ref") return `typeof ${expr} === "string"`;
  if (t.kind === "list") return `Array.isArray(${expr})`;
  return "true";
}

function tsType(t: FieldTypeIR): string {
  if (t.kind === "id") return "string";
  if (t.kind === "enum") return t.values.map((v) => JSON.stringify(v)).join(" | ");
  if (t.kind === "primitive") {
    switch (t.name) {
      case "string": return "string";
      case "int":
      case "float": return "number";
      case "bigint": return "bigint";
      case "boolean": return "boolean";
      case "timestamp": return "Date | string";
      case "json": return "unknown";
    }
  }
  if (t.kind === "model_ref") return "string";
  if (t.kind === "list") return `${tsType(t.element)}[]`;
  return "unknown";
}
