/**
 * Hand-built AST factories used by IR tests.
 *
 * The parser package is still a stub at the time these tests run, so the
 * IR pipeline has to be exercised against synthetic ASTs. The factories
 * here mirror the shape produced by the eventual parser as closely as is
 * useful — every node carries a deterministic `SourceSpan` so tests can
 * compare diagnostics on a stable surface.
 */

import type {
  ApiTriggerAst,
  ArchFileAst,
  CustomDeclAst,
  CustomStepCallAst,
  DeclarationAst,
  FieldDeclAst,
  GuaranteeDeclAst,
  IntegrationDeclAst,
  LongGuaranteeAst,
  ModelDeclAst,
  PolicyDeclAst,
  PropertyValueAst,
  ReservedSyntaxAst,
  ShortGuaranteeAst,
  SourceSpan,
  TriggerAst,
  WorkflowDeclAst,
  WorkflowStepAst,
} from "@arch/language";

/** Default test span; tests that need real spans can override it. */
export const TEST_SPAN: SourceSpan = {
  file: "test.arch",
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 1, line: 1, column: 2 },
};

export function span(file = "test.arch", line = 1, column = 1): SourceSpan {
  return {
    file,
    start: { offset: 0, line, column },
    end: { offset: 0, line, column: column + 1 },
  };
}

export function archFile(parts: {
  declarations: readonly DeclarationAst[];
  reservedSyntax?: readonly ReservedSyntaxAst[];
  file?: string;
}): ArchFileAst {
  return {
    kind: "ArchFile",
    file: parts.file ?? "test.arch",
    span: TEST_SPAN,
    declarations: parts.declarations,
    reservedSyntax: parts.reservedSyntax ?? [],
  };
}

export function modelDecl(parts: {
  name: string;
  fields: readonly FieldDeclAst[];
  reservedIndexes?: readonly ModelDeclAst["reservedIndexes"][number][];
}): ModelDeclAst {
  return {
    kind: "ModelDecl",
    name: parts.name,
    span: TEST_SPAN,
    fields: parts.fields,
    reservedIndexes: parts.reservedIndexes ?? [],
  };
}

export function fieldDecl(parts: {
  name: string;
  typeText: string;
  indexed?: boolean;
  unique?: boolean;
  defaultValue?: PropertyValueAst;
  enumValues?: readonly string[];
  relationTo?: { name: string; many?: boolean };
}): FieldDeclAst {
  const modifiers: FieldDeclAst["modifiers"][number][] = [];
  if (parts.indexed) {
    modifiers.push({ kind: "FieldIndexModifier", modifier: "indexed", span: TEST_SPAN });
  }
  if (parts.unique) {
    modifiers.push({ kind: "FieldIndexModifier", modifier: "unique", span: TEST_SPAN });
  }
  if (parts.defaultValue) {
    modifiers.push({
      kind: "FieldDefaultModifier",
      value: parts.defaultValue,
      span: TEST_SPAN,
    });
  }
  const base = {
    kind: "FieldDecl" as const,
    name: parts.name,
    span: TEST_SPAN,
    typeText: parts.typeText,
    ...(parts.enumValues ? { enumValues: parts.enumValues } : {}),
    modifiers,
  };
  if (parts.relationTo) {
    return {
      ...base,
      relationReference: {
        kind: "RelationReference",
        span: TEST_SPAN,
        targetModelName: parts.relationTo.name,
        many: parts.relationTo.many ?? false,
      },
    };
  }
  return base;
}

export function integrationDecl(parts: {
  name: string;
  properties?: Readonly<Record<string, PropertyValueAst>>;
}): IntegrationDeclAst {
  return {
    kind: "IntegrationDecl",
    span: TEST_SPAN,
    name: parts.name,
    properties: parts.properties ?? {},
  };
}

export function policyDecl(parts: {
  name: string;
  body: string;
  properties?: Readonly<Record<string, PropertyValueAst>>;
}): PolicyDeclAst {
  return {
    kind: "PolicyDecl",
    span: TEST_SPAN,
    name: parts.name,
    body: parts.body,
    properties: parts.properties ?? {},
  };
}

export function customDecl(parts: {
  name: string;
  customKind: string;
  reserved?: boolean;
  properties?: Readonly<Record<string, PropertyValueAst>>;
}): CustomDeclAst {
  return {
    kind: "CustomDecl",
    span: TEST_SPAN,
    name: parts.name,
    customKind: parts.customKind,
    customKindIsReserved: parts.reserved ?? false,
    properties: parts.properties ?? {},
  };
}

export function workflowDecl(parts: {
  name: string;
  trigger: TriggerAst;
  steps: readonly WorkflowStepAst[];
  guarantees?: readonly GuaranteeDeclAst[];
  customs?: readonly CustomDeclAst[];
}): WorkflowDeclAst {
  return {
    kind: "WorkflowDecl",
    span: TEST_SPAN,
    name: parts.name,
    trigger: parts.trigger,
    steps: parts.steps,
    guarantees: parts.guarantees ?? [],
    tests: [],
    customs: parts.customs ?? [],
  };
}

export function apiTrigger(
  method: ApiTriggerAst["method"],
  path: string,
  auth: ApiTriggerAst["auth"] = "none",
): ApiTriggerAst {
  return { kind: "ApiTrigger", span: TEST_SPAN, method, path, auth };
}

export function shortGuarantee(
  id: string,
  operator?: ShortGuaranteeAst["operator"],
  value?: PropertyValueAst,
): ShortGuaranteeAst {
  const base = {
    kind: "ShortGuarantee" as const,
    span: TEST_SPAN,
    id,
  };
  if (operator !== undefined && value !== undefined) {
    return { ...base, operator, value };
  }
  if (operator !== undefined) {
    return { ...base, operator };
  }
  if (value !== undefined) {
    return { ...base, value };
  }
  return base;
}

export function longGuarantee(
  name: string,
  properties: Readonly<Record<string, PropertyValueAst>> = {},
): LongGuaranteeAst {
  return {
    kind: "LongGuarantee",
    span: TEST_SPAN,
    name,
    properties,
  };
}

export const steps = {
  validate: (target: string, index: number): WorkflowStepAst => ({
    kind: "ValidateStep",
    span: TEST_SPAN,
    index,
    target,
  }),
  sanitize: (target: string, index: number, policy?: string): WorkflowStepAst => {
    const base = {
      kind: "SanitizeStep" as const,
      span: TEST_SPAN,
      index,
      target,
    };
    return policy !== undefined ? { ...base, policy } : base;
  },
  insert: (modelName: string, index: number): WorkflowStepAst => ({
    kind: "InsertStep",
    span: TEST_SPAN,
    index,
    modelName,
  }),
  update: (modelName: string, index: number): WorkflowStepAst => ({
    kind: "UpdateStep",
    span: TEST_SPAN,
    index,
    modelName,
  }),
  delete_: (modelName: string, index: number): WorkflowStepAst => ({
    kind: "DeleteStep",
    span: TEST_SPAN,
    index,
    modelName,
  }),
  call: (
    integrationName: string,
    operation: string,
    index: number,
  ): WorkflowStepAst => ({
    kind: "CallStep",
    span: TEST_SPAN,
    index,
    integrationName,
    operation,
  }),
  emit: (eventName: string, index: number): WorkflowStepAst => ({
    kind: "EmitStep",
    span: TEST_SPAN,
    index,
    eventName,
  }),
  customCall: (customName: string, index: number): CustomStepCallAst => ({
    kind: "CustomStepCall",
    span: TEST_SPAN,
    index,
    customName,
  }),
};

export const propValues = {
  string: (value: string): PropertyValueAst => ({
    kind: "StringValue",
    span: TEST_SPAN,
    value,
  }),
  number: (value: number): PropertyValueAst => ({
    kind: "NumberValue",
    span: TEST_SPAN,
    value,
  }),
  boolean: (value: boolean): PropertyValueAst => ({
    kind: "BooleanValue",
    span: TEST_SPAN,
    value,
  }),
  identifier: (name: string): PropertyValueAst => ({
    kind: "IdentifierValue",
    span: TEST_SPAN,
    name,
  }),
  list: (items: readonly PropertyValueAst[]): PropertyValueAst => ({
    kind: "ListValue",
    span: TEST_SPAN,
    items,
  }),
};

// -------------------------------------------------------------------------
// Hand-built AST representing the social-feed-v1 fixture.
// -------------------------------------------------------------------------

export function socialFeedV1Ast(file = "backend.arch"): ArchFileAst {
  const userModel = modelDecl({
    name: "User",
    fields: [
      fieldDecl({ name: "id", typeText: "id" }),
      fieldDecl({ name: "email", typeText: "string", indexed: true }),
      fieldDecl({
        name: "createdAt",
        typeText: "timestamp",
        defaultValue: propValues.identifier("now"),
      }),
    ],
  });
  const postModel = modelDecl({
    name: "Post",
    fields: [
      fieldDecl({ name: "id", typeText: "id" }),
      fieldDecl({ name: "authorId", typeText: "User", relationTo: { name: "User" } }),
      fieldDecl({ name: "body", typeText: "string" }),
      fieldDecl({
        name: "createdAt",
        typeText: "timestamp",
        defaultValue: propValues.identifier("now"),
        indexed: true,
      }),
    ],
  });
  const feedCache = integrationDecl({
    name: "FeedCache",
    properties: {
      kind: propValues.identifier("redis"),
      failure: propValues.identifier("best_effort"),
    },
  });
  const pushNotifier = integrationDecl({
    name: "PushNotifier",
    properties: {
      kind: propValues.identifier("webhook"),
      failure: propValues.identifier("best_effort"),
    },
  });
  const sanitizeHtml = policyDecl({
    name: "sanitizeHtml",
    body: "strip script tags and on* attributes from inputs",
  });
  const createPost = workflowDecl({
    name: "CreatePost",
    trigger: apiTrigger("POST", "/posts", "none"),
    steps: [
      steps.validate("body", 0),
      steps.sanitize("body", 1, "sanitizeHtml"),
      steps.insert("Post", 2),
      steps.call("FeedCache", "update", 3),
      steps.call("PushNotifier", "send", 4),
    ],
    guarantees: [
      shortGuarantee("no_unsanitized_html_persisted"),
      shortGuarantee("notification_failure_does_not_rollback_post"),
      shortGuarantee("post_creation_p95_latency", "<=", propValues.number(250)),
    ],
  });

  return {
    kind: "ArchFile",
    file,
    span: TEST_SPAN,
    declarations: [userModel, postModel, feedCache, pushNotifier, sanitizeHtml, createPost],
    reservedSyntax: [],
  };
}

/** social-feed-v2 adds Post.visibility (with default and field-level index). */
export function socialFeedV2Ast(file = "backend.arch"): ArchFileAst {
  const ast = socialFeedV1Ast(file);
  const postIndex = ast.declarations.findIndex(
    (d) => d.kind === "ModelDecl" && d.name === "Post",
  );
  const post = ast.declarations[postIndex] as ModelDeclAst;
  const fields = [...post.fields];
  fields.splice(3, 0, fieldDecl({
    name: "visibility",
    typeText: "enum",
    enumValues: ["public", "private", "followers"],
    defaultValue: propValues.string("public"),
    indexed: true,
  }));
  const declarations = [...ast.declarations];
  declarations[postIndex] = { ...post, fields };
  return { ...ast, declarations };
}
