import type {
  ArchFileAst,
  CallStepAst,
  CustomDeclAst,
  CustomStepCallAst,
  DeleteStepAst,
  EmitStepAst,
  FieldDeclAst,
  GuaranteeDeclAst,
  InsertStepAst,
  IntegrationDeclAst,
  ModelDeclAst,
  PolicyDeclAst,
  PropertyValueAst,
  ReservedSyntaxAst,
  SanitizeStepAst,
  SourceSpan,
  TargetDeclAst,
  TriggerAst,
  UpdateStepAst,
  ValidateStepAst,
  WorkflowDeclAst,
  WorkflowStepAst,
} from "@arch/language";
import { DiagnosticBag } from "@arch/language";
import * as Ids from "./entity-ids.js";
import type {
  ApiTriggerIR,
  ArtifactIR,
  CanonicalIR,
  CustomExtensionIR,
  FieldIR,
  FieldTypeIR,
  GuaranteeCoverageIR,
  GuaranteeIR,
  IntegrationIR,
  ModelIndexIR,
  ModelIR,
  OwnershipIR,
  PolicyIR,
  PrimitiveFieldType,
  RelationCardinality,
  RelationIR,
  SourceLocationIR,
  TargetIR,
  TriggerIR,
  WorkflowIR,
  WorkflowStepIR,
  WorkflowStepOperationIR,
} from "./schema.js";
import {
  DEFAULT_TARGET_CACHE,
  DEFAULT_TARGET_STACK,
  SUPPORTED_TARGET_CACHES,
  SUPPORTED_TARGET_STACKS,
} from "./schema.js";

/**
 * The draft IR is the typed semantic model produced from the AST before
 * canonicalization. References are resolved here; canonical IR is only
 * emitted after semantic validation succeeds.
 *
 * Carries `_unresolvedReferences` so the validator can emit precise
 * source-located diagnostics without re-walking the AST. The draft itself
 * uses the same shape as `CanonicalIR` so canonicalization is just
 * normalization plus hashing.
 */
export type DraftIR = Omit<CanonicalIR, "canonical_hash" | "schema_version"> & {
  readonly _draft: true;
  readonly _unresolvedReferences: readonly UnresolvedReference[];
  readonly _reservedSyntax: readonly ReservedSyntaxAst[];
  readonly _triggerNotes: readonly TriggerNote[];
  readonly _stepNotes: readonly StepNote[];
  readonly _customNotes: readonly CustomNote[];
  readonly _modelNotes: readonly ModelNote[];
  readonly _targetIssues: readonly TargetIssue[];
  readonly _fieldModifierIssues: readonly FieldModifierIssue[];
  readonly _fieldDefaultIssues: readonly FieldDefaultIssue[];
  readonly _longFormGuarantees: readonly LongFormGuaranteeNote[];
};

export interface UnresolvedReference {
  readonly kind: "model" | "integration" | "policy" | "custom";
  readonly name: string;
  readonly span: SourceSpan;
  readonly context: string;
}

export interface TriggerNote {
  readonly workflowId: string;
  readonly kind: "schedule" | "manual" | "unknown";
  readonly span: SourceSpan;
  readonly text?: string;
}

export interface StepNote {
  readonly workflowId: string;
  readonly stepId: string;
  readonly kind: "unknown";
  readonly span: SourceSpan;
  readonly text: string;
}

export interface CustomNote {
  readonly customId: string;
  readonly kind: "reserved";
  readonly customKind: string;
  readonly span: SourceSpan;
}

export interface ModelNote {
  readonly modelId: string;
  readonly modelName: string;
  readonly kind: "missing_primary_key" | "many_to_many";
  readonly span: SourceSpan;
  readonly partnerModel?: string;
}

export interface TargetIssue {
  readonly kind: "unsupported_stack" | "unsupported_cache";
  readonly value: string;
  readonly span: SourceSpan;
}

export interface FieldModifierIssue {
  readonly kind: "unknown" | "reserved";
  readonly modelName: string;
  readonly fieldName: string;
  readonly modifierText: string;
  readonly span: SourceSpan;
}

export interface FieldDefaultIssue {
  readonly modelName: string;
  readonly fieldName: string;
  readonly span: SourceSpan;
  readonly message: string;
}

export interface LongFormGuaranteeNote {
  readonly guaranteeId: string;
  readonly name: string;
  readonly span: SourceSpan;
  readonly verifiability: "testable" | "partially_verifiable" | "manual" | "unsupported" | "unknown";
}

export interface SymbolTable {
  readonly models: ReadonlyMap<string, ModelIR>;
  readonly integrations: ReadonlyMap<string, IntegrationIR>;
  readonly policies: ReadonlyMap<string, PolicyIR>;
  readonly customs: ReadonlyMap<string, CustomExtensionIR>;
  readonly workflows: ReadonlyMap<string, WorkflowIR>;
}

export interface BuildDraftResult {
  readonly draft: DraftIR;
  readonly diagnostics: DiagnosticBag;
  readonly symbols: SymbolTable;
}

// -------------------------------------------------------------------------
// Recognized short-form guarantee identifiers. Anything outside this set is
// rejected by the validator unless the user declares a long-form guarantee.
// -------------------------------------------------------------------------

export const KNOWN_SHORT_GUARANTEES: ReadonlySet<string> = new Set<string>([
  "no_unsanitized_html_persisted",
  "moderation_precedes_persistence",
  "every_llm_decision_has_audit_log",
]);

/** Patterns of the form `<word>_<word>_p95_latency`. */
export function isLatencyShortGuarantee(name: string): boolean {
  return /^[a-z][a-z0-9_]*_p95_latency$/.test(name);
}

/** Patterns of the form `notification_failure_does_not_rollback_<model>`. */
export function isNotificationRollbackShortGuarantee(name: string): boolean {
  return /^notification_failure_does_not_rollback_[a-z][a-z0-9_]*$/.test(name);
}

export function classifyShortGuarantee(
  name: string,
): "known" | "latency" | "notification_rollback" | "unknown" {
  if (KNOWN_SHORT_GUARANTEES.has(name)) return "known";
  if (isLatencyShortGuarantee(name)) return "latency";
  if (isNotificationRollbackShortGuarantee(name)) return "notification_rollback";
  return "unknown";
}

// -------------------------------------------------------------------------
// Reserved custom kinds. `test_generator` is reserved for post-V1.
// -------------------------------------------------------------------------

export const RESERVED_CUSTOM_KINDS: ReadonlySet<string> = new Set<string>([
  "test_generator",
]);

// -------------------------------------------------------------------------
// Type alias normalisation: V1 accepts `datetime` as a synonym for
// `timestamp`. Other primitive types pass through unchanged.
// -------------------------------------------------------------------------

const PRIMITIVES: ReadonlySet<PrimitiveFieldType> = new Set<PrimitiveFieldType>([
  "string",
  "int",
  "bigint",
  "float",
  "boolean",
  "timestamp",
  "json",
]);

export function normalizePrimitiveAlias(typeText: string): PrimitiveFieldType | null {
  const trimmed = typeText.trim();
  if (trimmed === "datetime") return "timestamp";
  if (PRIMITIVES.has(trimmed as PrimitiveFieldType)) {
    return trimmed as PrimitiveFieldType;
  }
  return null;
}

// -------------------------------------------------------------------------
// Build draft IR
// -------------------------------------------------------------------------

export function buildDraftIR(ast: ArchFileAst): BuildDraftResult {
  const diagnostics = new DiagnosticBag();

  const sourceLocations: SourceLocationIR[] = [];
  const sourceCounter = { value: 0 };
  const recordSource = (entityId: string, span: SourceSpan): string => {
    const id = `source:${entityId}:${++sourceCounter.value}`;
    sourceLocations.push({
      id,
      entity_id: entityId,
      file: span.file,
      start_line: span.start.line,
      start_column: span.start.column,
      end_line: span.end.line,
      end_column: span.end.column,
    });
    return id;
  };

  // Target -----------------------------------------------------------------
  const { target, issues: targetIssues } = buildTargetIR(ast.target);

  // Symbol tables ---------------------------------------------------------
  const modelDecls = collectDecls<ModelDeclAst>(ast, "ModelDecl");
  const integrationDecls = collectDecls<IntegrationDeclAst>(ast, "IntegrationDecl");
  const policyDecls = collectDecls<PolicyDeclAst>(ast, "PolicyDecl");
  const workflowDecls = collectDecls<WorkflowDeclAst>(ast, "WorkflowDecl");
  const customDecls = collectDecls<CustomDeclAst>(ast, "CustomDecl");

  // Models, fields, relations, model indexes ------------------------------
  const models: ModelIR[] = [];
  const allFields: FieldIR[] = [];
  const allIndexes: ModelIndexIR[] = [];
  const modelByName = new Map<string, ModelIR>();
  const modelNotes: ModelNote[] = [];
  const fieldDefaultIssues: FieldDefaultIssue[] = [];
  const unresolved: UnresolvedReference[] = [];
  const fieldModifierIssues: FieldModifierIssue[] = [];
  const modelNames = new Set(modelDecls.map((decl) => decl.name));

  for (const decl of modelDecls) {
    const id = Ids.modelId(decl.name);
    const fields: FieldIR[] = [];
    let hasPrimaryKey = false;

    for (const fieldAst of decl.fields) {
      const fieldEntityId = Ids.fieldId(decl.name, fieldAst.name);
      const sourceId = recordSource(fieldEntityId, fieldAst.span);
      const built = buildFieldIR(decl.name, fieldAst, fieldEntityId, sourceId);
      fields.push(built.field);
      if (built.field.type.kind === "id") hasPrimaryKey = true;
      if (built.defaultIssue) fieldDefaultIssues.push(built.defaultIssue);
      fieldModifierIssues.push(...collectFieldModifierIssues(decl.name, fieldAst));
      if (
        fieldAst.relationReference &&
        !modelNames.has(fieldAst.relationReference.targetModelName)
      ) {
        unresolved.push({
          kind: "model",
          name: fieldAst.relationReference.targetModelName,
          span: fieldAst.relationReference.span,
          context: `${decl.name}.${fieldAst.name} field`,
        });
      }
      allFields.push(built.field);
    }

    const indexes: ModelIndexIR[] = [];
    for (const fieldAst of decl.fields) {
      const indexed = fieldAst.modifiers.some(
        (m) => m.kind === "FieldIndexModifier" && m.modifier === "indexed",
      );
      const unique = fieldAst.modifiers.some(
        (m) => m.kind === "FieldIndexModifier" && m.modifier === "unique",
      );
      if (!indexed) continue;
      const indexEntityId = `model_index:${decl.name}.${fieldAst.name}`;
      const sourceId = recordSource(indexEntityId, fieldAst.span);
      const idx: ModelIndexIR = {
        id: indexEntityId,
        kind: "model_index",
        name: `${decl.name}.${fieldAst.name}`,
        model_id: id,
        fields: [fieldAst.name],
        source: "field_modifier",
        unique,
        source_location_id: sourceId,
      };
      indexes.push(idx);
      allIndexes.push(idx);
    }

    const modelSourceId = recordSource(id, decl.span);
    const model: ModelIR = {
      id,
      kind: "model",
      name: decl.name,
      fields,
      indexes,
      source_location_id: modelSourceId,
    };
    models.push(model);
    modelByName.set(decl.name, model);

    if (!hasPrimaryKey) {
      modelNotes.push({
        modelId: id,
        modelName: decl.name,
        kind: "missing_primary_key",
        span: decl.span,
      });
    }
  }

  // Many-to-many detection -------------------------------------------------
  for (const decl of modelDecls) {
    for (const fieldAst of decl.fields) {
      if (!fieldAst.relationReference || !fieldAst.relationReference.many) continue;
      const target = fieldAst.relationReference.targetModelName;
      const partner = modelDecls.find((m) => m.name === target);
      if (!partner) continue;
      const reverse = partner.fields.find(
        (f) => f.relationReference && f.relationReference.targetModelName === decl.name && f.relationReference.many,
      );
      if (reverse) {
        // Each side records the violation with its own span; downstream
        // dedup keeps a single diagnostic per ordered model pair.
        modelNotes.push({
          modelId: Ids.modelId(decl.name),
          modelName: decl.name,
          kind: "many_to_many",
          span: fieldAst.span,
          partnerModel: target,
        });
      }
    }
  }

  // Integrations ----------------------------------------------------------
  const integrations: IntegrationIR[] = [];
  const integrationByName = new Map<string, IntegrationIR>();
  for (const decl of integrationDecls) {
    const id = Ids.integrationId(decl.name);
    const sourceId = recordSource(id, decl.span);
    const integration: IntegrationIR = {
      id,
      kind: "integration",
      name: decl.name,
      properties: snapshotProperties(decl.properties),
      source_location_id: sourceId,
    };
    integrations.push(integration);
    integrationByName.set(decl.name, integration);
  }

  // Policies --------------------------------------------------------------
  const policies: PolicyIR[] = [];
  const policyByName = new Map<string, PolicyIR>();
  for (const decl of policyDecls) {
    const id = Ids.policyId(decl.name);
    const sourceId = recordSource(id, decl.span);
    const policy: PolicyIR = {
      id,
      kind: "policy",
      name: decl.name,
      body: decl.body,
      source_location_id: sourceId,
    };
    policies.push(policy);
    policyByName.set(decl.name, policy);
  }

  // Custom extensions -----------------------------------------------------
  const customs: CustomExtensionIR[] = [];
  const customByName = new Map<string, CustomExtensionIR>();
  const customNotes: CustomNote[] = [];
  for (const decl of customDecls) {
    const id = Ids.customId(decl.name);
    const sourceId = recordSource(id, decl.span);
    const custom: CustomExtensionIR = {
      id,
      kind: "custom",
      name: decl.name,
      customKind: decl.customKind,
      properties: snapshotProperties(decl.properties),
      source_location_id: sourceId,
    };
    customs.push(custom);
    customByName.set(decl.name, custom);
    if (decl.customKindIsReserved || RESERVED_CUSTOM_KINDS.has(decl.customKind)) {
      customNotes.push({
        customId: id,
        kind: "reserved",
        customKind: decl.customKind,
        span: decl.span,
      });
    }
  }

  // Workflows -------------------------------------------------------------
  const workflows: WorkflowIR[] = [];
  const workflowByName = new Map<string, WorkflowIR>();
  const guarantees: GuaranteeIR[] = [];
  const triggerNotes: TriggerNote[] = [];
  const stepNotes: StepNote[] = [];
  const longFormNotes: LongFormGuaranteeNote[] = [];

  for (const decl of workflowDecls) {
    const wfId = Ids.workflowId(decl.name);
    const wfSourceId = recordSource(wfId, decl.span);
    const trigger = buildTrigger(decl.trigger, wfId, triggerNotes);

    const steps: WorkflowStepIR[] = [];
    for (const stepAst of decl.steps) {
      const built = buildStep(decl.name, wfId, stepAst, recordSource);
      if (built.step) steps.push(built.step);
      if (built.unresolved) unresolved.push(...built.unresolved);
      if (built.note) stepNotes.push(built.note);
    }

    const wfGuarantees: GuaranteeIR[] = [];
    for (const guard of decl.guarantees) {
      const built = buildGuarantee(decl.name, wfId, guard, recordSource);
      if (built.guarantee) {
        wfGuarantees.push(built.guarantee);
        guarantees.push(built.guarantee);
      }
      if (built.longFormNote) longFormNotes.push(built.longFormNote);
    }

    const wf: WorkflowIR = {
      id: wfId,
      kind: "workflow",
      name: decl.name,
      trigger,
      steps,
      guarantees: wfGuarantees,
      source_location_id: wfSourceId,
    };
    workflows.push(wf);
    workflowByName.set(decl.name, wf);

    // Custom extensions declared inside a workflow are also surfaced as
    // top-level CustomExtensionIRs so the validator can check them
    // uniformly with file-level customs.
    for (const inner of decl.customs) {
      const id = Ids.customId(inner.name);
      const sourceId = recordSource(id, inner.span);
      const custom: CustomExtensionIR = {
        id,
        kind: "custom",
        name: inner.name,
        customKind: inner.customKind,
        properties: snapshotProperties(inner.properties),
        source_location_id: sourceId,
      };
      customs.push(custom);
      customByName.set(inner.name, custom);
      if (inner.customKindIsReserved || RESERVED_CUSTOM_KINDS.has(inner.customKind)) {
        customNotes.push({
          customId: id,
          kind: "reserved",
          customKind: inner.customKind,
          span: inner.span,
        });
      }
    }
  }

  // Resolve references that depend on other entities. We do this in a
  // second pass so forward references resolve regardless of declaration
  // order in the source file.
  collectStepReferences(
    workflows,
    modelByName,
    integrationByName,
    policyByName,
    customByName,
    unresolved,
    workflowDecls,
  );

  // Build relations after symbol tables exist so we can fill
  // target_model_id and storage from the resolved symbol.
  // NOTE: relations are stored on the field IR; we already populated them
  // above. Nothing further needed.

  // Artifacts and ownership ------------------------------------------------
  const { artifacts, ownership } = buildArtifactsAndOwnership(
    target,
    models,
    workflows,
    integrations,
    customs,
    guarantees,
  );

  const guaranteeCoverage = buildGuaranteeCoverage(workflows, artifacts);

  const verification = {
    typecheck: true,
    tests: true,
    migrations: true,
  } as const;

  const draft: DraftIR = {
    _draft: true,
    target,
    models,
    integrations,
    policies,
    workflows,
    customs,
    artifacts,
    ownership,
    verification,
    guarantee_coverage: guaranteeCoverage,
    source_locations: sourceLocations,
    _unresolvedReferences: unresolved,
    _reservedSyntax: ast.reservedSyntax,
    _triggerNotes: triggerNotes,
    _stepNotes: stepNotes,
    _customNotes: customNotes,
    _modelNotes: modelNotes,
    _targetIssues: targetIssues,
    _fieldModifierIssues: fieldModifierIssues,
    _fieldDefaultIssues: fieldDefaultIssues,
    _longFormGuarantees: longFormNotes,
  };

  const symbols: SymbolTable = {
    models: modelByName,
    integrations: integrationByName,
    policies: policyByName,
    customs: customByName,
    workflows: workflowByName,
  };

  return { draft, diagnostics, symbols };
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function buildTargetIR(targetAst: TargetDeclAst | undefined): {
  readonly target: TargetIR;
  readonly issues: readonly TargetIssue[];
} {
  if (!targetAst) {
    return {
      target: { stack: DEFAULT_TARGET_STACK, cache: DEFAULT_TARGET_CACHE },
      issues: [],
    };
  }

  const issues: TargetIssue[] = [];
  if (!SUPPORTED_TARGET_STACKS.has(targetAst.stack)) {
    issues.push({
      kind: "unsupported_stack",
      value: targetAst.stack,
      span: targetAst.span,
    });
  }

  let cache: TargetIR["cache"] = DEFAULT_TARGET_CACHE;
  if (targetAst.cache !== undefined) {
    if (SUPPORTED_TARGET_CACHES.has(targetAst.cache as TargetIR["cache"])) {
      cache = targetAst.cache as TargetIR["cache"];
    } else {
      issues.push({
        kind: "unsupported_cache",
        value: targetAst.cache,
        span: targetAst.span,
      });
    }
  }

  return {
    target: { stack: targetAst.stack, cache },
    issues,
  };
}

function collectDecls<T extends { kind: string }>(
  ast: ArchFileAst,
  kind: T["kind"],
): readonly T[] {
  return ast.declarations.filter(
    (d) => (d as { kind: string }).kind === kind,
  ) as unknown as readonly T[];
}

interface BuildFieldResult {
  readonly field: FieldIR;
  readonly defaultIssue?: FieldDefaultIssue;
}

function collectFieldModifierIssues(
  modelName: string,
  ast: FieldDeclAst,
): readonly FieldModifierIssue[] {
  const issues: FieldModifierIssue[] = [];
  for (const modifier of ast.modifiers) {
    if (modifier.kind === "FieldUnknownModifier") {
      issues.push({
        kind: "unknown",
        modelName,
        fieldName: ast.name,
        modifierText: modifier.text,
        span: modifier.span,
      });
    } else if (
      modifier.kind === "FieldIndexModifier" &&
      modifier.modifier === "unique"
    ) {
      issues.push({
        kind: "reserved",
        modelName,
        fieldName: ast.name,
        modifierText: modifier.modifier,
        span: modifier.span,
      });
    }
  }
  return issues;
}

function buildFieldIR(
  modelName: string,
  ast: FieldDeclAst,
  fieldId: string,
  sourceId: string,
): BuildFieldResult {
  const indexed = ast.modifiers.some(
    (m) => m.kind === "FieldIndexModifier" && m.modifier === "indexed",
  );
  const defaultModifier = ast.modifiers.find(
    (m): m is { kind: "FieldDefaultModifier"; value: PropertyValueAst; span: SourceSpan } =>
      m.kind === "FieldDefaultModifier",
  );

  const ref = ast.relationReference;

  // Type lowering ---------------------------------------------------------
  let type: FieldTypeIR;
  let relation: RelationIR | undefined;
  if (ast.typeText === "id") {
    type = { kind: "id" };
  } else if (ref) {
    const targetId = Ids.modelId(ref.targetModelName);
    if (ref.many) {
      type = { kind: "list", element: { kind: "model_ref", target_model_id: targetId } };
      relation = {
        id: `relation:${modelName}.${ast.name}`,
        kind: "relation",
        name: `${modelName}.${ast.name}`,
        cardinality: "one_to_many",
        source_model_id: Ids.modelId(modelName),
        target_model_id: targetId,
        storage: "non_persisted",
      };
    } else {
      type = { kind: "model_ref", target_model_id: targetId };
      relation = {
        id: `relation:${modelName}.${ast.name}`,
        kind: "relation",
        name: `${modelName}.${ast.name}`,
        cardinality: "many_to_one",
        source_model_id: Ids.modelId(modelName),
        target_model_id: targetId,
        storage: "persisted",
      };
    }
  } else if (ast.typeText === "enum" && ast.enumValues && ast.enumValues.length > 0) {
    // Enum intent is preserved verbatim: values keep source order (order is
    // semantic, so reordering changes the canonical hash).
    type = { kind: "enum", values: [...ast.enumValues] };
  } else {
    const prim = normalizePrimitiveAlias(ast.typeText);
    if (prim) {
      type = { kind: "primitive", name: prim };
    } else {
      // Unknown raw type — treat as opaque string for now; semantic
      // validator may still flag through default-value checks.
      type = { kind: "primitive", name: "string" };
    }
  }

  // Default value lowering & validation ----------------------------------
  let defaultValue: unknown;
  let defaultIssue: FieldDefaultIssue | undefined;
  if (defaultModifier) {
    const result = lowerDefault(modelName, ast.name, type, defaultModifier.value);
    defaultValue = result.value;
    if (result.issue) defaultIssue = result.issue;
  }

  const baseField = {
    id: fieldId,
    kind: "field" as const,
    name: ast.name,
    model_id: Ids.modelId(modelName),
    type,
    nullable: false,
    indexed,
    source_location_id: sourceId,
  };

  const field: FieldIR =
    defaultValue !== undefined && relation !== undefined
      ? { ...baseField, default: defaultValue, relation }
      : defaultValue !== undefined
        ? { ...baseField, default: defaultValue }
        : relation !== undefined
          ? { ...baseField, relation }
          : baseField;

  return defaultIssue ? { field, defaultIssue } : { field };
}

interface DefaultLowering {
  readonly value: unknown;
  readonly issue?: FieldDefaultIssue;
}

function lowerDefault(
  modelName: string,
  fieldName: string,
  type: FieldTypeIR,
  value: PropertyValueAst,
): DefaultLowering {
  // `default: now` for timestamp fields is a special identifier.
  if (value.kind === "IdentifierValue" && value.name === "now") {
    if (type.kind === "primitive" && type.name === "timestamp") {
      return { value: { kind: "now" } };
    }
    return {
      value: { kind: "now" },
      issue: {
        modelName,
        fieldName,
        span: value.span,
        message: `default \`now\` requires a timestamp field, got ${formatType(type)}`,
      },
    };
  }
  if (type.kind === "enum") {
    const member =
      value.kind === "StringValue"
        ? value.value
        : value.kind === "IdentifierValue"
          ? value.name
          : null;
    if (member === null) return defaultMismatch(modelName, fieldName, type, value);
    if (!type.values.includes(member)) {
      return {
        value: member,
        issue: {
          modelName,
          fieldName,
          span: value.span,
          message: `default \`${member}\` is not one of the enum values [${type.values.join(", ")}]`,
        },
      };
    }
    return { value: member };
  }
  if (type.kind === "primitive") {
    switch (type.name) {
      case "string": {
        if (value.kind === "StringValue") return { value: value.value };
        if (value.kind === "IdentifierValue") return { value: value.name };
        return defaultMismatch(modelName, fieldName, type, value);
      }
      case "int":
      case "bigint":
      case "float": {
        if (value.kind === "NumberValue") return { value: value.value };
        return defaultMismatch(modelName, fieldName, type, value);
      }
      case "boolean": {
        if (value.kind === "BooleanValue") return { value: value.value };
        return defaultMismatch(modelName, fieldName, type, value);
      }
      case "json": {
        return { value: lowerPropertyValue(value) };
      }
      case "timestamp": {
        if (value.kind === "StringValue") return { value: value.value };
        return defaultMismatch(modelName, fieldName, type, value);
      }
    }
  }
  return defaultMismatch(modelName, fieldName, type, value);
}

function defaultMismatch(
  modelName: string,
  fieldName: string,
  type: FieldTypeIR,
  value: PropertyValueAst,
): DefaultLowering {
  return {
    value: lowerPropertyValue(value),
    issue: {
      modelName,
      fieldName,
      span: value.span,
      message: `default value of kind ${value.kind} does not match field type ${formatType(type)}`,
    },
  };
}

function lowerPropertyValue(value: PropertyValueAst): unknown {
  switch (value.kind) {
    case "StringValue":
      return value.value;
    case "NumberValue":
      return value.value;
    case "BooleanValue":
      return value.value;
    case "IdentifierValue":
      return { kind: "identifier", name: value.name };
    case "ListValue":
      return value.items.map(lowerPropertyValue);
  }
}

function snapshotProperties(
  props: Readonly<Record<string, PropertyValueAst>>,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = lowerPropertyValue(v);
  }
  return out;
}

function formatType(type: FieldTypeIR): string {
  switch (type.kind) {
    case "primitive":
      return type.name;
    case "id":
      return "id";
    case "enum":
      return `enum[${type.values.join(", ")}]`;
    case "model_ref":
      return type.target_model_id;
    case "list":
      return `list<${formatType(type.element)}>`;
  }
}

function buildTrigger(
  ast: TriggerAst,
  workflowId: string,
  triggerNotes: TriggerNote[],
): TriggerIR {
  if (ast.kind === "ApiTrigger") {
    const apiTrigger: ApiTriggerIR = {
      kind: "api",
      method: ast.method,
      path: ast.path,
      auth: ast.auth,
    };
    return apiTrigger;
  }
  if (ast.kind === "ReservedScheduleTrigger") {
    triggerNotes.push({
      workflowId,
      kind: "schedule",
      span: ast.span,
      ...(ast.cron !== undefined ? { text: ast.cron } : {}),
    });
  } else if (ast.kind === "ReservedManualTrigger") {
    triggerNotes.push({
      workflowId,
      kind: "manual",
      span: ast.span,
      ...(ast.label !== undefined ? { text: ast.label } : {}),
    });
  } else {
    triggerNotes.push({ workflowId, kind: "unknown", span: ast.span, text: ast.text });
  }
  // Placeholder trigger so the workflow IR remains structurally valid;
  // the validator emits the real diagnostic and downstream pipelines
  // never see a draft that has reserved triggers without diagnostics.
  return { kind: "api", method: "GET", path: "/__unsupported_trigger__", auth: "none" };
}

interface BuildStepResult {
  readonly step?: WorkflowStepIR;
  readonly unresolved?: UnresolvedReference[];
  readonly note?: StepNote;
}

function buildStep(
  workflowName: string,
  workflowId: string,
  ast: WorkflowStepAst,
  recordSource: (entityId: string, span: SourceSpan) => string,
): BuildStepResult {
  const stepEntityId = Ids.workflowStepId(workflowName, ast.index, ast.kind);
  const sourceId = recordSource(stepEntityId, ast.span);
  switch (ast.kind) {
    case "ValidateStep": {
      const a = ast as ValidateStepAst;
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, {
          kind: "validate",
          target: a.target,
        }),
      };
    }
    case "SanitizeStep": {
      const a = ast as SanitizeStepAst;
      const op: WorkflowStepOperationIR =
        a.policy !== undefined
          ? { kind: "sanitize", target: a.target, policy_id: Ids.policyId(a.policy) }
          : { kind: "sanitize", target: a.target };
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, op),
      };
    }
    case "InsertStep": {
      const a = ast as InsertStepAst;
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, {
          kind: "insert",
          model_id: Ids.modelId(a.modelName),
        }),
      };
    }
    case "UpdateStep": {
      const a = ast as UpdateStepAst;
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, {
          kind: "update",
          model_id: Ids.modelId(a.modelName),
        }),
      };
    }
    case "DeleteStep": {
      const a = ast as DeleteStepAst;
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, {
          kind: "delete",
          model_id: Ids.modelId(a.modelName),
        }),
      };
    }
    case "CallStep": {
      const a = ast as CallStepAst;
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, {
          kind: "call",
          integration_id: Ids.integrationId(a.integrationName),
          operation: a.operation,
        }),
      };
    }
    case "EmitStep": {
      const a = ast as EmitStepAst;
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, {
          kind: "emit",
          event: a.eventName,
        }),
      };
    }
    case "CustomStepCall": {
      const a = ast as CustomStepCallAst;
      return {
        step: stepIR(stepEntityId, workflowId, ast.index, sourceId, ast.kind, {
          kind: "custom_call",
          custom_id: Ids.customId(a.customName),
        }),
      };
    }
    case "UnknownStep": {
      return {
        note: {
          workflowId,
          stepId: stepEntityId,
          kind: "unknown",
          span: ast.span,
          text: ast.text,
        },
      };
    }
  }
}

function stepIR(
  id: string,
  workflowId: string,
  order: number,
  sourceId: string,
  astKind: string,
  operation: WorkflowStepOperationIR,
): WorkflowStepIR {
  return {
    id,
    kind: "workflow_step",
    name: `${id}.${astKind}`,
    workflow_id: workflowId,
    order,
    operation,
    source_location_id: sourceId,
  };
}

interface BuildGuaranteeResult {
  readonly guarantee?: GuaranteeIR;
  readonly longFormNote?: LongFormGuaranteeNote;
}

function buildGuarantee(
  workflowName: string,
  workflowId: string,
  ast: GuaranteeDeclAst,
  recordSource: (entityId: string, span: SourceSpan) => string,
): BuildGuaranteeResult {
  if (ast.kind === "ShortGuarantee") {
    const id = Ids.guaranteeId(workflowName, ast.id);
    const sourceId = recordSource(id, ast.span);
    const args: Record<string, unknown> = {};
    if (ast.operator !== undefined) args.operator = ast.operator;
    if (ast.value !== undefined) args.value = lowerPropertyValue(ast.value);
    return {
      guarantee: {
        id,
        kind: "guarantee",
        name: ast.id,
        workflow_id: workflowId,
        form: "short",
        arguments: args,
        source_location_id: sourceId,
      },
    };
  }
  // Long form
  const id = Ids.guaranteeId(workflowName, ast.name);
  const sourceId = recordSource(id, ast.span);
  const guarantee: GuaranteeIR = {
    id,
    kind: "guarantee",
    name: ast.name,
    workflow_id: workflowId,
    form: "long",
    arguments: snapshotProperties(ast.properties),
    source_location_id: sourceId,
  };

  // Long-form guarantees are diagnostics-only when their declared
  // verifiability is unsupported (or absent). The validator decides what
  // to report; here we only attach the note.
  const verifiabilityValue = ast.properties.verifiability;
  let verifiability: LongFormGuaranteeNote["verifiability"] = "unknown";
  if (verifiabilityValue && verifiabilityValue.kind === "IdentifierValue") {
    const name = verifiabilityValue.name;
    if (
      name === "testable" ||
      name === "partially_verifiable" ||
      name === "manual" ||
      name === "unsupported"
    ) {
      verifiability = name;
    }
  } else if (verifiabilityValue && verifiabilityValue.kind === "StringValue") {
    const name = verifiabilityValue.value;
    if (
      name === "testable" ||
      name === "partially_verifiable" ||
      name === "manual" ||
      name === "unsupported"
    ) {
      verifiability = name;
    }
  }

  return {
    guarantee,
    longFormNote: {
      guaranteeId: id,
      name: ast.name,
      span: ast.span,
      verifiability,
    },
  };
}

function collectStepReferences(
  workflows: readonly WorkflowIR[],
  modelByName: ReadonlyMap<string, ModelIR>,
  integrationByName: ReadonlyMap<string, IntegrationIR>,
  policyByName: ReadonlyMap<string, PolicyIR>,
  customByName: ReadonlyMap<string, CustomExtensionIR>,
  unresolved: UnresolvedReference[],
  workflowDecls: readonly WorkflowDeclAst[],
): void {
  for (const wf of workflows) {
    const declMatch = workflowDecls.find((d) => d.name === wf.name);
    if (!declMatch) continue;
    for (const stepAst of declMatch.steps) {
      switch (stepAst.kind) {
        case "InsertStep":
        case "UpdateStep":
        case "DeleteStep": {
          const a = stepAst as InsertStepAst | UpdateStepAst | DeleteStepAst;
          if (!modelByName.has(a.modelName)) {
            unresolved.push({
              kind: "model",
              name: a.modelName,
              span: stepAst.span,
              context: `${wf.name} step ${a.kind}`,
            });
          }
          break;
        }
        case "CallStep": {
          const a = stepAst as CallStepAst;
          if (!integrationByName.has(a.integrationName)) {
            unresolved.push({
              kind: "integration",
              name: a.integrationName,
              span: stepAst.span,
              context: `${wf.name} step call`,
            });
          }
          break;
        }
        case "CustomStepCall": {
          const a = stepAst as CustomStepCallAst;
          if (!customByName.has(a.customName)) {
            unresolved.push({
              kind: "custom",
              name: a.customName,
              span: stepAst.span,
              context: `${wf.name} step custom_call`,
            });
          }
          break;
        }
        case "SanitizeStep": {
          const a = stepAst as SanitizeStepAst;
          if (a.policy !== undefined && !policyByName.has(a.policy)) {
            unresolved.push({
              kind: "policy",
              name: a.policy,
              span: stepAst.span,
              context: `${wf.name} step sanitize`,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

// -------------------------------------------------------------------------
// Artifact + ownership skeletons
//
// The IR carries a deterministic set of artifact + ownership entries so the
// canonical hash is meaningful even before the generator package exists.
// Paths and ownership shapes follow §6 of the IR_SPEC.
// -------------------------------------------------------------------------

function buildArtifactsAndOwnership(
  target: TargetIR,
  models: readonly ModelIR[],
  workflows: readonly WorkflowIR[],
  integrations: readonly IntegrationIR[],
  customs: readonly CustomExtensionIR[],
  guarantees: readonly GuaranteeIR[],
): { artifacts: ArtifactIR[]; ownership: OwnershipIR[] } {
  const artifacts: ArtifactIR[] = [];
  const ownership: OwnershipIR[] = [];

  const push = (
    artifact_id: string,
    path: string,
    entity_ids: readonly string[],
    mode: "full_file" | "generated_region" | "stub" | "manual",
    generator_id: string,
    template_id?: string,
  ): void => {
    const ownership_id = `ownership:${artifact_id}`;
    artifacts.push({
      artifact_id,
      path,
      entity_ids,
      ownership_id,
      generation: {
        mode,
        generator_id,
        // ir_fragment_hash is a placeholder here; canonicalize() rewrites it
        // with the real hash once the IR is normalized.
        ir_fragment_hash: "pending",
        ...(template_id !== undefined ? { template_id } : {}),
      },
    });
    const ownershipEntry: OwnershipIR = ownershipFor(ownership_id, artifact_id, mode);
    ownership.push(ownershipEntry);
  };

  // Prisma schema covers all models -------------------------------------
  if (models.length > 0) {
    push(
      "artifact:prisma.schema",
      "prisma/schema.prisma",
      models.map((m) => m.id),
      "full_file",
      "generator.prisma_schema",
      "template.prisma_schema_v1",
    );
  }

  // Per-model files ------------------------------------------------------
  for (const model of models) {
    push(
      `artifact:src.generated.models.${model.name}`,
      `src/generated/models/${model.name}.ts`,
      [model.id, ...model.fields.map((f) => f.id)],
      "full_file",
      "generator.model_module",
      "template.model_module_v1",
    );
    push(
      `artifact:src.generated.validators.${model.name}`,
      `src/generated/validators/${model.name}.ts`,
      [model.id, ...model.fields.map((f) => f.id)],
      "full_file",
      "generator.model_validator",
      "template.model_validator_v1",
    );
  }

  // Per-workflow + per-integration files ---------------------------------
  for (const wf of workflows) {
    const supportedGuarantees = wf.guarantees.filter(
      (g) => !isUnsupportedLongGuarantee(g),
    );
    push(
      `artifact:src.generated.workflows.${wf.name}`,
      `src/generated/workflows/${wf.name}.ts`,
      [
        wf.id,
        ...wf.steps.map((s) => s.id),
        ...supportedGuarantees.map((g) => g.id),
      ],
      "full_file",
      "generator.workflow_module",
      "template.workflow_module_v1",
    );
    push(
      `artifact:src.generated.routes.${wf.name}`,
      `src/generated/routes/${wf.name}.ts`,
      [wf.id],
      "full_file",
      "generator.route_module",
      "template.route_module_v1",
    );
  }

  for (const integration of integrations) {
    push(
      `artifact:src.extensions.integrations.${integration.name}`,
      `src/extensions/integrations/${integration.name}.ts`,
      [integration.id],
      "stub",
      "generator.integration_stub",
      "template.integration_stub_v1",
    );
  }

  // Custom extensions are extension points; arch may write the initial
  // stub once but never overwrite human edits afterwards.
  for (const custom of customs) {
    push(
      `artifact:src.extensions.customs.${custom.name}`,
      `src/extensions/customs/${custom.name}.ts`,
      [custom.id],
      "stub",
      "generator.custom_stub",
      "template.custom_stub_v1",
    );
  }

  // Guarantee tests ------------------------------------------------------
  for (const guarantee of guarantees) {
    if (isUnsupportedLongGuarantee(guarantee)) continue;
    push(
      `artifact:tests.generated.guarantees.${guarantee.workflow_id}.${guarantee.name}`,
      `tests/generated/guarantees/${guaranteeWorkflowName(guarantee)}.${guarantee.name}.test.ts`,
      [guarantee.id, guarantee.workflow_id],
      "generated_region",
      "generator.guarantee_test",
      "template.guarantee_test_v1",
    );
  }

  // Target -- target-aware top-level config ------------------------------
  push(
    "artifact:package.json",
    "package.json",
    [],
    "manual",
    "generator.package_manifest",
  );
  void target; // target informs generator selection in real builds.

  return { artifacts, ownership };
}

function guaranteeWorkflowName(g: GuaranteeIR): string {
  // workflow_id has the form "workflow:Name"
  return g.workflow_id.replace(/^workflow:/, "");
}

function isUnsupportedLongGuarantee(g: GuaranteeIR): boolean {
  return g.form === "long" && guaranteeVerifiability(g) === "unsupported";
}

function guaranteeVerifiability(g: GuaranteeIR): string | undefined {
  const value = g.arguments["verifiability"];
  if (typeof value === "string") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    "kind" in value &&
    "name" in value &&
    (value as { readonly kind?: unknown }).kind === "identifier" &&
    typeof (value as { readonly name?: unknown }).name === "string"
  ) {
    return (value as { readonly name: string }).name;
  }
  return undefined;
}

function ownershipFor(
  ownership_id: string,
  artifact_id: string,
  mode: "full_file" | "generated_region" | "stub" | "manual",
): OwnershipIR {
  switch (mode) {
    case "full_file":
      return {
        ownership_id,
        artifact_id,
        ownership_kind: "generated_file",
        write_scope: "whole_file",
        owner: "arch",
      };
    case "generated_region":
      return {
        ownership_id,
        artifact_id,
        ownership_kind: "generated_region",
        write_scope: "generated_region",
        owner: "arch",
      };
    case "stub":
      return {
        ownership_id,
        artifact_id,
        ownership_kind: "extension_point",
        write_scope: "stub_only",
        owner: "arch",
      };
    case "manual":
      return {
        ownership_id,
        artifact_id,
        ownership_kind: "human_file",
        write_scope: "none",
        owner: "human",
      };
  }
}

function buildGuaranteeCoverage(
  workflows: readonly WorkflowIR[],
  artifacts: readonly ArtifactIR[],
): readonly GuaranteeCoverageIR[] {
  const coverage: GuaranteeCoverageIR[] = [];
  for (const wf of workflows) {
    for (const g of wf.guarantees) {
      coverage.push({
        guarantee_id: g.id,
        status: classifyCoverage(g, wf),
        artifact_ids: artifacts
          .filter((a) => a.entity_ids.includes(g.id))
          .map((a) => a.artifact_id),
      });
    }
  }
  return coverage;
}

function classifyCoverage(
  guarantee: GuaranteeIR,
  workflow: WorkflowIR,
): GuaranteeCoverageIR["status"] {
  if (guarantee.form === "short") {
    if (isLatencyShortGuarantee(guarantee.name)) return "partially_covered";
    if (KNOWN_SHORT_GUARANTEES.has(guarantee.name)) {
      // moderation_precedes_persistence requires a workflow with a
      // sanitize/validate step before insert; we still call it covered
      // here — the planner is responsible for surfacing static check
      // results.
      return "covered";
    }
    if (isNotificationRollbackShortGuarantee(guarantee.name)) {
      // Coverage depends on workflow shape; treat as covered when an
      // insert step exists.
      const hasInsert = workflow.steps.some((s) => s.operation.kind === "insert");
      return hasInsert ? "covered" : "missing";
    }
    return "missing";
  }
  // Long-form: read declared verifiability if present.
  const v = guaranteeVerifiability(guarantee);
  if (v === "testable") return "covered";
  if (v === "partially_verifiable") return "partially_covered";
  if (v === "manual") return "manual";
  return "missing";
}

export type { RelationCardinality } from "./schema.js";
