import { beforeAll, describe, expect, it } from "vitest";
import type { CanonicalIR, ModelIR, WorkflowIR } from "@arch/ir";
import { generate } from "@arch/generator";
import { parseArchSource } from "../src/commands/parse.js";

/**
 * Conformance suite: language construct -> canonical IR node -> generated
 * artifact -> (behavior). Each test parses ONE rich spec, compiles it to IR,
 * and generates the project, then asserts the full chain for a single
 * construct. The behavioral dimension (the generated tests actually pass, the
 * Prisma schema actually persists) is proven by `pnpm examples-e2e`, the gated
 * apply/verify integration test, and the gated Postgres HTTP test; here we
 * assert that the behavioral *artifacts* are emitted and shaped correctly.
 */

const SPEC = [
  "target ts.node.fastify.postgres.prisma cache: redis",
  "",
  "model Author {",
  "  id: id",
  "  email: string indexed",
  "  createdAt: timestamp default: now",
  "}",
  "",
  "model Article {",
  "  id: id",
  "  authorId: Author",
  "  title: string",
  "  body: string",
  '  visibility: enum["public", "private"] default: "public" indexed',
  "  views: int default: 0",
  "  rating: float default: 1.5",
  "  featured: boolean default: false",
  "  createdAt: timestamp default: now indexed",
  "}",
  "",
  "integration SearchIndex {",
  "  kind: webhook",
  "  failure: best_effort",
  "}",
  "",
  "policy sanitizeHtml {",
  '  body: "strip script tags"',
  "}",
  "",
  "workflow CreateArticle {",
  "  trigger api POST /articles auth: none",
  "  step validate body",
  "  step sanitize body using sanitizeHtml",
  "  step insert Article",
  "  step call SearchIndex.update",
  "  guarantee no_unsanitized_html_persisted",
  "  guarantee notification_failure_does_not_rollback_post",
  "  guarantee post_creation_p95_latency <= 200",
  "}",
  "",
].join("\n");

let ir: CanonicalIR;
let files: Map<string, string>;

function article(): ModelIR {
  return ir.models.find((m) => m.name === "Article")!;
}
function field(model: ModelIR, name: string) {
  return model.fields.find((f) => f.name === name)!;
}
function workflow(): WorkflowIR {
  return ir.workflows.find((w) => w.name === "CreateArticle")!;
}

beforeAll(() => {
  const parsed = parseArchSource(SPEC, "conformance.arch");
  if (!parsed.ok) {
    throw new Error("conformance spec failed to parse:\n" + parsed.diagnostics.map((d) => d.message).join("\n"));
  }
  ir = parsed.ir;
  files = new Map(generate(ir).files.map((f) => [f.path, f.content]));
});

describe("conformance: construct -> IR -> generated artifact", () => {
  it("model -> ModelIR -> Prisma model + model/validator/test files", () => {
    expect(ir.models.map((m) => m.name).sort()).toEqual(["Article", "Author"]);
    expect(files.get("prisma/schema.prisma")).toContain("model Article {");
    expect(files.has("src/models/Article.ts")).toBe(true);
    expect(files.has("src/validators/Article.ts")).toBe(true);
    expect(files.has("tests/models/Article.test.ts")).toBe(true);
  });

  it("id field -> FieldTypeIR{kind:id} -> Prisma @id @default(cuid())", () => {
    expect(field(article(), "id").type.kind).toBe("id");
    expect(files.get("prisma/schema.prisma")).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
  });

  it("enum field -> FieldTypeIR{kind:enum} -> Prisma enum + validator union + Row union", () => {
    const f = field(article(), "visibility");
    expect(f.type.kind).toBe("enum");
    expect((f.type as { values: string[] }).values).toEqual(["public", "private"]);
    expect(files.get("prisma/schema.prisma")).toContain("enum ArticleVisibility {");
    expect(files.get("prisma/schema.prisma")).toMatch(/visibility\s+ArticleVisibility/);
    expect(files.get("src/validators/Article.ts")).toMatch(/"public"\s*,\s*"private"|"public"\s*\|\s*"private"/);
    expect(files.get("src/runtime/db.ts")).toMatch(/visibility:\s*"public"\s*\|\s*"private"/);
  });

  it("model_ref relation -> FieldTypeIR{kind:model_ref} -> Prisma FK scalar + @relation", () => {
    const f = field(article(), "authorId");
    expect(f.type.kind).toBe("model_ref");
    const schema = files.get("prisma/schema.prisma")!;
    expect(schema).toContain("authorId String");
    expect(schema).toMatch(/@relation\("Article_authorId_Author", fields: \[authorId\], references: \[id\]\)/);
    // inverse one-to-many view on Author (non-persisted)
    expect(schema).toMatch(/Article\[\] @relation\("Article_authorId_Author"\)/);
  });

  it("scalar defaults -> FieldIR.default -> Prisma @default + model defaults block", () => {
    expect(field(article(), "views").default).toBe(0);
    expect(field(article(), "rating").default).toBe(1.5);
    expect(field(article(), "featured").default).toBe(false);
    const schema = files.get("prisma/schema.prisma")!;
    expect(schema).toContain("views Int @default(0)");
    expect(schema).toContain("rating Float @default(1.5)");
    expect(schema).toContain("featured Boolean @default(false)");
    const model = files.get("src/models/Article.ts")!;
    expect(model).toContain("views: input.views ?? 0");
    expect(model).toContain("featured: input.featured ?? false");
  });

  it("timestamp default now -> Prisma @default(now()) + new Date() in model", () => {
    expect(files.get("prisma/schema.prisma")).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(files.get("src/models/Article.ts")).toContain("createdAt: input.createdAt ?? new Date()");
  });

  it("field-level index -> ModelIndexIR / indexed -> Prisma @@index", () => {
    const schema = files.get("prisma/schema.prisma")!;
    expect(schema).toContain("@@index([email])");
    expect(schema).toContain("@@index([visibility])");
    expect(schema).toContain("@@index([createdAt])");
  });

  it("workflow + api POST trigger -> WorkflowIR.trigger -> Fastify route", () => {
    const w = workflow();
    expect(w.trigger.kind).toBe("api");
    expect(w.trigger.method).toBe("POST");
    expect(w.trigger.path).toBe("/articles");
    expect(files.get("src/routes/CreateArticle.ts")).toContain('app.post("/articles"');
    expect(files.get("src/app.ts")).toContain("registerCreateArticleRoute");
  });

  it("validate step -> WorkflowStepIR{validate} -> input validation in workflow", () => {
    const steps = workflow().steps.map((s) => s.operation.kind);
    expect(steps).toContain("validate");
    expect(files.get("src/workflows/CreateArticle.ts")).toContain("validateCreateArticleInput(input)");
  });

  it("sanitize step + policy -> policy call + policy file", () => {
    expect(workflow().steps.some((s) => s.operation.kind === "sanitize")).toBe(true);
    expect(files.has("src/policies/sanitizeHtml.ts")).toBe(true);
    expect(files.get("src/workflows/CreateArticle.ts")).toContain("sanitizeHtml(");
  });

  it("insert step -> WorkflowStepIR{insert} -> create<Model> persistence call", () => {
    expect(workflow().steps.some((s) => s.operation.kind === "insert")).toBe(true);
    const wf = files.get("src/workflows/CreateArticle.ts")!;
    expect(wf).toContain("createArticle(");
    expect(wf).toContain("statusCode: 201");
  });

  it("integration + call step -> IntegrationIR + stub + post-persistence try/catch", () => {
    expect(ir.integrations.map((i) => i.name)).toContain("SearchIndex");
    expect(files.has("src/integrations/SearchIndex.ts")).toBe(true);
    const wf = files.get("src/workflows/CreateArticle.ts")!;
    // call after insert is wrapped so a failure never rolls back persistence
    expect(wf).toMatch(/try\s*{[\s\S]*SearchIndex\.update\(inserted\)[\s\S]*}\s*catch/);
  });

  it("supported guarantees -> generated guarantee tests", () => {
    const names = workflow().guarantees.map((g) => g.name);
    expect(names).toContain("no_unsanitized_html_persisted");
    expect(names).toContain("notification_failure_does_not_rollback_post");
    expect(files.has("tests/guarantees/no_unsanitized_html_persisted.CreateArticle.test.ts")).toBe(true);
    expect(files.has("tests/guarantees/notification_failure_does_not_rollback_post.CreateArticle.test.ts")).toBe(true);
  });

  it("latency guarantee -> GuaranteeCoverageIR partially_covered (no production proof claimed)", () => {
    const cov = ir.guarantee_coverage.find((c) => c.guarantee_id?.includes("post_creation_p95_latency"));
    expect(cov?.status).toBe("partially_covered");
  });

  it("cache: redis -> ioredis dep + redis compose service", () => {
    expect(files.get("package.json")).toContain("ioredis");
    expect(files.get("docker-compose.yml")).toContain("redis:");
  });

  it("every generated file carries an Arch traceability header", () => {
    for (const [path, content] of files) {
      expect(content, `missing header in ${path}`).toContain("Generated by Arch");
    }
  });
});
