import type { CanonicalIR, FieldIR, FieldTypeIR, ModelIR, ModelIndexIR } from "@arch/ir";
import { camel, pascal } from "../naming.js";

/**
 * Emit a Prisma schema: datasource + generator + one model per ModelIR.
 * Indexes come ONLY from field-level `indexed` modifiers — no composite or
 * named indexes (those are reserved for post-V1).
 */
export function renderPrismaSchema(ir: CanonicalIR): string {
  const relationPlan = buildRelationPlan(ir);
  const lines: string[] = [
    "datasource db {",
    "  provider = \"postgresql\"",
    "  url      = env(\"DATABASE_URL\")",
    "}",
    "",
    "generator client {",
    "  provider = \"prisma-client-js\"",
    "}",
    "",
  ];

  // Emit a Prisma enum type per enum-typed field, in deterministic order.
  for (const block of renderEnumBlocks(ir)) {
    lines.push(...block, "");
  }

  for (const m of ir.models) {
    lines.push(...renderModel(m, ir, relationPlan));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/** Pascal-cased Prisma enum type name for a model field, e.g. PostVisibility. */
export function enumTypeName(model: ModelIR, field: FieldIR): string {
  return `${pascal(model.name)}${pascal(field.name)}`;
}

function renderEnumBlocks(ir: CanonicalIR): string[][] {
  const blocks: string[][] = [];
  for (const m of ir.models) {
    for (const f of m.fields) {
      if (f.type.kind !== "enum") continue;
      blocks.push([
        `enum ${enumTypeName(m, f)} {`,
        ...f.type.values.map((v) => `  ${v}`),
        "}",
      ]);
    }
  }
  return blocks;
}

interface PersistedRelation {
  readonly sourceModel: ModelIR;
  readonly sourceField: FieldIR & { type: { readonly kind: "model_ref"; readonly target_model_id: string } };
  readonly targetModel: ModelIR;
  readonly relationName: string;
}

interface RelationPlan {
  readonly persisted: readonly PersistedRelation[];
  readonly relationFieldByFieldId: ReadonlyMap<string, string>;
  readonly explicitBackFieldByRelationKey: ReadonlyMap<string, string>;
  readonly syntheticBackFieldsByModelId: ReadonlyMap<string, readonly string[]>;
}

function renderModel(model: ModelIR, ir: CanonicalIR, relationPlan: RelationPlan): string[] {
  const out: string[] = [`model ${pascal(model.name)} {`];
  for (const f of model.fields) {
    out.push(`  ${renderField(f, ir, relationPlan, model)}`);
    if (f.type.kind === "model_ref") {
      const relation = relationPlan.persisted.find((r) => r.sourceField.id === f.id);
      const relationField = relationPlan.relationFieldByFieldId.get(f.id);
      if (relation && relationField) {
        out.push(`  ${renderPersistedRelationField(relation, relationField)}`);
      }
    }
  }
  for (const backField of relationPlan.syntheticBackFieldsByModelId.get(model.id) ?? []) {
    out.push(`  ${backField}`);
  }
  const indexes = renderIndexes(model);
  if (indexes.length) out.push(...indexes);
  return [...out, "}"];
}

function renderField(field: FieldIR, ir: CanonicalIR, relationPlan: RelationPlan, model: ModelIR): string {
  const type = field.type.kind === "enum"
    ? enumTypeName(model, field)
    : renderFieldType(field.type, ir);
  const optional = field.nullable ? "?" : "";
  const attrs: string[] = [];

  if (field.type.kind === "id") {
    attrs.push("@id", "@default(cuid())");
  }
  if (field.default !== undefined && field.type.kind !== "id") {
    const renderedDefault = renderDefault(field);
    if (renderedDefault) attrs.push(renderedDefault);
  }
  if (field.type.kind === "list") {
    const relationName = renderListRelationName(field, relationPlan);
    if (relationName) attrs.push(`@relation("${relationName}")`);
  }

  return `${field.name} ${type}${optional}${attrs.length ? " " + attrs.join(" ") : ""}`;
}

function renderFieldType(type: FieldTypeIR, ir: CanonicalIR): string {
  if (type.kind === "id") return "String";
  if (type.kind === "primitive") {
    switch (type.name) {
      case "string": return "String";
      case "int": return "Int";
      case "bigint": return "BigInt";
      case "float": return "Float";
      case "boolean": return "Boolean";
      case "timestamp": return "DateTime";
      case "json": return "Json";
    }
  }
  if (type.kind === "model_ref") {
    return "String";
  }
  if (type.kind === "list") {
    const element = type.element;
    if (element.kind === "model_ref") {
      const target = ir.models.find((m) => m.id === element.target_model_id);
      return `${pascal(target?.name ?? "Unknown")}[]`;
    }
    return `${renderFieldType(element, ir)}[]`;
  }
  return "String";
}

function renderPersistedRelationField(relation: PersistedRelation, relationField: string): string {
  const sourceField = relation.sourceField;
  const targetType = pascal(relation.targetModel.name);
  const optional = sourceField.nullable ? "?" : "";
  return `${relationField} ${targetType}${optional} @relation("${relation.relationName}", fields: [${sourceField.name}], references: [${targetIdFieldName(relation.targetModel)}])`;
}

function renderListRelationName(field: FieldIR, relationPlan: RelationPlan): string | null {
  const fieldType = field.type;
  if (fieldType.kind !== "list") return null;
  const element = fieldType.element;
  if (element.kind !== "model_ref") return null;
  const targetId = element.target_model_id;
  for (const [key, fieldName] of relationPlan.explicitBackFieldByRelationKey.entries()) {
    if (fieldName !== field.name) continue;
    const relation = relationPlan.persisted.find((r) => relationKey(r) === key);
    if (relation?.sourceModel.id === targetId) return relation.relationName;
  }
  return null;
}

function renderIndexes(model: ModelIR): string[] {
  const indexes = new Map<string, ModelIndexIR | { readonly fields: readonly string[]; readonly unique: false }>();
  for (const index of model.indexes) {
    indexes.set(index.fields.join("\u0000"), index);
  }
  for (const field of model.fields) {
    if (field.type.kind === "id" || !field.indexed) continue;
    const key = field.name;
    if (!indexes.has(key)) indexes.set(key, { fields: [field.name], unique: false });
  }
  return [...indexes.values()].map((index) => {
    const fields = index.fields.join(", ");
    return index.unique ? `  @@unique([${fields}])` : `  @@index([${fields}])`;
  });
}

function renderDefault(field: FieldIR): string | null {
  if (isNowDefault(field)) return "@default(now())";
  if (field.type.kind === "enum") {
    // Prisma enum defaults reference the member identifier (unquoted).
    return typeof field.default === "string" ? `@default(${field.default})` : null;
  }
  if (field.type.kind !== "primitive") return null;
  const value = field.default;
  switch (field.type.name) {
    case "string":
      return typeof value === "string" ? `@default(${JSON.stringify(value)})` : null;
    case "int":
    case "bigint":
    case "float":
      return typeof value === "number" && Number.isFinite(value) ? `@default(${String(value)})` : null;
    case "boolean":
      return typeof value === "boolean" ? `@default(${String(value)})` : null;
    case "timestamp":
    case "json":
      return null;
  }
}

function isNowDefault(field: FieldIR): boolean {
  if (field.type.kind !== "primitive" || field.type.name !== "timestamp") return false;
  const value = field.default;
  return value === "now" || (isRecord(value) && value["kind"] === "now");
}

function buildRelationPlan(ir: CanonicalIR): RelationPlan {
  const persisted = ir.models.flatMap((sourceModel) =>
    sourceModel.fields.flatMap((field): PersistedRelation[] => {
      const fieldType = field.type;
      if (fieldType.kind !== "model_ref") return [];
      const targetModel = ir.models.find((m) => m.id === fieldType.target_model_id);
      if (!targetModel) return [];
      return [{
        sourceModel,
        sourceField: field as FieldIR & { type: { readonly kind: "model_ref"; readonly target_model_id: string } },
        targetModel,
        relationName: `${pascal(sourceModel.name)}_${field.name}_${pascal(targetModel.name)}`,
      }];
    }),
  );

  const occupiedByModel = new Map<string, Set<string>>();
  for (const model of ir.models) {
    occupiedByModel.set(model.id, new Set(model.fields.map((f) => f.name)));
  }

  const relationFieldByFieldId = new Map<string, string>();
  for (const relation of persisted) {
    const occupied = occupiedByModel.get(relation.sourceModel.id) ?? new Set<string>();
    const base = relationFieldBaseName(relation.sourceField, relation.targetModel);
    const name = uniqueName(base, occupied);
    relationFieldByFieldId.set(relation.sourceField.id, name);
  }

  const explicitBackFieldByRelationKey = new Map<string, string>();
  const usedRelationKeys = new Set<string>();
  for (const model of ir.models) {
    for (const field of model.fields) {
      const fieldType = field.type;
      if (fieldType.kind !== "list") continue;
      const element = fieldType.element;
      if (element.kind !== "model_ref") continue;
      const relation = persisted.find((candidate) =>
        candidate.sourceModel.id === element.target_model_id &&
        candidate.targetModel.id === model.id &&
        !usedRelationKeys.has(relationKey(candidate)),
      );
      if (!relation) continue;
      const key = relationKey(relation);
      explicitBackFieldByRelationKey.set(key, field.name);
      usedRelationKeys.add(key);
    }
  }

  const syntheticBackFieldsByModelId = new Map<string, string[]>();
  for (const relation of persisted) {
    if (explicitBackFieldByRelationKey.has(relationKey(relation))) continue;
    const occupied = occupiedByModel.get(relation.targetModel.id) ?? new Set<string>();
    const fieldName = uniqueName(`${camel(relation.sourceModel.name)}s`, occupied);
    const rendered = `${fieldName} ${pascal(relation.sourceModel.name)}[] @relation("${relation.relationName}")`;
    const fields = syntheticBackFieldsByModelId.get(relation.targetModel.id) ?? [];
    fields.push(rendered);
    syntheticBackFieldsByModelId.set(relation.targetModel.id, fields);
  }

  return {
    persisted,
    relationFieldByFieldId,
    explicitBackFieldByRelationKey,
    syntheticBackFieldsByModelId,
  };
}

function relationFieldBaseName(field: FieldIR, target: ModelIR): string {
  if (field.name.endsWith("Id") && field.name.length > 2) {
    return camel(field.name.slice(0, -2));
  }
  if (field.name.endsWith("_id") && field.name.length > 3) {
    return camel(field.name.slice(0, -3));
  }
  return camel(target.name);
}

function uniqueName(base: string, occupied: Set<string>): string {
  let candidate = base || "relation";
  if (!occupied.has(candidate)) {
    occupied.add(candidate);
    return candidate;
  }
  let i = 2;
  while (occupied.has(`${candidate}${i}`)) i += 1;
  candidate = `${candidate}${i}`;
  occupied.add(candidate);
  return candidate;
}

function relationKey(relation: PersistedRelation): string {
  return relation.sourceField.id;
}

function targetIdFieldName(model: ModelIR): string {
  return model.fields.find((f) => f.type.kind === "id")?.name ?? "id";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
