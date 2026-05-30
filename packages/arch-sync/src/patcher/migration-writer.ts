/**
 * Render a deterministic Prisma migration SQL scaffold for a single supported
 * additive `DiffV1`.
 *
 * The sync engine owns migration generation because it is the only layer that
 * has both the typed diff (what changed) and the canonical IR (the column
 * types). The generator package intentionally does not depend on `@arch/sync`,
 * so the SQL DDL mapping lives here next to the diff types.
 *
 * Output is an inspectable scaffold — a developer (or `prisma migrate diff`)
 * reviews it before it touches a database. It is NOT applied automatically.
 * Destructive diffs return `null`; the planner blocks them before apply.
 */

import type { CanonicalIR, FieldIR, FieldTypeIR, ModelIR, ModelIndexIR } from "@arch/ir";
import type { DiffV1 } from "../diff/diff-schema.js";

/** Pascal-case identical to the generator/artifact-resolver path scheme so
 * SQL table names match `prisma/schema.prisma` model names. */
function pascal(name: string): string {
  return name.replace(/(^\w|[_-]\w)/g, (m) => m.replace(/[_-]/, "").toUpperCase());
}

/** Render the migration SQL for one diff, or null if the diff maps to none. */
export function renderMigrationSqlForDiff(
  diff: DiffV1,
  current: CanonicalIR,
): string | null {
  switch (diff.type) {
    case "model_field_added": {
      const model = current.models.find((m) => m.id === diff.model_id);
      const field = model?.fields.find((f) => f.id === diff.field_id);
      if (!model || !field) return null;
      // Inverse/list relation views are non-persisted: no column to add.
      if (field.type.kind === "list") return null;
      return header(diff) + addColumnSql(model, field) + "\n";
    }
    case "model_index_added": {
      const model = current.models.find((m) => m.id === diff.model_id);
      const index = model?.indexes.find((i) => i.id === diff.index_id);
      if (!model || !index) return null;
      return header(diff) + addIndexSql(model, index) + "\n";
    }
    case "model_added": {
      const model = current.models.find((m) => m.id === diff.model_id);
      if (!model) return null;
      return header(diff) + createTableSql(model) + "\n";
    }
    default:
      // Destructive (removed/type-changed) and non-schema diffs do not produce
      // an automatic migration in V1.
      return null;
  }
}

/** Full initial-generation migration: enum types, one CREATE TABLE per model, indexes. */
export function renderInitialMigrationSql(current: CanonicalIR): string {
  const blocks: string[] = [];
  // Enum types must exist before the columns that reference them.
  for (const m of current.models) {
    for (const f of m.fields) {
      if (f.type.kind !== "enum") continue;
      const typeNm = `${pascal(m.name)}${pascal(f.name)}`;
      const members = f.type.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
      blocks.push(`CREATE TYPE "${typeNm}" AS ENUM (${members});`);
    }
  }
  for (const m of current.models) blocks.push(createTableSql(m));
  for (const m of current.models) {
    for (const index of m.indexes) blocks.push(addIndexSql(m, index));
  }
  return (
    "-- Arch-generated initial migration scaffold. Review before applying.\n" +
    "-- This reflects the canonical IR at first generation.\n\n" +
    blocks.join("\n\n") +
    "\n"
  );
}

// -------------------------------------------------------------------------
// SQL builders.
// -------------------------------------------------------------------------

function header(diff: DiffV1): string {
  return (
    "-- Arch-generated migration scaffold. Review before applying.\n" +
    `-- diff: ${diff.diff_id}\n\n`
  );
}

function addColumnSql(model: ModelIR, field: FieldIR): string {
  const notNull = field.nullable ? "" : " NOT NULL";
  const def = renderDefaultClause(field);
  if (field.type.kind === "enum") {
    // A Postgres enum-backed column needs its type created first. The type
    // name matches the Prisma enum name (Model + Field, pascal-cased).
    const typeNm = `${pascal(model.name)}${pascal(field.name)}`;
    const members = field.type.values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
    return (
      `CREATE TYPE "${typeNm}" AS ENUM (${members});\n` +
      `ALTER TABLE "${tableName(model)}" ADD COLUMN "${field.name}" "${typeNm}"${notNull}${def};`
    );
  }
  const type = sqlColumnType(field.type);
  return `ALTER TABLE "${tableName(model)}" ADD COLUMN "${field.name}" ${type}${notNull}${def};`;
}

function addIndexSql(model: ModelIR, index: ModelIndexIR): string {
  const cols = index.fields.map((f) => `"${f}"`).join(", ");
  const unique = index.unique ? "UNIQUE " : "";
  return `CREATE ${unique}INDEX "${indexName(model, index)}" ON "${tableName(model)}" (${cols});`;
}

function createTableSql(model: ModelIR): string {
  const cols: string[] = [];
  for (const f of model.fields) {
    if (f.type.kind === "list") continue; // non-persisted relation views
    const type =
      f.type.kind === "enum"
        ? `"${pascal(model.name)}${pascal(f.name)}"`
        : sqlColumnType(f.type);
    const pk = f.type.kind === "id" ? " PRIMARY KEY" : "";
    const notNull = f.nullable || f.type.kind === "id" ? "" : " NOT NULL";
    const def = renderDefaultClause(f);
    cols.push(`  "${f.name}" ${type}${pk}${notNull}${def}`);
  }
  return `CREATE TABLE "${tableName(model)}" (\n${cols.join(",\n")}\n);`;
}

export function sqlColumnType(type: FieldTypeIR): string {
  if (type.kind === "id") return "TEXT";
  if (type.kind === "model_ref") return "TEXT"; // foreign-key id column
  if (type.kind === "list") return "TEXT"; // unreachable for persisted columns
  if (type.kind === "primitive") {
    switch (type.name) {
      case "string": return "TEXT";
      case "int": return "INTEGER";
      case "bigint": return "BIGINT";
      case "float": return "DOUBLE PRECISION";
      case "boolean": return "BOOLEAN";
      case "timestamp": return "TIMESTAMP(3)";
      case "json": return "JSONB";
    }
  }
  return "TEXT";
}

function renderDefaultClause(field: FieldIR): string {
  if (field.default === undefined) return "";
  const value = field.default;
  if (isNowDefault(field)) return " DEFAULT CURRENT_TIMESTAMP";
  if (typeof value === "string") return ` DEFAULT '${value.replace(/'/g, "''")}'`;
  if (typeof value === "number" && Number.isFinite(value)) return ` DEFAULT ${String(value)}`;
  if (typeof value === "boolean") return ` DEFAULT ${value ? "TRUE" : "FALSE"}`;
  return "";
}

function isNowDefault(field: FieldIR): boolean {
  if (field.type.kind !== "primitive" || field.type.name !== "timestamp") return false;
  const value = field.default;
  return value === "now" || (isRecord(value) && value["kind"] === "now");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tableName(model: ModelIR): string {
  return pascal(model.name);
}

export function indexName(model: ModelIR, index: ModelIndexIR): string {
  return `${pascal(model.name)}_${index.fields.join("_")}_idx`;
}
