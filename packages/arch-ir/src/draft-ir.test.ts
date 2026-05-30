import { describe, expect, it } from "vitest";
import { buildDraftIR } from "./draft-ir.js";
import { validateSemantics } from "./semantic-validator.js";
import { canonicalize } from "./canonicalize.js";
import { validateCanonicalIR } from "./ir-validator.js";
import {
  apiTrigger,
  archFile,
  fieldDecl,
  modelDecl,
  propValues,
  socialFeedV1Ast,
  socialFeedV2Ast,
  steps,
  workflowDecl,
} from "./test-builders.js";

describe("buildDraftIR + canonicalize: SocialFeed V1", () => {
  it("compiles to a draft IR that names every required section", () => {
    const ast = socialFeedV1Ast();
    const { draft, diagnostics } = buildDraftIR(ast);
    expect(diagnostics.hasErrors()).toBe(false);
    expect(draft.target.stack).toBe("ts.node.fastify.postgres.prisma");
    expect(draft.target.cache).toBe("redis");
    expect(draft.models.map((m) => m.name).sort()).toEqual(["Post", "User"]);
    expect(draft.integrations.map((i) => i.name).sort()).toEqual([
      "FeedCache",
      "PushNotifier",
    ]);
    expect(draft.policies.map((p) => p.name)).toEqual(["sanitizeHtml"]);
    expect(draft.workflows.map((w) => w.name)).toEqual(["CreatePost"]);

    const wf = draft.workflows[0]!;
    expect(wf.trigger).toEqual({
      kind: "api",
      method: "POST",
      path: "/posts",
      auth: "none",
    });
    expect(wf.steps.map((s) => s.operation.kind)).toEqual([
      "validate",
      "sanitize",
      "insert",
      "call",
      "call",
    ]);
    expect(wf.guarantees.map((g) => g.name).sort()).toEqual([
      "no_unsanitized_html_persisted",
      "notification_failure_does_not_rollback_post",
      "post_creation_p95_latency",
    ]);
  });

  it("validates and canonicalises into schema-valid arch.ir.v1", () => {
    const ast = socialFeedV1Ast();
    const { draft } = buildDraftIR(ast);
    expect(validateSemantics(draft).ok).toBe(true);
    const canonical = canonicalize(draft);
    expect(canonical.schema_version).toBe("arch.ir.v1");
    expect(canonical.canonical_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(canonical.target.stack).toBe("ts.node.fastify.postgres.prisma");
    expect(canonical.models).toHaveLength(2);
    expect(canonical.integrations).toHaveLength(2);
    expect(canonical.workflows).toHaveLength(1);
    expect(canonical.workflows[0]!.steps).toHaveLength(5);
    expect(canonical.guarantee_coverage).toHaveLength(3);
    expect(canonical.artifacts.length).toBeGreaterThan(0);
    expect(canonical.ownership.length).toBe(canonical.artifacts.length);
    expect(canonical.source_locations.length).toBeGreaterThan(0);
    const result = validateCanonicalIR(canonical);
    if (!result.ok) {
      throw new Error(`canonical IR invalid:\n${result.errors.join("\n")}`);
    }
  });

  it("compiles social-feed-v2 with the added visibility field", () => {
    const ast = socialFeedV2Ast();
    const { draft } = buildDraftIR(ast);
    expect(validateSemantics(draft).ok).toBe(true);
    const canonical = canonicalize(draft);
    const post = canonical.models.find((m) => m.name === "Post")!;
    expect(post.fields.map((f) => f.name).sort()).toEqual([
      "authorId",
      "body",
      "createdAt",
      "id",
      "visibility",
    ]);
    const visibility = post.fields.find((f) => f.name === "visibility")!;
    expect(visibility.indexed).toBe(true);
    expect(visibility.default).toBe("public");
    const visibilityIndex = post.indexes.find((i) =>
      i.fields.includes("visibility"),
    );
    expect(visibilityIndex).toBeDefined();
    expect(validateCanonicalIR(canonical).ok).toBe(true);
  });
});

describe("draft IR field lowering", () => {
  it("lowers field index modifiers to ModelIndexIR", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "User",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({ name: "email", typeText: "string", indexed: true }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    expect(validateSemantics(draft).ok).toBe(true);
    const user = draft.models[0]!;
    const email = user.fields.find((f) => f.name === "email")!;
    expect(email.indexed).toBe(true);
    expect(user.indexes.map((idx) => idx.fields)).toEqual([["email"]]);
  });

  it("normalises datetime alias to timestamp primitive", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Note",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({ name: "createdAt", typeText: "datetime" }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const note = draft.models[0]!;
    const createdAt = note.fields.find((f) => f.name === "createdAt")!;
    expect(createdAt.type).toEqual({ kind: "primitive", name: "timestamp" });
  });

  it("infers many_to_one + persisted on simple FK fields", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "User",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "authorId",
              typeText: "User",
              relationTo: { name: "User" },
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const post = draft.models.find((m) => m.name === "Post")!;
    const author = post.fields.find((f) => f.name === "authorId")!;
    expect(author.type).toEqual({
      kind: "model_ref",
      target_model_id: "model:User",
    });
    expect(author.relation?.cardinality).toBe("many_to_one");
    expect(author.relation?.storage).toBe("persisted");
  });

  it("represents inverse list views as one_to_many + non_persisted", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "User",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "posts",
              typeText: "Post",
              relationTo: { name: "Post", many: true },
            }),
          ],
        }),
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "authorId",
              typeText: "User",
              relationTo: { name: "User" },
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const user = draft.models.find((m) => m.name === "User")!;
    const posts = user.fields.find((f) => f.name === "posts")!;
    expect(posts.type).toEqual({
      kind: "list",
      element: { kind: "model_ref", target_model_id: "model:Post" },
    });
    expect(posts.relation?.cardinality).toBe("one_to_many");
    expect(posts.relation?.storage).toBe("non_persisted");
  });

  it("lowers an enum field to FieldTypeIR enum, preserving value order and default", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "visibility",
              typeText: "enum",
              enumValues: ["public", "private", "followers"],
              defaultValue: propValues.string("public"),
              indexed: true,
            }),
          ],
        }),
      ],
    });
    const { draft, diagnostics } = buildDraftIR(ast);
    expect(diagnostics.hasErrors()).toBe(false);
    const post = draft.models.find((m) => m.name === "Post")!;
    const vis = post.fields.find((f) => f.name === "visibility")!;
    expect(vis.type).toEqual({ kind: "enum", values: ["public", "private", "followers"] });
    expect(vis.default).toBe("public");
    expect(vis.indexed).toBe(true);
  });
});

describe("workflow trigger / step lowering", () => {
  it("preserves source-order step indices", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Item",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        workflowDecl({
          name: "Wf",
          trigger: apiTrigger("POST", "/items", "none"),
          steps: [
            steps.validate("body", 0),
            steps.insert("Item", 1),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const wf = draft.workflows[0]!;
    expect(wf.steps.map((s) => s.order)).toEqual([0, 1]);
  });
});
