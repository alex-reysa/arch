import type { SourceSpan } from "./source-map.js";

/**
 * The Arch V1 AST.
 *
 * Every node carries a `SourceSpan` so diagnostics produced by the semantic
 * validator can re-anchor on the original source. Reserved syntax (named
 * indexes, composite indexes, schedule triggers, custom kinds reserved for
 * post-V1) is parsed into typed reserved-* nodes so the validator can reject
 * them with a precise diagnostic instead of failing at the lexer/parser layer.
 *
 * The shapes here are the contract every other package compiles against.
 * They must be kept in sync with `LANGUAGE_SPEC.md` §V1 grammar.
 */

export interface AstNode {
  readonly kind: string;
  readonly span: SourceSpan;
}

// -------------------------------------------------------------------------
// Top-level file
// -------------------------------------------------------------------------

export interface ArchFileAst extends AstNode {
  readonly kind: "ArchFile";
  readonly file: string;
  readonly target?: TargetDeclAst;
  readonly system?: SystemDeclAst;
  readonly declarations: readonly DeclarationAst[];
  /**
   * Reserved-syntax nodes that the parser captured but the semantic validator
   * must reject (named/composite indexes, schedule triggers, reserved custom
   * kinds, ...). Surfaced separately so a downstream tool can enumerate them
   * without walking the whole tree.
   */
  readonly reservedSyntax: readonly ReservedSyntaxAst[];
}

export type DeclarationAst =
  | ModelDeclAst
  | IntegrationDeclAst
  | PolicyDeclAst
  | WorkflowDeclAst
  | CustomDeclAst;

// -------------------------------------------------------------------------
// System / target
// -------------------------------------------------------------------------

export interface SystemDeclAst extends AstNode {
  readonly kind: "SystemDecl";
  readonly name: string;
  readonly description?: string;
  readonly properties: Readonly<Record<string, PropertyValueAst>>;
}

export interface TargetDeclAst extends AstNode {
  readonly kind: "TargetDecl";
  /** Raw stack identifier, e.g. `ts.node.fastify.postgres.prisma`. */
  readonly stack: string;
  /** Optional `cache: <id>` modifier (`redis`, `none`, ...). */
  readonly cache?: string;
  /** Other target modifiers parsed but reserved for future expansion. */
  readonly modifiers: Readonly<Record<string, string>>;
}

// -------------------------------------------------------------------------
// Models, fields, relations, indexes
// -------------------------------------------------------------------------

export interface ModelDeclAst extends AstNode {
  readonly kind: "ModelDecl";
  readonly name: string;
  readonly fields: readonly FieldDeclAst[];
  /**
   * Reserved-syntax: V1 only supports field-level `indexed` modifiers. A
   * top-level `index name (a, b)` form is parsed but rejected by semantic
   * validation. These reserved declarations live here so the validator
   * doesn't have to re-walk the model body.
   */
  readonly reservedIndexes: readonly ReservedIndexDeclAst[];
}

export interface FieldDeclAst extends AstNode {
  readonly kind: "FieldDecl";
  readonly name: string;
  /** Raw type expression as written, e.g. `string`, `id`, `User`, `timestamp`. */
  readonly typeText: string;
  /**
   * Enum member values, in source order, when `typeText === "enum"` and the
   * declaration used the `enum["a", "b"]` form. Order is semantic.
   */
  readonly enumValues?: readonly string[];
  /** Optional default value, parsed but typed loosely at AST stage. */
  readonly defaultValue?: PropertyValueAst;
  /** Field-level modifiers in source order: `indexed`, `index`, `unique?`, ... */
  readonly modifiers: readonly FieldModifierAst[];
  /**
   * If the field's type is the name of another model, the parser records a
   * relation reference here. Cardinality and storage are inferred at lower
   * stages (semantic validation / draft IR) — the AST only captures syntax.
   */
  readonly relationReference?: RelationReferenceAst;
}

export interface RelationReferenceAst extends AstNode {
  readonly kind: "RelationReference";
  readonly targetModelName: string;
  /** `[]` suffix for one-to-many; absent otherwise. */
  readonly many: boolean;
}

export type FieldModifierAst =
  | FieldIndexModifierAst
  | FieldDefaultModifierAst
  | FieldUnknownModifierAst;

export interface FieldIndexModifierAst extends AstNode {
  readonly kind: "FieldIndexModifier";
  /**
   * V1 supports `indexed` and its source alias `index`; `unique` is reserved
   * syntax.
   */
  readonly modifier: "indexed" | "unique";
}

export interface FieldDefaultModifierAst extends AstNode {
  readonly kind: "FieldDefaultModifier";
  readonly value: PropertyValueAst;
}

/**
 * Modifier that the parser saw on a field but does not understand. The
 * semantic validator will emit a diagnostic. Kept typed so we don't lose
 * source position.
 */
export interface FieldUnknownModifierAst extends AstNode {
  readonly kind: "FieldUnknownModifier";
  readonly text: string;
}

// -------------------------------------------------------------------------
// Reserved index syntax (named, composite)
// -------------------------------------------------------------------------

export interface ReservedIndexDeclAst extends AstNode {
  readonly kind: "ReservedIndexDecl";
  /**
   * `named` — `index <name> (<field>)` form is reserved.
   * `composite` — `index (<field>, <field>)` form is reserved.
   */
  readonly form: "named" | "composite";
  readonly name?: string;
  readonly fields: readonly string[];
}

// -------------------------------------------------------------------------
// Integrations
// -------------------------------------------------------------------------

export interface IntegrationDeclAst extends AstNode {
  readonly kind: "IntegrationDecl";
  readonly name: string;
  /** Free-form properties; `kind` and `failure` are validated semantically. */
  readonly properties: Readonly<Record<string, PropertyValueAst>>;
}

// -------------------------------------------------------------------------
// Policies
// -------------------------------------------------------------------------

export interface PolicyDeclAst extends AstNode {
  readonly kind: "PolicyDecl";
  readonly name: string;
  /** `body: "..."` quoted text or a brace block (rendered as raw text). */
  readonly body: string;
  readonly properties: Readonly<Record<string, PropertyValueAst>>;
}

// -------------------------------------------------------------------------
// Workflows: triggers, steps, guarantees, tests, customs
// -------------------------------------------------------------------------

export interface WorkflowDeclAst extends AstNode {
  readonly kind: "WorkflowDecl";
  readonly name: string;
  readonly trigger: TriggerAst;
  readonly steps: readonly WorkflowStepAst[];
  readonly guarantees: readonly GuaranteeDeclAst[];
  readonly tests: readonly WorkflowTestAst[];
  /** `custom <Name> {}` blocks scoped to the workflow body, if any. */
  readonly customs: readonly CustomDeclAst[];
}

export type TriggerAst =
  | ApiTriggerAst
  | ReservedScheduleTriggerAst
  | ReservedManualTriggerAst
  | UnknownTriggerAst;

export interface ApiTriggerAst extends AstNode {
  readonly kind: "ApiTrigger";
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  /** `auth: none | required | optional`. */
  readonly auth: "none" | "required" | "optional";
}

/** `trigger schedule cron("...")` — reserved for post-V1. */
export interface ReservedScheduleTriggerAst extends AstNode {
  readonly kind: "ReservedScheduleTrigger";
  readonly cron?: string;
}

/** `trigger manual("...")` — reserved for post-V1. */
export interface ReservedManualTriggerAst extends AstNode {
  readonly kind: "ReservedManualTrigger";
  readonly label?: string;
}

export interface UnknownTriggerAst extends AstNode {
  readonly kind: "UnknownTrigger";
  readonly text: string;
}

export type WorkflowStepAst =
  | ValidateStepAst
  | SanitizeStepAst
  | InsertStepAst
  | UpdateStepAst
  | DeleteStepAst
  | CallStepAst
  | EmitStepAst
  | CustomStepCallAst
  | UnknownStepAst;

export interface BaseStepAst extends AstNode {
  /** Source-order index. Workflow step order is semantic and preserved. */
  readonly index: number;
}

export interface ValidateStepAst extends BaseStepAst {
  readonly kind: "ValidateStep";
  readonly target: string;
}

export interface SanitizeStepAst extends BaseStepAst {
  readonly kind: "SanitizeStep";
  readonly target: string;
  /** `using <policyName>` clause. */
  readonly policy?: string;
}

export interface InsertStepAst extends BaseStepAst {
  readonly kind: "InsertStep";
  readonly modelName: string;
}

export interface UpdateStepAst extends BaseStepAst {
  readonly kind: "UpdateStep";
  readonly modelName: string;
}

export interface DeleteStepAst extends BaseStepAst {
  readonly kind: "DeleteStep";
  readonly modelName: string;
}

export interface CallStepAst extends BaseStepAst {
  readonly kind: "CallStep";
  /** Integration entity name, e.g. `FeedCache`. */
  readonly integrationName: string;
  /** Operation, e.g. `update`, `send`. */
  readonly operation: string;
}

export interface EmitStepAst extends BaseStepAst {
  readonly kind: "EmitStep";
  readonly eventName: string;
}

export interface CustomStepCallAst extends BaseStepAst {
  readonly kind: "CustomStepCall";
  readonly customName: string;
}

export interface UnknownStepAst extends BaseStepAst {
  readonly kind: "UnknownStep";
  readonly text: string;
}

// -------------------------------------------------------------------------
// Guarantees
// -------------------------------------------------------------------------

export type GuaranteeDeclAst = ShortGuaranteeAst | LongGuaranteeAst;

/**
 * Short-form: `guarantee <id>` or `guarantee <id> <op> <value>` (e.g.
 * `guarantee post_creation_p95_latency <= 250`).
 */
export interface ShortGuaranteeAst extends AstNode {
  readonly kind: "ShortGuarantee";
  readonly id: string;
  readonly operator?: "<=" | ">=" | "<" | ">" | "==";
  readonly value?: PropertyValueAst;
}

/** Long-form: `guarantee Name { ... }` block with structured properties. */
export interface LongGuaranteeAst extends AstNode {
  readonly kind: "LongGuarantee";
  readonly name: string;
  readonly properties: Readonly<Record<string, PropertyValueAst>>;
}

// -------------------------------------------------------------------------
// Workflow tests
// -------------------------------------------------------------------------

export type WorkflowTestAst = GeneratedTestAst | CustomTestAst;

export interface GeneratedTestAst extends AstNode {
  readonly kind: "GeneratedTest";
  /** `tests generate <id>` form. */
  readonly id: string;
}

export interface CustomTestAst extends AstNode {
  readonly kind: "CustomTest";
  /** `tests include custom <path>` form. */
  readonly path: string;
}

// -------------------------------------------------------------------------
// Custom blocks
// -------------------------------------------------------------------------

export interface CustomDeclAst extends AstNode {
  readonly kind: "CustomDecl";
  readonly name: string;
  /** Raw `kind:` value as written; reserved kinds are flagged below. */
  readonly customKind: string;
  /**
   * `true` when `customKind` is reserved for post-V1 (e.g. `test_generator`).
   * Set by the parser so the semantic validator can reject without re-checking
   * the kind string.
   */
  readonly customKindIsReserved: boolean;
  readonly properties: Readonly<Record<string, PropertyValueAst>>;
}

// -------------------------------------------------------------------------
// Property values
// -------------------------------------------------------------------------

export type PropertyValueAst =
  | { readonly kind: "StringValue"; readonly value: string; readonly span: SourceSpan }
  | { readonly kind: "NumberValue"; readonly value: number; readonly span: SourceSpan }
  | { readonly kind: "BooleanValue"; readonly value: boolean; readonly span: SourceSpan }
  | { readonly kind: "IdentifierValue"; readonly name: string; readonly span: SourceSpan }
  | {
      readonly kind: "ListValue";
      readonly items: readonly PropertyValueAst[];
      readonly span: SourceSpan;
    };

// -------------------------------------------------------------------------
// Reserved syntax aggregate
// -------------------------------------------------------------------------

/**
 * Aggregate type for any reserved-syntax node so the parser can publish a
 * single `reservedSyntax` array to consumers (semantic validator, diagnostics
 * printer) without forcing each consumer to know every individual variant.
 */
export type ReservedSyntaxAst =
  | ReservedIndexDeclAst
  | ReservedScheduleTriggerAst
  | ReservedManualTriggerAst
  | { readonly kind: "ReservedCustomKind"; readonly customKind: string; readonly span: SourceSpan }
  | { readonly kind: "ReservedDeclaration"; readonly text: string; readonly span: SourceSpan };
