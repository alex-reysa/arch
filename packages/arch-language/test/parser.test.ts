import { describe, expect, it } from "vitest";

import type {
  ApiTriggerAst,
  ArchFileAst,
  CustomDeclAst,
  IntegrationDeclAst,
  ModelDeclAst,
  PolicyDeclAst,
  ReservedIndexDeclAst,
  WorkflowDeclAst,
} from "../src/ast.js";
import { PARSER_DIAGNOSTIC_CODES, parse } from "../src/parser.js";

const FILE = "test.arch";

function declOf<T extends ArchFileAst["declarations"][number]["kind"]>(
  ast: ArchFileAst,
  kind: T,
): Extract<ArchFileAst["declarations"][number], { kind: T }> {
  const d = ast.declarations.find((x) => x.kind === kind);
  if (!d) throw new Error(`Expected declaration of kind ${kind}`);
  return d as Extract<ArchFileAst["declarations"][number], { kind: T }>;
}

describe("parser: SocialFeed v1 fixture-shaped input", () => {
  const SRC = `target ts.node.fastify.postgres.prisma cache: redis

model User {
  id: id
  email: string indexed
  createdAt: timestamp default: now
}

model Post {
  id: id
  authorId: User
  body: string
  createdAt: timestamp default: now indexed
}

integration FeedCache {
  kind: redis
  failure: best_effort
}

integration PushNotifier {
  kind: webhook
  failure: best_effort
}

policy sanitizeHtml {
  body: "strip script tags and on* attributes from inputs"
}

workflow CreatePost {
  trigger api POST /posts auth: none
  step validate body
  step sanitize body using sanitizeHtml
  step insert Post
  step call FeedCache.update
  step call PushNotifier.send
  guarantee no_unsanitized_html_persisted
  guarantee notification_failure_does_not_rollback_post
  guarantee post_creation_p95_latency <= 250
}
`;

  const { ast, diagnostics } = parse(SRC, FILE);

  it("returns no syntax diagnostics", () => {
    expect(diagnostics.hasErrors()).toBe(false);
    expect(diagnostics.all()).toHaveLength(0);
  });

  it("parses the target declaration with cache modifier", () => {
    expect(ast).not.toBeNull();
    expect(ast!.target).toBeDefined();
    expect(ast!.target!.stack).toBe("ts.node.fastify.postgres.prisma");
    expect(ast!.target!.cache).toBe("redis");
    expect(ast!.target!.span.start.line).toBe(1);
  });

  it("parses two models with stable field structure and indexed modifier", () => {
    const models = ast!.declarations.filter(
      (d): d is ModelDeclAst => d.kind === "ModelDecl",
    );
    expect(models.map((m) => m.name)).toEqual(["User", "Post"]);
    const user = models[0]!;
    expect(user.fields.map((f) => f.name)).toEqual([
      "id",
      "email",
      "createdAt",
    ]);
    const email = user.fields.find((f) => f.name === "email")!;
    expect(email.typeText).toBe("string");
    expect(
      email.modifiers.some(
        (m) => m.kind === "FieldIndexModifier" && m.modifier === "indexed",
      ),
    ).toBe(true);

    const created = user.fields.find((f) => f.name === "createdAt")!;
    expect(created.defaultValue?.kind).toBe("IdentifierValue");
    if (created.defaultValue?.kind === "IdentifierValue") {
      expect(created.defaultValue.name).toBe("now");
    }
  });

  it("records relation references for capitalized model-typed fields", () => {
    const post = ast!.declarations.find(
      (d): d is ModelDeclAst => d.kind === "ModelDecl" && d.name === "Post",
    )!;
    const author = post.fields.find((f) => f.name === "authorId")!;
    expect(author.relationReference?.targetModelName).toBe("User");
    expect(author.relationReference?.many).toBe(false);
    const id = post.fields.find((f) => f.name === "id")!;
    expect(id.relationReference).toBeUndefined();
  });

  it("parses the workflow with API trigger, ordered steps, guarantees", () => {
    const wf = ast!.declarations.find(
      (d): d is WorkflowDeclAst => d.kind === "WorkflowDecl",
    )!;
    expect(wf.name).toBe("CreatePost");
    expect(wf.trigger.kind).toBe("ApiTrigger");
    const trig = wf.trigger as ApiTriggerAst;
    expect(trig.method).toBe("POST");
    expect(trig.path).toBe("/posts");
    expect(trig.auth).toBe("none");
    expect(wf.steps.map((s) => s.kind)).toEqual([
      "ValidateStep",
      "SanitizeStep",
      "InsertStep",
      "CallStep",
      "CallStep",
    ]);
    expect(wf.steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);

    const sanitize = wf.steps[1];
    if (sanitize?.kind === "SanitizeStep") {
      expect(sanitize.target).toBe("body");
      expect(sanitize.policy).toBe("sanitizeHtml");
    } else {
      throw new Error("expected SanitizeStep at index 1");
    }
    const call0 = wf.steps[3];
    if (call0?.kind === "CallStep") {
      expect(call0.integrationName).toBe("FeedCache");
      expect(call0.operation).toBe("update");
    } else {
      throw new Error("expected CallStep at index 3");
    }

    expect(wf.guarantees.map((g) => g.kind)).toEqual([
      "ShortGuarantee",
      "ShortGuarantee",
      "ShortGuarantee",
    ]);
    const last = wf.guarantees[2];
    if (last?.kind === "ShortGuarantee") {
      expect(last.id).toBe("post_creation_p95_latency");
      expect(last.operator).toBe("<=");
      expect(last.value?.kind).toBe("NumberValue");
      if (last.value?.kind === "NumberValue") {
        expect(last.value.value).toBe(250);
      }
    }
  });

  it("populates spans on every top-level declaration", () => {
    for (const d of ast!.declarations) {
      expect(d.span.start.line).toBeGreaterThan(0);
      expect(d.span.end.line).toBeGreaterThan(0);
      expect(d.span.start.offset).toBeGreaterThanOrEqual(0);
      expect(d.span.end.offset).toBeGreaterThan(d.span.start.offset);
    }
  });

  it("parses integration / policy property bags", () => {
    const fc = ast!.declarations.find(
      (d): d is IntegrationDeclAst =>
        d.kind === "IntegrationDecl" && d.name === "FeedCache",
    )!;
    expect(fc.properties["kind"]?.kind).toBe("IdentifierValue");
    expect(fc.properties["failure"]?.kind).toBe("IdentifierValue");

    const pol = ast!.declarations.find(
      (d): d is PolicyDeclAst => d.kind === "PolicyDecl",
    )!;
    expect(pol.body).toMatch(/strip script tags/);
  });
});

describe("parser: V2 visibility fixture surfaces default + indexed modifiers", () => {
  const SRC = `target ts.node.fastify.postgres.prisma

model Post {
  id: id
  visibility: string default: "public" indexed
  createdAt: timestamp default: now indexed
}
`;
  it("preserves default value and trailing indexed modifier", () => {
    const { ast, diagnostics } = parse(SRC, FILE);
    expect(diagnostics.hasErrors()).toBe(false);
    const m = ast!.declarations.find(
      (d): d is ModelDeclAst => d.kind === "ModelDecl",
    )!;
    const vis = m.fields.find((f) => f.name === "visibility")!;
    expect(vis.typeText).toBe("string");
    expect(vis.defaultValue?.kind).toBe("StringValue");
    if (vis.defaultValue?.kind === "StringValue") {
      expect(vis.defaultValue.value).toBe("public");
    }
    expect(
      vis.modifiers.some(
        (mod) => mod.kind === "FieldIndexModifier" && mod.modifier === "indexed",
      ),
    ).toBe(true);
  });
});

describe("parser: enum field type", () => {
  const SRC = `target ts.node.fastify.postgres.prisma

model Post {
  id: id
  visibility: enum["public", "private", "followers"] default: "public" indexed
}
`;
  it("captures enum values, default, and indexed modifier", () => {
    const { ast, diagnostics } = parse(SRC, FILE);
    expect(diagnostics.hasErrors()).toBe(false);
    const m = ast!.declarations.find(
      (d): d is ModelDeclAst => d.kind === "ModelDecl",
    )!;
    const vis = m.fields.find((f) => f.name === "visibility")!;
    expect(vis.typeText).toBe("enum");
    expect(vis.enumValues).toEqual(["public", "private", "followers"]);
    expect(vis.defaultValue?.kind).toBe("StringValue");
    if (vis.defaultValue?.kind === "StringValue") {
      expect(vis.defaultValue.value).toBe("public");
    }
    expect(
      vis.modifiers.some(
        (mod) => mod.kind === "FieldIndexModifier" && mod.modifier === "indexed",
      ),
    ).toBe(true);
  });
});

describe("parser: reserved-syntax recognition", () => {
  it("captures field-level `indexed` and `index` modifiers", () => {
    const src = `target ts.node\nmodel User {\n  email: string index\n  username: string indexed\n}`;
    const { ast, diagnostics } = parse(src, FILE);
    expect(diagnostics.hasErrors()).toBe(false);
    const model = ast!.declarations.find(
      (d): d is ModelDeclAst => d.kind === "ModelDecl",
    )!;
    const email = model.fields.find((f) => f.name === "email")!;
    expect(
      email.modifiers.some(
        (m) => m.kind === "FieldIndexModifier" && m.modifier === "indexed",
      ),
    ).toBe(true);
    const username = model.fields.find((f) => f.name === "username")!;
    expect(
      username.modifiers.some(
        (m) => m.kind === "FieldIndexModifier" && m.modifier === "indexed",
      ),
    ).toBe(true);
  });

  it("flags named source indexes as ReservedIndexDecl with form='named'", () => {
    const src = `target t\nmodel Post {\n  id: id\n  index by_author (authorId)\n}`;
    const { ast, diagnostics } = parse(src, FILE);
    expect(diagnostics.hasErrors()).toBe(false);
    const model = ast!.declarations.find(
      (d): d is ModelDeclAst => d.kind === "ModelDecl",
    )!;
    expect(model.reservedIndexes).toHaveLength(1);
    const idx = model.reservedIndexes[0]!;
    expect(idx.form).toBe("named");
    expect(idx.name).toBe("by_author");
    expect(idx.fields).toEqual(["authorId"]);
    // also surfaced in top-level reservedSyntax aggregate
    const reserved = ast!.reservedSyntax.find(
      (r): r is ReservedIndexDeclAst => r.kind === "ReservedIndexDecl",
    );
    expect(reserved).toBeDefined();
  });

  it("flags composite source indexes as ReservedIndexDecl with form='composite'", () => {
    const src = `target t\nmodel Post {\n  id: id\n  index (authorId, createdAt)\n}`;
    const { ast } = parse(src, FILE);
    const model = ast!.declarations.find(
      (d): d is ModelDeclAst => d.kind === "ModelDecl",
    )!;
    expect(model.reservedIndexes[0]?.form).toBe("composite");
    expect(model.reservedIndexes[0]?.fields).toEqual(["authorId", "createdAt"]);
  });

  it("flags `custom kind: test_generator` as a reserved custom kind", () => {
    const src = `target t\ncustom MyTests {\n  kind: test_generator\n  file: "src/custom/x.ts"\n}`;
    const { ast } = parse(src, FILE);
    const custom = ast!.declarations.find(
      (d): d is CustomDeclAst => d.kind === "CustomDecl",
    )!;
    expect(custom.customKind).toBe("test_generator");
    expect(custom.customKindIsReserved).toBe(true);
    expect(
      ast!.reservedSyntax.some((r) => r.kind === "ReservedCustomKind"),
    ).toBe(true);
  });

  it("flags schedule triggers as ReservedScheduleTrigger", () => {
    const src = `target t\nworkflow Hourly {\n  trigger schedule cron("0 * * * *")\n  step insert Post\n}`;
    const { ast, diagnostics } = parse(src, FILE);
    expect(diagnostics.hasErrors()).toBe(false);
    const wf = ast!.declarations.find(
      (d): d is WorkflowDeclAst => d.kind === "WorkflowDecl",
    )!;
    expect(wf.trigger.kind).toBe("ReservedScheduleTrigger");
    if (wf.trigger.kind === "ReservedScheduleTrigger") {
      expect(wf.trigger.cron).toBe("0 * * * *");
    }
    expect(
      ast!.reservedSyntax.some((r) => r.kind === "ReservedScheduleTrigger"),
    ).toBe(true);
  });

  it("flags manual triggers as ReservedManualTrigger", () => {
    const src = `target t\nworkflow Replay {\n  trigger manual("retry")\n  step insert Post\n}`;
    const { ast } = parse(src, FILE);
    const wf = ast!.declarations.find(
      (d): d is WorkflowDeclAst => d.kind === "WorkflowDecl",
    )!;
    expect(wf.trigger.kind).toBe("ReservedManualTrigger");
  });
});

describe("parser: diagnostics carry stable codes and source coordinates", () => {
  it("emits language.lex.unterminated_string with file/line/column", () => {
    const src = `policy P {\n  body: "no end\n}`;
    const { diagnostics } = parse(src, "p.arch");
    const d = diagnostics
      .all()
      .find((x) => x.code === "language.lex.unterminated_string");
    expect(d).toBeDefined();
    expect(d?.span?.file).toBe("p.arch");
    expect(d?.span?.start.line).toBe(2);
    expect(d?.span?.start.column).toBe(9);
    expect(d?.severity).toBe("error");
  });

  it("emits language.parse.unclosed_block when a `{` is never closed", () => {
    const src = `model X {\n  id: id\n`;
    const { diagnostics } = parse(src, "u.arch");
    const d = diagnostics
      .all()
      .find((x) => x.code === PARSER_DIAGNOSTIC_CODES.unclosedBlock);
    expect(d).toBeDefined();
    expect(d?.span?.file).toBe("u.arch");
  });

  it("emits language.lex.invalid_token for unrecognized characters", () => {
    const src = `model X { id: id @ }`;
    const { diagnostics } = parse(src, "i.arch");
    const d = diagnostics
      .all()
      .find((x) => x.code === "language.lex.invalid_token");
    expect(d).toBeDefined();
    expect(d?.message).toContain("@");
  });

  function workflowWithTrigger(triggerLine: string): string {
    return [
      "target ts.node.fastify.postgres.prisma cache: redis",
      "",
      "model Post {",
      "  id: id",
      "  body: string",
      "}",
      "",
      "workflow CreatePost {",
      `  ${triggerLine}`,
      "  step validate body",
      "  step insert Post",
      "}",
      "",
    ].join("\n");
  }

  it("emits language.parse.missing_api_path for a trigger with no/empty path, anchored at the method", () => {
    for (const trigger of ["trigger api POST auth: none", "trigger api POST() auth: none"]) {
      const { diagnostics } = parse(workflowWithTrigger(trigger), "m.arch");
      const d = diagnostics.all().find((x) => x.code === PARSER_DIAGNOSTIC_CODES.missingApiPath);
      expect(d, trigger).toBeDefined();
      expect(d?.span?.start.line, trigger).toBe(9); // the POST method token line
    }
  });

  it("does not emit missing_api_path when a leading-slash path is present", () => {
    const { diagnostics } = parse(workflowWithTrigger("trigger api POST /posts auth: none"), "ok.arch");
    expect(diagnostics.all().find((x) => x.code === PARSER_DIAGNOSTIC_CODES.missingApiPath)).toBeUndefined();
  });
});
