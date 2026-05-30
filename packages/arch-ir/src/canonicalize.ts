import type { DraftIR } from "./draft-ir.js";
import type {
  ArtifactIR,
  CanonicalIR,
  CustomExtensionIR,
  FieldIR,
  GuaranteeCoverageIR,
  GuaranteeIR,
  IntegrationIR,
  ModelIndexIR,
  ModelIR,
  OwnershipIR,
  PolicyIR,
  WorkflowIR,
  WorkflowStepIR,
} from "./schema.js";
import { IR_SCHEMA_VERSION } from "./schema.js";
import { canonicalStringify } from "./canonical-json.js";
import { hashCanonical, hashFragment } from "./hash.js";

export type CanonicalHashBody = Omit<CanonicalIR, "canonical_hash">;

/**
 * Convert a validated draft IR into canonical arch.ir.v1 JSON.
 *
 * Determinism rules:
 *
 *   - Unordered collections (models, integrations, policies, workflows,
 *     customs, artifacts, ownership, guarantee_coverage, source_locations)
 *     are sorted by their stable id.
 *   - Within each model, fields and indexes are sorted by id.
 *   - Workflow steps preserve their source-order index — step order is
 *     semantic.
 *   - Long-form guarantee `arguments` arrays preserve their input order —
 *     enum-like value order is semantic.
 *   - The canonical hash is computed over the canonical body excluding
 *     `source_locations` and every `source_location_id` so that comment-
 *     only and formatting-only source changes produce identical hashes.
 */
export function canonicalize(draft: DraftIR): CanonicalIR {
  // First pass: stable-sort all unordered collections, normalize alias
  // values, and produce a draft-shaped intermediate.
  const models = sortBy([...draft.models], (m) => m.id).map(canonicalModel);
  const integrations = sortBy([...draft.integrations], (i) => i.id).map(canonicalIntegration);
  const policies = sortBy([...draft.policies], (p) => p.id).map(canonicalPolicy);
  const customs = sortBy([...draft.customs], (c) => c.id).map(canonicalCustom);
  const workflows = sortBy([...draft.workflows], (w) => w.id).map(canonicalWorkflow);
  const guarantee_coverage = sortBy(
    [...draft.guarantee_coverage],
    (g) => g.guarantee_id,
  ).map(canonicalCoverage);
  const ownership = sortBy([...draft.ownership], (o) => o.ownership_id).map(canonicalOwnership);
  const source_locations = sortBy(
    [...draft.source_locations],
    (s) => s.id,
  );

  // Artifacts come last because their `ir_fragment_hash` is computed over
  // the canonicalised entity table.
  const sortedArtifacts = sortBy([...draft.artifacts], (a) => a.artifact_id);
  const entityById = buildEntityMap(models, workflows, integrations, policies, customs);
  const artifacts: ArtifactIR[] = sortedArtifacts.map((a) =>
    finalizeArtifact(a, entityById),
  );

  const body: CanonicalHashBody = {
    schema_version: IR_SCHEMA_VERSION,
    target: draft.target,
    models,
    integrations,
    policies,
    workflows,
    customs,
    artifacts,
    ownership,
    verification: draft.verification,
    guarantee_coverage,
    source_locations,
  };

  const canonical_hash = computeCanonicalHash(body);

  return { ...body, canonical_hash } as CanonicalIR;
}

export function computeCanonicalHash(body: CanonicalHashBody): string {
  const hashableBody = stripNonHashable(body);
  return hashCanonical(canonicalStringify(hashableBody));
}

// -------------------------------------------------------------------------
// Per-entity canonicalisation
// -------------------------------------------------------------------------

function canonicalModel(model: ModelIR): ModelIR {
  return {
    ...model,
    fields: sortBy([...model.fields], (f) => f.id).map(canonicalField),
    indexes: sortBy([...model.indexes], (i) => i.id).map(canonicalIndex),
  };
}

function canonicalField(field: FieldIR): FieldIR {
  // Field types have already been alias-normalised at draft time
  // (`datetime` → `timestamp`); keep the structural shape intact.
  return field;
}

function canonicalIndex(index: ModelIndexIR): ModelIndexIR {
  return { ...index, fields: [...index.fields].slice() };
}

function canonicalIntegration(int: IntegrationIR): IntegrationIR {
  return int;
}

function canonicalPolicy(policy: PolicyIR): PolicyIR {
  return policy;
}

function canonicalCustom(custom: CustomExtensionIR): CustomExtensionIR {
  return custom;
}

function canonicalWorkflow(wf: WorkflowIR): WorkflowIR {
  return {
    ...wf,
    // Preserve workflow step order — it is semantic.
    steps: [...wf.steps].sort((a, b) => a.order - b.order).map(canonicalStep),
    // Guarantees are an unordered collection — sort by id.
    guarantees: sortBy([...wf.guarantees], (g) => g.id).map(canonicalGuarantee),
  };
}

function canonicalStep(step: WorkflowStepIR): WorkflowStepIR {
  return step;
}

function canonicalGuarantee(g: GuaranteeIR): GuaranteeIR {
  return g;
}

function canonicalCoverage(c: GuaranteeCoverageIR): GuaranteeCoverageIR {
  return {
    ...c,
    artifact_ids: [...c.artifact_ids].sort(),
  };
}

function canonicalOwnership(o: OwnershipIR): OwnershipIR {
  return o;
}

// -------------------------------------------------------------------------
// Artifact + fragment hashing
// -------------------------------------------------------------------------

interface EntityMap {
  readonly byId: ReadonlyMap<string, unknown>;
}

function buildEntityMap(
  models: readonly ModelIR[],
  workflows: readonly WorkflowIR[],
  integrations: readonly IntegrationIR[],
  policies: readonly PolicyIR[],
  customs: readonly CustomExtensionIR[],
): EntityMap {
  const byId = new Map<string, unknown>();
  for (const m of models) {
    byId.set(m.id, stripSourceDeep(m));
    for (const f of m.fields) byId.set(f.id, stripSourceDeep(f));
    for (const i of m.indexes) byId.set(i.id, stripSourceDeep(i));
  }
  for (const wf of workflows) {
    byId.set(wf.id, stripSourceDeep(wf));
    for (const s of wf.steps) byId.set(s.id, stripSourceDeep(s));
    for (const g of wf.guarantees) byId.set(g.id, stripSourceDeep(g));
  }
  for (const i of integrations) byId.set(i.id, stripSourceDeep(i));
  for (const p of policies) byId.set(p.id, stripSourceDeep(p));
  for (const c of customs) byId.set(c.id, stripSourceDeep(c));
  return { byId };
}

function finalizeArtifact(artifact: ArtifactIR, entities: EntityMap): ArtifactIR {
  // Entity IDs on an artifact carry no semantic order (they identify the
  // set of entities the artifact projects), so we sort them before
  // hashing. Workflow step order, when relevant, is already encoded by
  // each step's `order` index inside its entity body.
  const sortedIds = [...artifact.entity_ids].sort();
  const fragmentEntries = sortedIds
    .map((id) => entities.byId.get(id))
    .filter((e): e is unknown => e !== undefined);
  const fragmentBody = {
    artifact_id: artifact.artifact_id,
    path: artifact.path,
    entity_ids: sortedIds,
    entities: fragmentEntries,
    generation_mode: artifact.generation.mode,
    generator_id: artifact.generation.generator_id,
    template_id: artifact.generation.template_id ?? null,
  };
  const ir_fragment_hash = hashFragment(canonicalStringify(fragmentBody));
  const generation = {
    mode: artifact.generation.mode,
    generator_id: artifact.generation.generator_id,
    ir_fragment_hash,
    ...(artifact.generation.template_id !== undefined
      ? { template_id: artifact.generation.template_id }
      : {}),
  };
  return {
    ...artifact,
    entity_ids: sortedIds,
    generation,
  };
}

// -------------------------------------------------------------------------
// Hashable view: strip non-semantic fields
// -------------------------------------------------------------------------

function stripNonHashable(body: CanonicalHashBody): unknown {
  return {
    schema_version: body.schema_version,
    target: body.target,
    models: body.models.map(stripSourceDeep),
    integrations: body.integrations.map(stripSourceDeep),
    policies: body.policies.map(stripSourceDeep),
    workflows: body.workflows.map(stripSourceDeep),
    customs: body.customs.map(stripSourceDeep),
    artifacts: body.artifacts.map(stripSourceDeep),
    ownership: body.ownership.map(stripSourceDeep),
    verification: body.verification,
    guarantee_coverage: body.guarantee_coverage.map(stripSourceDeep),
    // source_locations are intentionally excluded from the hash.
  };
}

/** Recursively strip every `source_location_id` field anywhere in the tree. */
function stripSourceDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripSourceDeep);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "source_location_id") continue;
    out[k] = stripSourceDeep(v);
  }
  return out;
}

// -------------------------------------------------------------------------
// Utilities
// -------------------------------------------------------------------------

function sortBy<T>(values: T[], key: (value: T) => string): T[] {
  return values.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}
