import type { CanonicalIR, FieldTypeIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit an in-memory store with a Prisma-like API surface behind a stable
 * `Collection<R>` interface. The default `db()` is in-memory so the generated
 * tests run without a database connection. A real Prisma/Postgres adapter
 * (`runtime/db-prisma.ts`) implements the SAME `Collection<R>`/`Db` interface
 * and is swapped in at startup via `setDb()` when `ARCH_DB=prisma` — consumers
 * (`models/*`, route/workflow code, tests) never change.
 *
 * Each collection exposes `create`, `findUnique`, `findMany`, `update`,
 * `delete`, `count`, plus `reset()` for test teardown.
 */
export function renderRuntimeDb(ir: CanonicalIR): string {
  const models = ir.models.map((m) => pascal(m.name));
  const collections = models
    .map((n) => `    ${n.toLowerCase()}: makeCollection<${n}Row>("${n.toLowerCase()}"),`)
    .join("\n");
  const interfaces = ir.models.map((m) => {
    const rowFields = m.fields.map((f) => `  ${f.name}: ${tsType(f.type, ir)};`).join("\n");
    return `export interface ${pascal(m.name)}Row {\n${rowFields}\n}`;
  }).join("\n\n");
  const dbType = ir.models.length
    ? ir.models
        .map((m) => `  ${pascal(m.name).toLowerCase()}: Collection<${pascal(m.name)}Row>;`)
        .join("\n")
    : "  /* no models */";
  return [
    "export interface CollectionRow { readonly id: string; }",
    "",
    "/**",
    " * The persistence contract shared by the in-memory store and the",
    " * Prisma/Postgres adapter. Both implement this exact shape, so swapping",
    " * backends never touches the calling code.",
    " */",
    "export interface Collection<R extends CollectionRow> {",
    "  create(input: Omit<R, \"id\"> & { id?: string }): Promise<R>;",
    "  findUnique(where: { id: string }): Promise<R | null>;",
    "  findMany(): Promise<R[]>;",
    "  update(where: { id: string }, data: Partial<R>): Promise<R | null>;",
    "  delete(where: { id: string }): Promise<boolean>;",
    "  count(): Promise<number>;",
    "  reset(): void;",
    "}",
    "",
    interfaces,
    "",
    "function makeCollection<R extends CollectionRow>(name: string): Collection<R> {",
    "  const rows = new Map<string, R>();",
    "  let counter = 0;",
    "  return {",
    "    async create(input: Omit<R, \"id\"> & { id?: string }): Promise<R> {",
    "      const id = input.id ?? `${name}_${++counter}`;",
    "      const row = { ...(input as object), id } as R;",
    "      rows.set(id, row);",
    "      return row;",
    "    },",
    "    async findUnique(where: { id: string }): Promise<R | null> {",
    "      return rows.get(where.id) ?? null;",
    "    },",
    "    async findMany(): Promise<R[]> {",
    "      return Array.from(rows.values());",
    "    },",
    "    async update(where: { id: string }, data: Partial<R>): Promise<R | null> {",
    "      const cur = rows.get(where.id);",
    "      if (!cur) return null;",
    "      const next = { ...cur, ...data, id: cur.id } as R;",
    "      rows.set(where.id, next);",
    "      return next;",
    "    },",
    "    async delete(where: { id: string }): Promise<boolean> {",
    "      return rows.delete(where.id);",
    "    },",
    "    async count(): Promise<number> {",
    "      return rows.size;",
    "    },",
    "    reset(): void {",
    "      rows.clear();",
    "      counter = 0;",
    "    },",
    "  };",
    "}",
    "",
    "export interface Db {",
    dbType,
    "}",
    "",
    "export function createDb(): Db {",
    "  return {",
    collections,
    "  };",
    "}",
    "",
    "let _instance: Db | null = null;",
    "export function db(): Db {",
    "  if (!_instance) _instance = createDb();",
    "  return _instance;",
    "}",
    "",
    "/** Swap the active backend (used at startup to install the Prisma adapter). */",
    "export function setDb(next: Db): void {",
    "  _instance = next;",
    "}",
    "",
    "export function resetDb(): void {",
    "  _instance = createDb();",
    "}",
  ].join("\n");
}

function tsType(t: FieldTypeIR, ir: CanonicalIR): string {
  if (t.kind === "id") return "string";
  if (t.kind === "enum") return t.values.map((v) => JSON.stringify(v)).join(" | ");
  if (t.kind === "primitive") {
    switch (t.name) {
      case "string": return "string";
      case "int":
      case "float": return "number";
      case "bigint": return "bigint";
      case "boolean": return "boolean";
      case "timestamp": return "Date";
      case "json": return "unknown";
    }
  }
  if (t.kind === "model_ref") return "string"; // foreign key id
  if (t.kind === "list") return `${tsType(t.element, ir)}[]`;
  return "unknown";
}
