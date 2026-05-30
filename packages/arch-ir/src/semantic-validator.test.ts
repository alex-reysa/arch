import { describe, expect, it } from "vitest";
import { buildDraftIR } from "./draft-ir.js";
import { SEM_CODES, validateSemantics } from "./semantic-validator.js";
import {
  apiTrigger,
  archFile,
  customDecl,
  fieldDecl,
  longGuarantee,
  modelDecl,
  policyDecl,
  propValues,
  shortGuarantee,
  steps,
  TEST_SPAN,
  workflowDecl,
} from "./test-builders.js";

function codes(diagnostics: ReturnType<typeof validateSemantics>["diagnostics"]): string[] {
  return diagnostics.all().map((d) => d.code);
}

describe("validateSemantics: enum fields", () => {
  it("accepts an enum field whose default is one of its values", () => {
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
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(codes(result.diagnostics)).not.toContain(SEM_CODES.INVALID_DEFAULT);
  });

  it("rejects an enum default that is not one of the declared values (ARCH-SEM-015)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "visibility",
              typeText: "enum",
              enumValues: ["public", "private"],
              defaultValue: propValues.string("secret"),
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.INVALID_DEFAULT);
  });
});

describe("validateSemantics: stable rejection codes", () => {
  it("rejects undeclared model reference (ARCH-SEM-002)", () => {
    const ast = archFile({
      declarations: [
        workflowDecl({
          name: "Wf",
          trigger: apiTrigger("POST", "/x"),
          steps: [steps.insert("Missing", 0)],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNDECLARED_MODEL);
  });

  it("rejects undeclared model references from fields before canonical validation", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "authorId",
              typeText: "Ghost",
              relationTo: { name: "Ghost" },
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNDECLARED_MODEL);
    const diag = result.diagnostics
      .all()
      .find((d) => d.code === SEM_CODES.UNDECLARED_MODEL)!;
    expect(diag.message).toMatch(/Post\.authorId field/);
  });

  it("rejects undeclared sanitize policy references (ARCH-SEM-017)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        workflowDecl({
          name: "CreatePost",
          trigger: apiTrigger("POST", "/posts"),
          steps: [
            steps.sanitize("body", 0, "missingPolicy"),
            steps.insert("Post", 1),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNDECLARED_POLICY);
  });

  it("rejects undeclared integration reference (ARCH-SEM-003)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        workflowDecl({
          name: "Wf",
          trigger: apiTrigger("POST", "/posts"),
          steps: [
            steps.insert("Post", 0),
            steps.call("Ghost", "send", 1),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNDECLARED_INTEGRATION);
    const diag = result.diagnostics
      .all()
      .find((d) => d.code === SEM_CODES.UNDECLARED_INTEGRATION)!;
    expect(diag.message).toMatch(/Ghost/);
    expect(diag.span).toBeDefined();
  });

  it("rejects missing primary key (ARCH-SEM-001)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Note",
          fields: [fieldDecl({ name: "body", typeText: "string" })],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.MISSING_PRIMARY_KEY);
  });

  it("rejects invalid default (ARCH-SEM-015)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Note",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "count",
              typeText: "int",
              defaultValue: propValues.string("not a number"),
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.INVALID_DEFAULT);
  });

  it("rejects unsupported many-to-many (ARCH-SEM-005)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "User",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "groups",
              typeText: "Group",
              relationTo: { name: "Group", many: true },
            }),
          ],
        }),
        modelDecl({
          name: "Group",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({
              name: "members",
              typeText: "User",
              relationTo: { name: "User", many: true },
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNSUPPORTED_MANY_TO_MANY);
    const m2m = result.diagnostics
      .all()
      .filter((d) => d.code === SEM_CODES.UNSUPPORTED_MANY_TO_MANY);
    expect(m2m).toHaveLength(1); // dedup by ordered pair
  });

  it("rejects schedule trigger (ARCH-SEM-006)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Item",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        workflowDecl({
          name: "Wf",
          trigger: {
            kind: "ReservedScheduleTrigger",
            span: TEST_SPAN,
            cron: "0 * * * *",
          },
          steps: [steps.insert("Item", 0)],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.SCHEDULE_TRIGGER);
  });

  it("rejects unknown short-form guarantee (ARCH-SEM-010)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Item",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        workflowDecl({
          name: "Wf",
          trigger: apiTrigger("POST", "/x"),
          steps: [steps.insert("Item", 0)],
          guarantees: [shortGuarantee("never_loses_data_in_any_universe")],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNKNOWN_SHORT_GUARANTEE);
  });

  it("accepts known short-form guarantees and patterns", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        policyDecl({ name: "sanitizeHtml", body: "" }),
        workflowDecl({
          name: "CreatePost",
          trigger: apiTrigger("POST", "/posts"),
          steps: [
            steps.sanitize("body", 0, "sanitizeHtml"),
            steps.insert("Post", 1),
          ],
          guarantees: [
            shortGuarantee("no_unsanitized_html_persisted"),
            shortGuarantee(
              "post_creation_p95_latency",
              "<=",
              propValues.number(250),
            ),
            shortGuarantee("notification_failure_does_not_rollback_post"),
            shortGuarantee("moderation_precedes_persistence"),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(true);
  });

  it("rejects unsupported long-form guarantees as blocking diagnostics", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [fieldDecl({ name: "id", typeText: "id" })],
        }),
        workflowDecl({
          name: "CreatePost",
          trigger: apiTrigger("POST", "/posts"),
          steps: [steps.insert("Post", 0)],
          guarantees: [
            longGuarantee("FuzzyVibe", {
              verifiability: propValues.identifier("unsupported"),
            }),
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    const all = result.diagnostics.all();
    const error = all.find((d) => d.code === SEM_CODES.UNSUPPORTED_LONG_GUARANTEE);
    expect(error).toBeDefined();
    expect(error?.severity).toBe("error");
    expect(draft.guarantee_coverage[0]?.status).toBe("missing");
    expect(draft.guarantee_coverage[0]?.artifact_ids).toEqual([]);
  });

  it("rejects unsupported reserved and unknown field modifiers", () => {
    const requiredField = fieldDecl({ name: "title", typeText: "string" });
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({ name: "email", typeText: "string", unique: true }),
            {
              ...requiredField,
              modifiers: [
                ...requiredField.modifiers,
                {
                  kind: "FieldUnknownModifier" as const,
                  text: "required",
                  span: TEST_SPAN,
                },
              ],
            },
          ],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.RESERVED_FIELD_MODIFIER);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNKNOWN_FIELD_MODIFIER);
  });

  it("defaults target cache to redis and rejects unsupported target values", () => {
    const validNoCache = {
      ...archFile({
        declarations: [
          modelDecl({
            name: "Post",
            fields: [fieldDecl({ name: "id", typeText: "id" })],
          }),
        ],
      }),
      target: {
        kind: "TargetDecl" as const,
        span: TEST_SPAN,
        stack: "ts.node.fastify.postgres.prisma",
        modifiers: {},
      },
    };
    expect(buildDraftIR(validNoCache).draft.target.cache).toBe("redis");

    const invalid = {
      ...validNoCache,
      target: {
        kind: "TargetDecl" as const,
        span: TEST_SPAN,
        stack: "python.django.postgres",
        cache: "memcached",
        modifiers: {},
      },
    };
    const { draft } = buildDraftIR(invalid);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNSUPPORTED_TARGET_STACK);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.UNSUPPORTED_TARGET_CACHE);
  });

  it("rejects custom kind: test_generator (ARCH-SEM-012)", () => {
    const ast = archFile({
      declarations: [
        customDecl({
          name: "BadGen",
          customKind: "test_generator",
          reserved: true,
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.RESERVED_CUSTOM_KIND);
  });

  it("rejects named source indexes (ARCH-SEM-013)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({ name: "body", typeText: "string" }),
          ],
        }),
      ],
      reservedSyntax: [
        {
          kind: "ReservedIndexDecl",
          span: TEST_SPAN,
          form: "named",
          name: "post_body_idx",
          fields: ["body"],
        },
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.NAMED_INDEX);
  });

  it("rejects composite source indexes (ARCH-SEM-014)", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Post",
          fields: [
            fieldDecl({ name: "id", typeText: "id" }),
            fieldDecl({ name: "a", typeText: "string" }),
            fieldDecl({ name: "b", typeText: "string" }),
          ],
        }),
      ],
      reservedSyntax: [
        {
          kind: "ReservedIndexDecl",
          span: TEST_SPAN,
          form: "composite",
          fields: ["a", "b"],
        },
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    expect(result.ok).toBe(false);
    expect(codes(result.diagnostics)).toContain(SEM_CODES.COMPOSITE_INDEX);
  });
});

describe("validateSemantics: diagnostic formatting", () => {
  it("attaches a SourceSpan to every error diagnostic", () => {
    const ast = archFile({
      declarations: [
        modelDecl({
          name: "Note",
          fields: [fieldDecl({ name: "body", typeText: "string" })],
        }),
      ],
    });
    const { draft } = buildDraftIR(ast);
    const result = validateSemantics(draft);
    for (const d of result.diagnostics.all()) {
      if (d.severity === "error") {
        expect(d.span, `error ${d.code} should have a span`).toBeDefined();
      }
    }
  });
});
