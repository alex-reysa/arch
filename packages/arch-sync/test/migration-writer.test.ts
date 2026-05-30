import { describe, expect, it } from "vitest";
import type { CanonicalIR } from "@arch/ir";
import type { DiffV1 } from "../src/diff/diff-schema.js";
import { renderMigrationSqlForDiff } from "../src/patcher/migration-writer.js";

function postIR(): CanonicalIR {
  return {
    schema_version: "arch.ir.v1",
    canonical_hash: "h",
    target: { stack: "ts.node.fastify.postgres.prisma", cache: "redis" },
    models: [
      {
        id: "model:Post",
        kind: "model",
        name: "Post",
        fields: [
          { id: "field:Post.id", kind: "field", name: "id", model_id: "model:Post", type: { kind: "id" }, nullable: false, indexed: false },
          { id: "field:Post.body", kind: "field", name: "body", model_id: "model:Post", type: { kind: "primitive", name: "string" }, nullable: false, indexed: false },
          { id: "field:Post.visibility", kind: "field", name: "visibility", model_id: "model:Post", type: { kind: "primitive", name: "string" }, nullable: false, default: "public", indexed: true },
          { id: "field:Post.archived", kind: "field", name: "archived", model_id: "model:Post", type: { kind: "primitive", name: "boolean" }, nullable: true, indexed: false },
        ],
        indexes: [
          { id: "index:Post.visibility", kind: "model_index", name: "Post.visibility", model_id: "model:Post", fields: ["visibility"], source: "field_modifier", unique: false },
        ],
      },
    ],
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

function common(diff_id: string): Omit<Extract<DiffV1, { type: "model_field_added" }>, "type" | "model_id" | "field_id" | "nullable" | "has_default" | "required_without_default"> {
  return {
    diff_id,
    entity_ids: [],
    risk: "modifying",
    requires_confirmation: false,
    confirmation_kinds: [],
    affected_entity_hints: [],
    reason: "test",
  };
}

describe("renderMigrationSqlForDiff", () => {
  it("emits ALTER TABLE ADD COLUMN with type + default for a required defaulted field", () => {
    const diff: DiffV1 = {
      ...common("diff.model_field_added.field_Post_visibility"),
      type: "model_field_added",
      model_id: "model:Post",
      field_id: "field:Post.visibility",
      nullable: false,
      has_default: true,
      required_without_default: false,
    };
    const sql = renderMigrationSqlForDiff(diff, postIR());
    expect(sql).not.toBeNull();
    expect(sql!).toContain('ALTER TABLE "Post" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT \'public\'');
  });

  it("omits NOT NULL for a nullable added field and maps boolean type", () => {
    const diff: DiffV1 = {
      ...common("diff.model_field_added.field_Post_archived"),
      type: "model_field_added",
      model_id: "model:Post",
      field_id: "field:Post.archived",
      nullable: true,
      has_default: false,
      required_without_default: false,
    };
    const sql = renderMigrationSqlForDiff(diff, postIR());
    expect(sql!).toContain('ALTER TABLE "Post" ADD COLUMN "archived" BOOLEAN');
    expect(sql!).not.toContain("NOT NULL");
  });

  it("emits CREATE INDEX for an added field-level index", () => {
    const diff: DiffV1 = {
      ...common("diff.model_index_added.index_Post_visibility"),
      risk: "additive",
      type: "model_index_added",
      model_id: "model:Post",
      index_id: "index:Post.visibility",
    } as DiffV1;
    const sql = renderMigrationSqlForDiff(diff, postIR());
    expect(sql!).toContain('CREATE INDEX "Post_visibility_idx" ON "Post" ("visibility")');
  });

  it("returns null for a non-schema diff (guarantee)", () => {
    const diff = {
      ...common("diff.guarantee_added.x"),
      risk: "additive",
      type: "guarantee_added",
      workflow_id: "workflow:CreatePost",
      guarantee_id: "guarantee:x",
    } as unknown as DiffV1;
    expect(renderMigrationSqlForDiff(diff, postIR())).toBeNull();
  });

  it("is deterministic", () => {
    const diff: DiffV1 = {
      ...common("diff.model_field_added.field_Post_visibility"),
      type: "model_field_added",
      model_id: "model:Post",
      field_id: "field:Post.visibility",
      nullable: false,
      has_default: true,
      required_without_default: false,
    };
    expect(renderMigrationSqlForDiff(diff, postIR())).toBe(renderMigrationSqlForDiff(diff, postIR()));
  });
});
