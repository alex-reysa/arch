import { describe, expect, it } from "vitest";
import type { CanonicalIR, ModelIR } from "@arch/ir";
import { renderPrismaSchema } from "../prisma-schema.js";
import { renderValidator } from "../validator.js";
import { renderModel } from "../model.js";
import { renderRuntimeDb } from "../runtime-db.js";

function postModel(): ModelIR {
  return {
    id: "model:Post",
    kind: "model",
    name: "Post",
    fields: [
      { id: "field:Post.id", kind: "field", name: "id", model_id: "model:Post", type: { kind: "id" }, nullable: false, indexed: false },
      { id: "field:Post.body", kind: "field", name: "body", model_id: "model:Post", type: { kind: "primitive", name: "string" }, nullable: false, indexed: false },
      { id: "field:Post.visibility", kind: "field", name: "visibility", model_id: "model:Post", type: { kind: "enum", values: ["public", "private", "followers"] }, nullable: false, default: "public", indexed: true },
    ],
    indexes: [
      { id: "index:Post.visibility", kind: "model_index", name: "Post.visibility", model_id: "model:Post", fields: ["visibility"], source: "field_modifier", unique: false },
    ],
  } as unknown as ModelIR;
}

function postIR(): CanonicalIR {
  return {
    schema_version: "arch.ir.v1",
    canonical_hash: "h",
    target: { stack: "ts.node.fastify.postgres.prisma", cache: "redis" },
    models: [postModel()],
    integrations: [],
    policies: [],
    workflows: [],
    customs: [],
    artifacts: [],
    ownership: [],
    verification: { typecheck: true, tests: true, migrations: true },
    guarantee_coverage: [],
    source_locations: [],
  } as unknown as CanonicalIR;
}

describe("generator: enum fields", () => {
  it("prisma schema emits a Prisma enum type, typed field, and enum default", () => {
    const schema = renderPrismaSchema(postIR());
    expect(schema).toContain("enum PostVisibility {");
    expect(schema).toContain("public");
    expect(schema).toContain("private");
    expect(schema).toContain("followers");
    expect(schema).toMatch(/visibility\s+PostVisibility/);
    expect(schema).toContain("@default(public)");
  });

  it("validator narrows enum field to the allowed members and rejects others", () => {
    const code = renderValidator(postModel());
    // TS union type for the field
    expect(code).toMatch(/visibility[^;]*"public"\s*\|\s*"private"\s*\|\s*"followers"/);
    // runtime membership guard referencing each allowed value
    expect(code).toContain('"public"');
    expect(code).toContain('"private"');
    expect(code).toContain('"followers"');
  });

  it("runtime db row types the enum field as a union of its members", () => {
    const code = renderRuntimeDb(postIR());
    expect(code).toMatch(/visibility:\s*"public"\s*\|\s*"private"\s*\|\s*"followers"/);
  });

  it("model applies the enum default at create time", () => {
    const code = renderModel(postModel());
    expect(code).toContain('visibility: input.visibility ?? "public"');
  });
});
