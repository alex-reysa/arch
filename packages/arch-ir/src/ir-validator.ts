import type {
  ArtifactIR,
  CanonicalIR,
  FieldIR,
  ModelIR,
  WorkflowIR,
} from "./schema.js";
import {
  IR_SCHEMA_VERSION,
  SUPPORTED_TARGET_CACHES,
  SUPPORTED_TARGET_STACKS,
} from "./schema.js";
import { computeCanonicalHash, type CanonicalHashBody } from "./canonicalize.js";

export interface IRValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

const VALID_OWNERSHIP_KIND = new Set([
  "generated_file",
  "generated_region",
  "extension_point",
  "human_file",
]);

const VALID_WRITE_SCOPE = new Set([
  "whole_file",
  "generated_region",
  "stub_only",
  "none",
]);

const VALID_GUARANTEE_STATUS = new Set([
  "covered",
  "partially_covered",
  "manual",
  "missing",
]);

const VALID_GENERATION_MODE = new Set([
  "full_file",
  "generated_region",
  "stub",
  "manual",
]);

/**
 * Final structural check on canonical IR before it is written to
 * .arch/ir.current.json. This is a defence-in-depth pass — semantic
 * validation has already happened upstream. The validator returns a list
 * of human-readable error strings; the caller decides whether to surface
 * them as `Diagnostic`s.
 */
export function validateCanonicalIR(ir: CanonicalIR): IRValidationResult {
  const errors: string[] = [];

  if (ir.schema_version !== IR_SCHEMA_VERSION) {
    errors.push(
      `schema_version mismatch: expected ${IR_SCHEMA_VERSION}, got ${String(ir.schema_version)}`,
    );
  }
  if (typeof ir.canonical_hash !== "string" || ir.canonical_hash.length === 0) {
    errors.push("canonical_hash is missing or empty");
  } else {
    try {
      const expected = computeCanonicalHash(canonicalHashBody(ir));
      if (ir.canonical_hash !== expected) {
        errors.push(
          `canonical_hash mismatch: expected ${expected}, got ${ir.canonical_hash}`,
        );
      }
    } catch (cause) {
      errors.push(`canonical_hash could not be recomputed: ${String(cause)}`);
    }
  }

  // Target --------------------------------------------------------------
  if (!SUPPORTED_TARGET_STACKS.has(ir.target.stack)) {
    errors.push(`target stack is unsupported: ${ir.target.stack}`);
  }
  if (!SUPPORTED_TARGET_CACHES.has(ir.target.cache)) {
    errors.push(`target cache is unsupported: ${String(ir.target.cache)}`);
  }

  // Build entity-id table for cross-reference checks --------------------
  const knownEntityIds = new Set<string>();
  const indexEntity = (id: string): void => {
    if (knownEntityIds.has(id)) {
      errors.push(`duplicate entity id: ${id}`);
    } else {
      knownEntityIds.add(id);
    }
  };

  for (const m of ir.models) {
    indexEntity(m.id);
    for (const f of m.fields) indexEntity(f.id);
    for (const idx of m.indexes) indexEntity(idx.id);
  }
  for (const wf of ir.workflows) {
    indexEntity(wf.id);
    for (const s of wf.steps) indexEntity(s.id);
    for (const g of wf.guarantees) indexEntity(g.id);
  }
  for (const i of ir.integrations) indexEntity(i.id);
  for (const p of ir.policies) indexEntity(p.id);
  for (const c of ir.customs) indexEntity(c.id);

  // Models --------------------------------------------------------------
  for (const m of ir.models) {
    if (!m.fields.some((f) => f.type.kind === "id")) {
      errors.push(`model ${m.name} has no primary key field of type id`);
    }
    for (const field of m.fields) {
      validateFieldRefs(m, field, knownEntityIds, errors);
    }
  }

  // Workflows -----------------------------------------------------------
  for (const wf of ir.workflows) {
    validateWorkflow(wf, ir, knownEntityIds, errors);
  }

  // Artifacts -----------------------------------------------------------
  const ownershipById = new Map(ir.ownership.map((o) => [o.ownership_id, o]));
  const artifactIds = new Set<string>();
  for (const artifact of ir.artifacts) {
    validateArtifact(artifact, ownershipById, knownEntityIds, errors);
    artifactIds.add(artifact.artifact_id);
  }

  // Ownership -----------------------------------------------------------
  const seenOwnership = new Set<string>();
  for (const o of ir.ownership) {
    if (seenOwnership.has(o.ownership_id)) {
      errors.push(`duplicate ownership_id: ${o.ownership_id}`);
    }
    seenOwnership.add(o.ownership_id);
    if (!VALID_OWNERSHIP_KIND.has(o.ownership_kind)) {
      errors.push(`ownership ${o.ownership_id} has invalid kind ${o.ownership_kind}`);
    }
    if (!VALID_WRITE_SCOPE.has(o.write_scope)) {
      errors.push(`ownership ${o.ownership_id} has invalid write_scope ${o.write_scope}`);
    }
    if (!matchesWriteScope(o.ownership_kind, o.write_scope)) {
      errors.push(
        `ownership ${o.ownership_id}: write_scope ${o.write_scope} does not match ownership_kind ${o.ownership_kind}`,
      );
    }
    if (!artifactIds.has(o.artifact_id)) {
      errors.push(
        `ownership ${o.ownership_id} references unknown artifact ${o.artifact_id}`,
      );
    }
  }

  // Guarantee coverage --------------------------------------------------
  const allGuaranteeIds = new Set(
    ir.workflows.flatMap((w) => w.guarantees.map((g) => g.id)),
  );
  for (const cov of ir.guarantee_coverage) {
    if (!allGuaranteeIds.has(cov.guarantee_id)) {
      errors.push(
        `guarantee_coverage references unknown guarantee ${cov.guarantee_id}`,
      );
    }
    if (!VALID_GUARANTEE_STATUS.has(cov.status)) {
      errors.push(
        `guarantee_coverage ${cov.guarantee_id} has invalid status ${cov.status}`,
      );
    }
  }

  // Source locations ----------------------------------------------------
  for (const loc of ir.source_locations) {
    if (loc.start_line < 0 || loc.end_line < 0) {
      errors.push(`source_location ${loc.id} has negative line number`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function canonicalHashBody(ir: CanonicalIR): CanonicalHashBody {
  const { canonical_hash, ...body } = ir;
  void canonical_hash;
  return body;
}

function validateFieldRefs(
  model: ModelIR,
  field: FieldIR,
  known: ReadonlySet<string>,
  errors: string[],
): void {
  const checkType = (t: FieldIR["type"]): void => {
    if (t.kind === "model_ref") {
      if (!known.has(t.target_model_id)) {
        errors.push(
          `field ${model.name}.${field.name} references unknown model ${t.target_model_id}`,
        );
      }
    } else if (t.kind === "list") {
      checkType(t.element);
    } else if (t.kind === "enum") {
      if (t.values.length === 0) {
        errors.push(`enum field ${model.name}.${field.name} declares no values`);
      }
    }
  };
  checkType(field.type);
  if (field.relation) {
    if (!known.has(field.relation.source_model_id)) {
      errors.push(
        `field ${model.name}.${field.name} relation references unknown source ${field.relation.source_model_id}`,
      );
    }
    if (!known.has(field.relation.target_model_id)) {
      errors.push(
        `field ${model.name}.${field.name} relation references unknown target ${field.relation.target_model_id}`,
      );
    }
  }
}

function validateWorkflow(
  wf: WorkflowIR,
  ir: CanonicalIR,
  known: ReadonlySet<string>,
  errors: string[],
): void {
  // Steps must have unique order indices and reference known entities.
  const seenOrders = new Set<number>();
  for (const step of wf.steps) {
    if (seenOrders.has(step.order)) {
      errors.push(`workflow ${wf.name} has duplicate step order ${step.order}`);
    }
    seenOrders.add(step.order);
    const op = step.operation;
    switch (op.kind) {
      case "insert":
      case "update":
      case "delete":
        if (!known.has(op.model_id)) {
          errors.push(
            `workflow ${wf.name} step references unknown model ${op.model_id}`,
          );
        }
        break;
      case "call":
        if (!known.has(op.integration_id)) {
          errors.push(
            `workflow ${wf.name} step references unknown integration ${op.integration_id}`,
          );
        }
        break;
      case "custom_call":
        if (!known.has(op.custom_id)) {
          errors.push(
            `workflow ${wf.name} step references unknown custom ${op.custom_id}`,
          );
        }
        break;
      case "sanitize":
        if (op.policy_id && !known.has(op.policy_id)) {
          errors.push(
            `workflow ${wf.name} sanitize step references unknown policy ${op.policy_id}`,
          );
        }
        break;
      case "validate":
      case "emit":
        // Targets/events are free-form strings.
        break;
    }
  }
  for (const g of wf.guarantees) {
    if (g.workflow_id !== wf.id) {
      errors.push(
        `guarantee ${g.id} workflow_id ${g.workflow_id} does not match parent ${wf.id}`,
      );
    }
  }
  void ir;
}

function validateArtifact(
  artifact: ArtifactIR,
  ownershipById: ReadonlyMap<string, { ownership_id: string }>,
  known: ReadonlySet<string>,
  errors: string[],
): void {
  if (typeof artifact.artifact_id !== "string" || artifact.artifact_id.length === 0) {
    errors.push("artifact has empty artifact_id");
  }
  if (typeof artifact.path !== "string" || artifact.path.length === 0) {
    errors.push(`artifact ${artifact.artifact_id} has empty path`);
  }
  if (!ownershipById.has(artifact.ownership_id)) {
    errors.push(
      `artifact ${artifact.artifact_id} references unknown ownership ${artifact.ownership_id}`,
    );
  }
  if (!VALID_GENERATION_MODE.has(artifact.generation.mode)) {
    errors.push(
      `artifact ${artifact.artifact_id} has invalid generation.mode ${artifact.generation.mode}`,
    );
  }
  if (
    typeof artifact.generation.generator_id !== "string" ||
    artifact.generation.generator_id.length === 0
  ) {
    errors.push(`artifact ${artifact.artifact_id} is missing generator_id`);
  }
  if (
    typeof artifact.generation.ir_fragment_hash !== "string" ||
    artifact.generation.ir_fragment_hash.length === 0 ||
    artifact.generation.ir_fragment_hash === "pending"
  ) {
    errors.push(
      `artifact ${artifact.artifact_id} has missing or unfinalized ir_fragment_hash`,
    );
  }
  for (const id of artifact.entity_ids) {
    if (!known.has(id)) {
      errors.push(
        `artifact ${artifact.artifact_id} references unknown entity ${id}`,
      );
    }
  }
}

function matchesWriteScope(
  kind: string,
  scope: string,
): boolean {
  switch (kind) {
    case "generated_file":
      return scope === "whole_file";
    case "generated_region":
      return scope === "generated_region";
    case "extension_point":
      return scope === "stub_only";
    case "human_file":
      return scope === "none";
  }
  return false;
}
