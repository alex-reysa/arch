import type { ModelIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit a typed model wrapper. We re-export the row type from `runtime/db`
 * so workflow code has a stable import surface; collection access goes
 * through `db().<modelLower>`.
 */
export function renderModel(model: ModelIR): string {
  const cls = pascal(model.name);
  const lower = cls.toLowerCase();
  const insertableFields = model.fields.filter((f) => f.type.kind !== "id");
  const omitDefaults = insertableFields
    .filter((f) => f.default !== undefined)
    .map((f) => `"${f.name}"`)
    .join(" | ");
  const insertableType = omitDefaults
    ? `Partial<Pick<${cls}Row, ${omitDefaults}>> & Omit<${cls}Row, "id" | ${omitDefaults}>`
    : `Omit<${cls}Row, "id">`;
  const defaultsBlock = insertableFields
    .map((f) => renderRuntimeDefault(f))
    .filter((line): line is string => line !== null)
    .join("\n");

  return [
    `import { db, type ${cls}Row } from "../runtime/db.js";`,
    "",
    `export type ${cls} = ${cls}Row;`,
    `export type Insertable${cls} = ${insertableType};`,
    "",
    `export async function create${cls}(input: Insertable${cls}): Promise<${cls}> {`,
    "  const data = {",
    "    ...(input as object),",
    defaultsBlock,
    "  } as Omit<" + cls + "Row, \"id\">;",
    `  return db().${lower}.create(data);`,
    "}",
    "",
    `export async function find${cls}ById(id: string): Promise<${cls} | null> {`,
    `  return db().${lower}.findUnique({ id });`,
    "}",
    "",
    `export async function list${cls}s(): Promise<${cls}[]> {`,
    `  return db().${lower}.findMany();`,
    "}",
  ].join("\n");
}

function renderRuntimeDefault(field: ModelIR["fields"][number]): string | null {
  if (field.default === undefined) return null;
  if (isNowDefault(field)) {
    return `    ${field.name}: input.${field.name} ?? new Date(),`;
  }
  if (field.type.kind === "enum") {
    return typeof field.default === "string"
      ? `    ${field.name}: input.${field.name} ?? ${JSON.stringify(field.default)},`
      : null;
  }
  if (field.type.kind !== "primitive") return null;
  switch (field.type.name) {
    case "string":
      return typeof field.default === "string"
        ? `    ${field.name}: input.${field.name} ?? ${JSON.stringify(field.default)},`
        : null;
    case "int":
    case "float":
      return typeof field.default === "number" && Number.isFinite(field.default)
        ? `    ${field.name}: input.${field.name} ?? ${String(field.default)},`
        : null;
    case "bigint":
      return typeof field.default === "number" && Number.isFinite(field.default)
        ? `    ${field.name}: input.${field.name} ?? BigInt(${String(field.default)}),`
        : null;
    case "boolean":
      return typeof field.default === "boolean"
        ? `    ${field.name}: input.${field.name} ?? ${String(field.default)},`
        : null;
    case "timestamp":
      return typeof field.default === "string"
        ? `    ${field.name}: input.${field.name} ?? new Date(${JSON.stringify(field.default)}),`
        : null;
    case "json":
      return null;
  }
}

function isNowDefault(field: ModelIR["fields"][number]): boolean {
  if (field.type.kind !== "primitive" || field.type.name !== "timestamp") return false;
  const value = field.default;
  return value === "now" || (isRecord(value) && value["kind"] === "now");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
