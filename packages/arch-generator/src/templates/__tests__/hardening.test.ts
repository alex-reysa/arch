import type { CanonicalIR } from "@arch/ir";
import { describe, expect, it } from "vitest";
import { generate } from "../../generator.js";

function socialFeedV2IR(): CanonicalIR {
  return {
    schema_version: "arch.ir.v1",
    canonical_hash: "m5-hardening",
    target: { stack: "ts.node.fastify.postgres.prisma", cache: "redis" },
    models: [
      {
        id: "model:User",
        kind: "model",
        name: "User",
        fields: [
          { id: "field:User.id", kind: "field", name: "id", model_id: "model:User", type: { kind: "id" }, nullable: false, indexed: false },
          { id: "field:User.email", kind: "field", name: "email", model_id: "model:User", type: { kind: "primitive", name: "string" }, nullable: false, indexed: true },
          { id: "field:User.handle", kind: "field", name: "handle", model_id: "model:User", type: { kind: "primitive", name: "string" }, nullable: false, indexed: true },
          { id: "field:User.createdAt", kind: "field", name: "createdAt", model_id: "model:User", type: { kind: "primitive", name: "timestamp" }, nullable: false, default: { kind: "now" }, indexed: false },
        ],
        indexes: [
          { id: "model_index:User.email", kind: "model_index", name: "User.email", model_id: "model:User", fields: ["email"], source: "field_modifier", unique: false },
          { id: "model_index:User.handle", kind: "model_index", name: "User.handle", model_id: "model:User", fields: ["handle"], source: "field_modifier", unique: true },
        ],
      },
      {
        id: "model:Post",
        kind: "model",
        name: "Post",
        fields: [
          { id: "field:Post.id", kind: "field", name: "id", model_id: "model:Post", type: { kind: "id" }, nullable: false, indexed: false },
          { id: "field:Post.authorId", kind: "field", name: "authorId", model_id: "model:Post", type: { kind: "model_ref", target_model_id: "model:User" }, nullable: false, indexed: false },
          { id: "field:Post.body", kind: "field", name: "body", model_id: "model:Post", type: { kind: "primitive", name: "string" }, nullable: false, indexed: false },
          { id: "field:Post.visibility", kind: "field", name: "visibility", model_id: "model:Post", type: { kind: "primitive", name: "string" }, nullable: false, default: "public", indexed: true },
          { id: "field:Post.likeCount", kind: "field", name: "likeCount", model_id: "model:Post", type: { kind: "primitive", name: "int" }, nullable: false, default: 0, indexed: false },
          { id: "field:Post.featured", kind: "field", name: "featured", model_id: "model:Post", type: { kind: "primitive", name: "boolean" }, nullable: false, default: false, indexed: false },
          { id: "field:Post.score", kind: "field", name: "score", model_id: "model:Post", type: { kind: "primitive", name: "float" }, nullable: false, default: 1.5, indexed: false },
          { id: "field:Post.createdAt", kind: "field", name: "createdAt", model_id: "model:Post", type: { kind: "primitive", name: "timestamp" }, nullable: false, default: { kind: "now" }, indexed: true },
        ],
        indexes: [
          { id: "model_index:Post.visibility", kind: "model_index", name: "Post.visibility", model_id: "model:Post", fields: ["visibility"], source: "field_modifier", unique: false },
          { id: "model_index:Post.createdAt", kind: "model_index", name: "Post.createdAt", model_id: "model:Post", fields: ["createdAt"], source: "field_modifier", unique: false },
        ],
      },
    ],
    integrations: [],
    policies: [
      { id: "policy:sanitizeHtml", kind: "policy", name: "sanitizeHtml", body: "strip script tags and on* attributes from inputs" },
    ],
    workflows: [
      {
        id: "workflow:CreatePost",
        kind: "workflow",
        name: "CreatePost",
        trigger: { kind: "api", method: "POST", path: "/posts", auth: "none" },
        steps: [
          { id: "step:CreatePost.0.validate", kind: "workflow_step", name: "CreatePost.0.validate", workflow_id: "workflow:CreatePost", order: 0, operation: { kind: "validate", target: "body" } },
          { id: "step:CreatePost.1.sanitize", kind: "workflow_step", name: "CreatePost.1.sanitize", workflow_id: "workflow:CreatePost", order: 1, operation: { kind: "sanitize", target: "body", policy_id: "policy:sanitizeHtml" } },
          { id: "step:CreatePost.2.insert", kind: "workflow_step", name: "CreatePost.2.insert", workflow_id: "workflow:CreatePost", order: 2, operation: { kind: "insert", model_id: "model:Post" } },
        ],
        guarantees: [],
      },
    ],
    customs: [],
    artifacts: [],
    ownership: [],
    verification: { typecheck: true, tests: true, migrations: true },
    guarantee_coverage: [],
    source_locations: [],
  };
}

function generated(path: string): string {
  const file = generate(socialFeedV2IR()).files.find((f) => f.path === path);
  expect(file, `expected generated file ${path}`).toBeTruthy();
  return file!.content;
}

describe("M5 generator hardening", () => {
  it("pins generated pnpm metadata and allows required build dependencies", () => {
    const pkg = JSON.parse(generated("package.json")) as {
      packageManager?: string;
      pnpm?: { onlyBuiltDependencies?: string[] };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.packageManager).toBe("pnpm@9.0.0");
    expect(pkg.dependencies).toMatchObject({
      "@prisma/client": expect.any(String),
      fastify: expect.any(String),
      ioredis: expect.any(String),
    });
    expect(pkg.devDependencies).toMatchObject({
      prisma: expect.any(String),
      typescript: expect.any(String),
      vitest: expect.any(String),
    });
    expect([
      ...Object.values(pkg.dependencies ?? {}),
      ...Object.values(pkg.devDependencies ?? {}),
    ]).not.toContainEqual(expect.stringMatching(/^[~^]/));
    expect(pkg.pnpm?.onlyBuiltDependencies).toEqual([
      "@prisma/client",
      "@prisma/engines",
      "esbuild",
      "prisma",
    ]);
  });

  it("renders valid Prisma relations, defaults, and non-unique field indexes", () => {
    const schema = generated("prisma/schema.prisma");

    expect(schema).toContain("authorId String");
    expect(schema).toContain('author User @relation("Post_authorId_User", fields: [authorId], references: [id])');
    expect(schema).toContain('posts Post[] @relation("Post_authorId_User")');
    expect(schema).not.toContain("authorId User");

    expect(schema).toContain('visibility String @default("public")');
    expect(schema).toContain("likeCount Int @default(0)");
    expect(schema).toContain("featured Boolean @default(false)");
    expect(schema).toContain("score Float @default(1.5)");
    expect(schema).toContain("createdAt DateTime @default(now())");

    expect(schema).toContain("@@index([email])");
    expect(schema).toContain("@@index([visibility])");
    expect(schema).toContain("@@index([createdAt])");
    expect(schema).toContain("@@unique([handle])");
    expect(schema).not.toMatch(/\bemail String @unique\b/);
    expect(schema).not.toMatch(/\bvisibility String @unique\b/);
  });

  it("materializes non-now model defaults in the generated create helper", () => {
    const model = generated("src/models/Post.ts");

    expect(model).toContain('visibility: input.visibility ?? "public",');
    expect(model).toContain("likeCount: input.likeCount ?? 0,");
    expect(model).toContain("featured: input.featured ?? false,");
    expect(model).toContain("score: input.score ?? 1.5,");
    expect(model).toContain("createdAt: input.createdAt ?? new Date(),");
  });

  it("validates insert payloads with the generated model validator before persisting", () => {
    const workflow = generated("src/workflows/CreatePost.ts");

    expect(workflow).toContain('import { validatePost } from "../validators/Post.js";');
    expect(workflow).toContain("const postInsertValidation = validatePost(payload);");
    expect(workflow).toContain("if (!postInsertValidation.ok)");
    expect(workflow).toContain("createPost(postInsertValidation.value");
  });

  it("generates workflow tests with required insert inputs but leaves default fields to defaults", () => {
    const test = generated("tests/workflows/CreatePost.test.ts");

    expect(test).toContain('authorId: "authorId_1"');
    expect(test).toContain('body: "hello world"');
    expect(test).not.toContain("visibility:");
    expect(test).not.toContain("likeCount:");
  });
});
