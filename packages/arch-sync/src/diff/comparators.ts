/**
 * Typed comparators between two `CanonicalIR` snapshots.
 *
 * The exported `compareIR` returns the canonical V1 diff list plus any
 * unsupported-change diagnostics. Comparators are pure: same input pair →
 * byte-identical output. They never mutate the IRs they receive, and they
 * walk in deterministic order so plan IDs and plan hashes are reproducible.
 *
 * Coverage matches `SYNC_ENGINE_SPEC.md` §7.7:
 *   - models / fields / indexes / relations
 *   - integrations
 *   - policies
 *   - workflows / steps / guarantees
 *   - custom extensions
 *   - target (system / trigger surface changes are blocked as unsupported)
 */

import type {
  ArtifactGenerationIR,
  CanonicalIR,
  CustomExtensionIR,
  FieldIR,
  GuaranteeIR,
  IntegrationIR,
  ModelIR,
  ModelIndexIR,
  PolicyIR,
  RelationIR,
  TargetIR,
  WorkflowIR,
  WorkflowStepIR,
} from "@arch/ir";
import type { DiffV1, ConfirmationKind, DiffRiskClass } from "./diff-schema.js";

// -------------------------------------------------------------------------
// Public surface kept for the legacy index helpers. Used by the tests +
// classification.ts during the pre-V1 transition window.
// -------------------------------------------------------------------------

export function modelsById(models: readonly ModelIR[]): Map<string, ModelIR> {
  return new Map(models.map((m) => [m.id, m]));
}

export function fieldsById(fields: readonly FieldIR[]): Map<string, FieldIR> {
  return new Map(fields.map((f) => [f.id, f]));
}

export function workflowsById(workflows: readonly WorkflowIR[]): Map<string, WorkflowIR> {
  return new Map(workflows.map((w) => [w.id, w]));
}

// -------------------------------------------------------------------------
// V1 comparator surface.
// -------------------------------------------------------------------------

export interface UnsupportedDiagnostic {
  readonly code:
    | "unsupported_target_system_change"
    | "unsupported_trigger_change"
    | "unsupported_relation_storage_change";
  readonly message: string;
  readonly entity_ids: readonly string[];
}

export interface CompareResult {
  readonly diffs: readonly DiffV1[];
  readonly diagnostics: readonly UnsupportedDiagnostic[];
}

export function compareIR(
  previous: CanonicalIR,
  current: CanonicalIR,
): CompareResult {
  const diffs: DiffV1[] = [];
  const diagnostics: UnsupportedDiagnostic[] = [];

  diffs.push(...compareModels(previous.models, current.models));
  diffs.push(
    ...compareIntegrations(previous.integrations, current.integrations),
  );
  diffs.push(...comparePolicies(previous.policies, current.policies));
  diffs.push(
    ...compareWorkflows(
      previous.workflows,
      current.workflows,
      previous.models,
      current.models,
      diagnostics,
    ),
  );
  diffs.push(...compareCustoms(previous.customs, current.customs));
  diffs.push(
    ...compareTarget(previous.target, current.target, diagnostics),
  );

  // Determinism: stable sort by `(type, primary_entity_id)`.
  return { diffs: sortDiffs(diffs), diagnostics };
}

// -------------------------------------------------------------------------
// Model / field / index / relation comparison.
// -------------------------------------------------------------------------

function compareModels(
  prev: readonly ModelIR[],
  curr: readonly ModelIR[],
): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = modelsById(prev);
  const currMap = modelsById(curr);

  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      out.push(buildDiff({
        type: "model_added",
        entity_ids: [b.id],
        risk: "additive",
        reason: `Model ${b.name} added.`,
      }, { model_id: b.id }));
      continue;
    }
    if (a && !b) {
      out.push(buildDiff({
        type: "model_removed",
        entity_ids: [a.id],
        risk: "destructive",
        confirmations: ["destructive", "schema_breaking"],
        reason: `Model ${a.name} removed.`,
      }, { model_id: a.id }));
      continue;
    }
    if (!a || !b) continue;

    out.push(...compareFields(a, b));
    out.push(...compareIndexes(a, b));
    out.push(...compareRelations(a, b));
  }
  return out;
}

function compareFields(prev: ModelIR, curr: ModelIR): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = fieldsById(prev.fields);
  const currMap = fieldsById(curr.fields);

  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      const requiredWithoutDefault =
        !b.nullable && b.default === undefined && b.type.kind !== "id";
      out.push(buildDiff({
        type: "model_field_added",
        entity_ids: [curr.id, b.id],
        risk: requiredWithoutDefault ? "destructive" : "additive",
        confirmations: requiredWithoutDefault
          ? ["destructive", "schema_breaking"]
          : [],
        reason: requiredWithoutDefault
          ? `Field ${curr.name}.${b.name} added required without a default.`
          : b.nullable
            ? `Optional field ${curr.name}.${b.name} added.`
            : `Field ${curr.name}.${b.name} added with a safe default.`,
        affectedEntityHints: [curr.id],
      }, {
        model_id: curr.id,
        field_id: b.id,
        nullable: b.nullable,
        has_default: b.default !== undefined,
        required_without_default: requiredWithoutDefault,
      }));
      continue;
    }
    if (a && !b) {
      out.push(buildDiff({
        type: "model_field_removed",
        entity_ids: [curr.id, a.id],
        risk: "destructive",
        confirmations: ["destructive", "schema_breaking"],
        reason: `Field ${prev.name}.${a.name} removed.`,
        affectedEntityHints: [curr.id],
      }, { model_id: curr.id, field_id: a.id }));
      continue;
    }
    if (!a || !b) continue;

    if (!sameFieldType(a.type, b.type)) {
      out.push(buildDiff({
        type: "model_field_type_changed",
        entity_ids: [curr.id, b.id],
        risk: "modifying",
        confirmations: ["schema_breaking"],
        reason: `Field ${curr.name}.${b.name} changed type from ${describeFieldType(a.type)} to ${describeFieldType(b.type)}.`,
        affectedEntityHints: [curr.id],
      }, {
        model_id: curr.id,
        field_id: b.id,
        before_type: describeFieldType(a.type),
        after_type: describeFieldType(b.type),
      }));
    }

    if (a.nullable !== b.nullable) {
      out.push(buildDiff({
        type: "model_field_constraint_changed",
        entity_ids: [curr.id, b.id],
        risk: a.nullable && !b.nullable ? "destructive" : "modifying",
        confirmations: a.nullable && !b.nullable
          ? ["destructive", "schema_breaking"]
          : [],
        reason: `Field ${curr.name}.${b.name} nullable: ${a.nullable} → ${b.nullable}.`,
      }, {
        model_id: curr.id,
        field_id: b.id,
        constraint: "nullable" as const,
      }));
    }

    if (!sameJson(a.default, b.default)) {
      out.push(buildDiff({
        type: "model_field_constraint_changed",
        entity_ids: [curr.id, b.id],
        risk: "modifying",
        confirmations: [],
        reason: `Field ${curr.name}.${b.name} default changed.`,
      }, {
        model_id: curr.id,
        field_id: b.id,
        constraint: "default" as const,
      }));
    }
  }
  return out;
}

function compareIndexes(prev: ModelIR, curr: ModelIR): DiffV1[] {
  const out: DiffV1[] = [];
  const indexById = (xs: readonly ModelIndexIR[]) =>
    new Map(xs.map((x) => [x.id, x]));
  const prevMap = indexById(prev.indexes);
  const currMap = indexById(curr.indexes);

  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      out.push(buildDiff({
        type: "model_index_added",
        entity_ids: [curr.id, b.id],
        risk: "additive",
        confirmations: [],
        reason: `Index ${b.name} added on ${curr.name}.`,
        affectedEntityHints: [curr.id],
      }, { model_id: curr.id, index_id: b.id }));
      continue;
    }
    if (a && !b) {
      out.push(buildDiff({
        type: "model_index_removed",
        entity_ids: [curr.id, a.id],
        risk: "modifying",
        confirmations: [],
        reason: `Index ${a.name} removed from ${curr.name}.`,
      }, { model_id: curr.id, index_id: a.id }));
      continue;
    }
    if (!a || !b) continue;

    if (a.unique !== b.unique || !sameStringList(a.fields, b.fields)) {
      out.push(buildDiff({
        type: "model_index_changed",
        entity_ids: [curr.id, b.id],
        risk: "modifying",
        confirmations: a.unique !== b.unique ? ["schema_breaking"] : [],
        reason: `Index ${b.name} changed.`,
      }, { model_id: curr.id, index_id: b.id }));
    }
  }
  return out;
}

function compareRelations(prev: ModelIR, curr: ModelIR): DiffV1[] {
  const out: DiffV1[] = [];
  const relationById = (model: ModelIR) =>
    new Map(
      model.fields
        .filter((f): f is FieldIR & { relation: RelationIR } => Boolean(f.relation))
        .map((f) => [f.relation.id, f.relation]),
    );
  const prevMap = relationById(prev);
  const currMap = relationById(curr);
  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      out.push(buildDiff({
        type: "relation_added",
        entity_ids: [curr.id, b.id],
        risk: "additive",
        reason: `Relation ${b.name} added.`,
        affectedEntityHints: [curr.id],
      }, { relation_id: b.id }));
    } else if (a && !b) {
      out.push(buildDiff({
        type: "relation_removed",
        entity_ids: [curr.id, a.id],
        risk: "destructive",
        confirmations: ["destructive", "schema_breaking"],
        reason: `Relation ${a.name} removed.`,
        affectedEntityHints: [curr.id],
      }, { relation_id: a.id }));
    } else if (a && b && (a.cardinality !== b.cardinality || a.storage !== b.storage)) {
      out.push(buildDiff({
        type: "relation_changed",
        entity_ids: [curr.id, b.id],
        risk: "modifying",
        confirmations: ["schema_breaking"],
        reason: `Relation ${b.name} changed.`,
        affectedEntityHints: [curr.id],
      }, { relation_id: b.id }));
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// Integration / policy / custom comparison.
// -------------------------------------------------------------------------

function compareIntegrations(
  prev: readonly IntegrationIR[],
  curr: readonly IntegrationIR[],
): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = new Map(prev.map((p) => [p.id, p]));
  const currMap = new Map(curr.map((c) => [c.id, c]));
  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      out.push(buildDiff({
        type: "integration_added",
        entity_ids: [b.id],
        risk: "additive",
        reason: `Integration ${b.name} added.`,
      }, { integration_id: b.id }));
    } else if (a && !b) {
      out.push(buildDiff({
        type: "integration_removed",
        entity_ids: [a.id],
        risk: "destructive",
        confirmations: ["destructive"],
        reason: `Integration ${a.name} removed.`,
      }, { integration_id: a.id }));
    } else if (a && b && !sameJson(a.properties, b.properties)) {
      out.push(buildDiff({
        type: "integration_changed",
        entity_ids: [b.id],
        risk: "modifying",
        reason: `Integration ${b.name} properties changed.`,
      }, { integration_id: b.id }));
    }
  }
  return out;
}

function comparePolicies(
  prev: readonly PolicyIR[],
  curr: readonly PolicyIR[],
): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = new Map(prev.map((p) => [p.id, p]));
  const currMap = new Map(curr.map((c) => [c.id, c]));
  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      out.push(buildDiff({
        type: "policy_added",
        entity_ids: [b.id],
        risk: "additive",
        reason: `Policy ${b.name} added.`,
      }, { policy_id: b.id }));
    } else if (a && !b) {
      out.push(buildDiff({
        type: "policy_removed",
        entity_ids: [a.id],
        risk: "destructive",
        confirmations: ["destructive"],
        reason: `Policy ${a.name} removed.`,
      }, { policy_id: a.id }));
    } else if (a && b && a.body !== b.body) {
      out.push(buildDiff({
        type: "policy_changed",
        entity_ids: [b.id],
        risk: "modifying",
        reason: `Policy ${b.name} body changed.`,
      }, { policy_id: b.id }));
    }
  }
  return out;
}

function compareCustoms(
  prev: readonly CustomExtensionIR[],
  curr: readonly CustomExtensionIR[],
): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = new Map(prev.map((p) => [p.id, p]));
  const currMap = new Map(curr.map((c) => [c.id, c]));
  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      out.push(buildDiff({
        type: "custom_extension_added",
        entity_ids: [b.id],
        risk: "additive",
        reason: `Custom extension ${b.name} added.`,
      }, { custom_id: b.id }));
    } else if (a && !b) {
      out.push(buildDiff({
        type: "custom_extension_removed",
        entity_ids: [a.id],
        risk: "destructive",
        confirmations: ["destructive"],
        reason: `Custom extension ${a.name} removed.`,
      }, { custom_id: a.id }));
    } else if (a && b) {
      const contractChanged = a.customKind !== b.customKind;
      const callSitesChanged = !sameJson(a.properties, b.properties);
      if (contractChanged || callSitesChanged) {
        out.push(buildDiff({
          type: "custom_extension_changed",
          entity_ids: [b.id],
          risk: "modifying",
          confirmations: contractChanged ? ["schema_breaking"] : [],
          reason: contractChanged
            ? `Custom extension ${b.name} contract changed.`
            : `Custom extension ${b.name} configuration changed.`,
        }, {
          custom_id: b.id,
          contract_changed: contractChanged,
          call_sites_changed: callSitesChanged,
        }));
      }
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// Workflow / step / guarantee comparison.
// -------------------------------------------------------------------------

function compareWorkflows(
  prev: readonly WorkflowIR[],
  curr: readonly WorkflowIR[],
  _prevModels: readonly ModelIR[],
  _currModels: readonly ModelIR[],
  diagnostics: UnsupportedDiagnostic[],
): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = new Map(prev.map((w) => [w.id, w]));
  const currMap = new Map(curr.map((w) => [w.id, w]));
  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const a = prevMap.get(id);
    const b = currMap.get(id);
    if (!a && b) {
      out.push(buildDiff({
        type: "workflow_added",
        entity_ids: [b.id],
        risk: "additive",
        reason: `Workflow ${b.name} added.`,
      }, { workflow_id: b.id }));
      continue;
    }
    if (a && !b) {
      out.push(buildDiff({
        type: "workflow_removed",
        entity_ids: [a.id],
        risk: "destructive",
        confirmations: ["destructive"],
        reason: `Workflow ${a.name} removed.`,
      }, { workflow_id: a.id }));
      continue;
    }
    if (!a || !b) continue;

    if (!sameTrigger(a.trigger, b.trigger)) {
      diagnostics.push({
        code: "unsupported_trigger_change",
        message: `Workflow ${b.name} trigger surface changed; trigger changes are unsupported in V1.`,
        entity_ids: [b.id],
      });
    }

    out.push(...compareWorkflowSteps(a, b));
    out.push(...compareGuarantees(a, b));
  }
  return out;
}

function compareWorkflowSteps(a: WorkflowIR, b: WorkflowIR): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = new Map(a.steps.map((s) => [s.id, s]));
  const currMap = new Map(b.steps.map((s) => [s.id, s]));
  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const x = prevMap.get(id);
    const y = currMap.get(id);
    if (!x && y) {
      out.push(buildDiff({
        type: "workflow_step_added",
        entity_ids: [b.id, y.id],
        risk: "additive",
        reason: `Workflow ${b.name} added step ${y.name}.`,
      }, { workflow_id: b.id, step_id: y.id }));
    } else if (x && !y) {
      out.push(buildDiff({
        type: "workflow_step_removed",
        entity_ids: [b.id, x.id],
        risk: "destructive",
        confirmations: ["destructive"],
        reason: `Workflow ${a.name} removed step ${x.name}.`,
      }, { workflow_id: b.id, step_id: x.id }));
    } else if (x && y && !sameStepOperation(x, y)) {
      out.push(buildDiff({
        type: "workflow_step_changed",
        entity_ids: [b.id, y.id],
        risk: "modifying",
        reason: `Workflow ${b.name} step ${y.name} operation changed.`,
      }, { workflow_id: b.id, step_id: y.id }));
    }
  }
  // Reorder detection: identical step ids but different order.
  const prevOrder = a.steps.map((s) => s.id);
  const currOrder = b.steps.map((s) => s.id);
  if (
    sameSet(new Set(prevOrder), new Set(currOrder)) &&
    !sameStringList(prevOrder, currOrder)
  ) {
    out.push(buildDiff({
      type: "workflow_step_reordered",
      entity_ids: [b.id],
      risk: "modifying",
      reason: `Workflow ${b.name} step order changed.`,
    }, {
      workflow_id: b.id,
      before_order: prevOrder,
      after_order: currOrder,
    }));
  }
  return out;
}

function compareGuarantees(a: WorkflowIR, b: WorkflowIR): DiffV1[] {
  const out: DiffV1[] = [];
  const prevMap = new Map(a.guarantees.map((g) => [g.id, g]));
  const currMap = new Map(b.guarantees.map((g) => [g.id, g]));
  for (const id of unionSorted(keys(prevMap), keys(currMap))) {
    const x = prevMap.get(id);
    const y = currMap.get(id);
    if (!x && y) {
      out.push(buildDiff({
        type: "guarantee_added",
        entity_ids: [b.id, y.id],
        risk: "additive",
        reason: `Workflow ${b.name} guarantee ${y.name} added.`,
      }, { workflow_id: b.id, guarantee_id: y.id }));
    } else if (x && !y) {
      out.push(buildDiff({
        type: "guarantee_removed",
        entity_ids: [b.id, x.id],
        risk: "destructive",
        confirmations: ["guarantee_weakening"],
        reason: `Workflow ${a.name} guarantee ${x.name} removed.`,
      }, { workflow_id: b.id, guarantee_id: x.id }));
    } else if (x && y) {
      const stricter = guaranteeStricter(x, y);
      const looser = guaranteeStricter(y, x);
      if (!sameJson(x.arguments, y.arguments) || x.form !== y.form) {
        out.push(buildDiff({
          type: "guarantee_changed",
          entity_ids: [b.id, y.id],
          risk: looser ? "destructive" : "modifying",
          confirmations: looser ? ["guarantee_weakening"] : [],
          reason: `Workflow ${b.name} guarantee ${y.name} changed.`,
        }, {
          workflow_id: b.id,
          guarantee_id: y.id,
          stricter,
        }));
      }
    }
  }
  return out;
}

// -------------------------------------------------------------------------
// Target.
// -------------------------------------------------------------------------

function compareTarget(
  prev: TargetIR,
  curr: TargetIR,
  diagnostics: UnsupportedDiagnostic[],
): DiffV1[] {
  if (prev.stack === curr.stack && prev.cache === curr.cache) return [];
  if (prev.stack !== curr.stack) {
    diagnostics.push({
      code: "unsupported_target_system_change",
      message: `Target system changed (${prev.stack} → ${curr.stack}); not supported in V1.`,
      entity_ids: [],
    });
    return [];
  }
  return [buildDiff({
    type: "target_changed",
    entity_ids: [],
    risk: "modifying",
    confirmations: ["target_change"],
    reason: `Target cache changed (${prev.cache} → ${curr.cache}).`,
  }, {
    field: "cache" as const,
    before: prev.cache,
    after: curr.cache,
  })];
}

// -------------------------------------------------------------------------
// Helpers.
// -------------------------------------------------------------------------

interface BuildOptions {
  readonly type: DiffV1["type"];
  readonly entity_ids: readonly string[];
  readonly risk: DiffRiskClass;
  readonly confirmations?: readonly ConfirmationKind[];
  readonly affectedEntityHints?: readonly string[];
  readonly reason: string;
}

function buildDiff(opts: BuildOptions, extra: Record<string, unknown>): DiffV1 {
  const requiresConfirmation = (opts.confirmations ?? []).length > 0;
  const identity = diffIdentityParts(opts, extra).map(normalizeId).join(".");
  const diff_id = `diff.${opts.type}.${identity}`;
  const common = {
    diff_id,
    entity_ids: opts.entity_ids,
    risk: opts.risk,
    requires_confirmation: requiresConfirmation,
    confirmation_kinds: opts.confirmations ?? [],
    affected_entity_hints: opts.affectedEntityHints ?? [],
    reason: opts.reason,
  };
  return { type: opts.type, ...common, ...extra } as DiffV1;
}

function diffIdentityParts(
  opts: BuildOptions,
  extra: Record<string, unknown>,
): string[] {
  const parts = opts.entity_ids.length > 0 ? [...opts.entity_ids] : ["_root"];
  const seen = new Set(parts.map(normalizeId));
  const append = (value: unknown): void => {
    if (typeof value !== "string" || value.length === 0) return;
    const normalized = normalizeId(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    parts.push(value);
  };

  append(extra["field_id"]);
  append(extra["index_id"]);
  append(extra["relation_id"]);
  append(extra["workflow_id"]);
  append(extra["step_id"]);
  append(extra["guarantee_id"]);
  append(extra["integration_id"]);
  append(extra["custom_id"]);
  append(extra["policy_id"]);
  append(extra["test_id"]);
  append(extra["constraint"]);
  append(extra["field"]);
  return parts;
}

function normalizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, "_");
}

function keys<K, V>(m: Map<K, V>): K[] {
  return [...m.keys()];
}

function unionSorted<T extends string>(a: readonly T[], b: readonly T[]): T[] {
  const set = new Set<T>([...a, ...b]);
  return [...set].sort();
}

function sortDiffs(diffs: readonly DiffV1[]): DiffV1[] {
  // Deterministic order: type first, then primary entity id, then diff_id.
  const typeOrder = (d: DiffV1) => d.type;
  return [...diffs].sort((x, y) => {
    const tx = typeOrder(x);
    const ty = typeOrder(y);
    if (tx < ty) return -1;
    if (tx > ty) return 1;
    const ex = x.entity_ids[0] ?? "";
    const ey = y.entity_ids[0] ?? "";
    if (ex < ey) return -1;
    if (ex > ey) return 1;
    return x.diff_id < y.diff_id ? -1 : x.diff_id > y.diff_id ? 1 : 0;
  });
}

function sameJson(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function sameFieldType(a: FieldIR["type"], b: FieldIR["type"]): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

function describeFieldType(t: FieldIR["type"]): string {
  if (t.kind === "id") return "id";
  if (t.kind === "primitive") return t.name;
  if (t.kind === "enum") return `enum[${t.values.join(",")}]`;
  if (t.kind === "model_ref") return `ref:${t.target_model_id}`;
  return `list<${describeFieldType(t.element)}>`;
}

function sameTrigger(a: WorkflowIR["trigger"], b: WorkflowIR["trigger"]): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}

function sameStepOperation(a: WorkflowStepIR, b: WorkflowStepIR): boolean {
  return canonicalStringify(a.operation) === canonicalStringify(b.operation);
}

function guaranteeStricter(a: GuaranteeIR, b: GuaranteeIR): boolean {
  // Heuristic for V1: numeric "<= N" guarantees become stricter as N decreases.
  const lim = (g: GuaranteeIR): number | undefined => {
    const v = (g.arguments as Record<string, unknown>)["limit_ms"];
    return typeof v === "number" ? v : undefined;
  };
  const la = lim(a);
  const lb = lim(b);
  if (la !== undefined && lb !== undefined) return lb < la;
  return false;
}

export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const ks = Object.keys(obj).sort();
    return `{${ks.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// `ArtifactGenerationIR` comes from @arch/ir; re-export for downstream tests.
export type { ArtifactGenerationIR };
