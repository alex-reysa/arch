/**
 * Map a `DiffV1` set to the on-disk artifacts that must be regenerated or
 * patched.
 *
 * For V1 the artifact path scheme is the canonical one declared by
 * `SYNC_ENGINE_SPEC.md` §23.2 / §3:
 *
 *   package.json
 *   tsconfig.json
 *   vitest.config.ts
 *   docker-compose.yml
 *   prisma/schema.prisma
 *   prisma/migrations/<migration-id>/migration.sql
 *   src/app.ts
 *   src/server.ts
 *   src/runtime/{auth,cache,config,db}.ts
 *   src/models/<Model>.ts
 *   src/validators/<Model>.ts
 *   src/routes/<Workflow>.ts
 *   src/workflows/<Workflow>.ts
 *   tests/models/<Model>.test.ts
 *   tests/workflows/<Workflow>.test.ts
 *   tests/guarantees/<guarantee>.<Workflow>.test.ts
 *   .arch/artifact-map.json
 *   .arch/ownership.json
 *
 * Resolution is deterministic: same diff envelope → byte-identical
 * affected-artifact list, in stable lexicographic order. The metadata
 * artifacts (`.arch/artifact-map.json`, `.arch/ownership.json`) are *always*
 * included because every applied plan rewrites them.
 */

import type {
  CanonicalIR,
  CustomExtensionIR,
  IntegrationIR,
  ModelIR,
  PolicyIR,
  WorkflowIR,
} from "@arch/ir";
import type { DiffV1 } from "../diff/diff-schema.js";
import { buildGraph } from "./graph-builder.js";
import { closure, type DependencyGraph } from "./dependency-graph.js";

// -------------------------------------------------------------------------
// Public types.
// -------------------------------------------------------------------------

export type AffectedArtifactKind =
  | "package_json"
  | "tsconfig"
  | "vitest_config"
  | "docker_compose"
  | "prisma_schema"
  | "prisma_migration"
  | "runtime_config"
  | "model"
  | "validator"
  | "route"
  | "workflow"
  | "app"
  | "server"
  | "model_test"
  | "workflow_test"
  | "guarantee_test"
  | "integration_stub"
  | "custom_extension_stub"
  | "custom_readme"
  | "policy"
  | "runtime_db"
  | "runtime_cache"
  | "runtime_auth"
  | "artifact_map"
  | "ownership";

export interface AffectedArtifact {
  readonly artifact_id: string;
  readonly path: string;
  readonly kind: AffectedArtifactKind;
  readonly entity_ids: readonly string[];
  readonly diff_ids: readonly string[];
  readonly impact: "create" | "update" | "delete" | "rewrite";
}

export interface AffectedArtifacts {
  readonly artifacts: readonly AffectedArtifact[];
  /** Convenience accessor: project-relative artifact paths in stable order. */
  readonly artifactIds: readonly string[];
}

export interface ResolveOptions {
  readonly migrationId?: string;
}

// -------------------------------------------------------------------------
// Naming helpers (generator path scheme).
// -------------------------------------------------------------------------

function pascal(name: string): string {
  return name.replace(/(^\w|[_-]\w)/g, (m) => m.replace(/[_-]/, "").toUpperCase());
}

function camel(name: string): string {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function modelPath(m: ModelIR): string {
  return `src/models/${pascal(m.name)}.ts`;
}
function validatorPath(m: ModelIR): string {
  return `src/validators/${pascal(m.name)}.ts`;
}
function modelTestPath(m: ModelIR): string {
  return `tests/models/${pascal(m.name)}.test.ts`;
}
function workflowPath(w: WorkflowIR): string {
  return `src/workflows/${pascal(w.name)}.ts`;
}
function workflowTestPath(w: WorkflowIR): string {
  return `tests/workflows/${pascal(w.name)}.test.ts`;
}
function routePathFor(w: WorkflowIR): string {
  return `src/routes/${pascal(w.name)}.ts`;
}
function guaranteeTestPath(w: WorkflowIR, guaranteeName: string): string {
  return `tests/guarantees/${guaranteeName}.${pascal(w.name)}.test.ts`;
}
function runtimeDbPath(): string {
  return "src/runtime/db.ts";
}
function policyPath(p: PolicyIR): string {
  return `src/policies/${camel(p.name)}.ts`;
}
function integrationStubPath(i: IntegrationIR): string {
  return `src/integrations/${pascal(i.name)}.ts`;
}
function customStubPath(c: CustomExtensionIR): string {
  return `src/custom/${pascal(c.name)}.ts`;
}

const ARTIFACT_MAP_PATH = ".arch/artifact-map.json";
const OWNERSHIP_PATH = ".arch/ownership.json";

// -------------------------------------------------------------------------
// Resolver.
// -------------------------------------------------------------------------

export function resolveAffectedArtifacts(
  ir: CanonicalIR,
  diffs: readonly DiffV1[],
  options: ResolveOptions = {},
): AffectedArtifacts {
  const graph = buildGraph(ir);
  const seen = new Map<string, AffectedArtifact>();

  const upsert = (a: AffectedArtifact): void => {
    const prior = seen.get(a.path);
    if (!prior) {
      seen.set(a.path, a);
      return;
    }
    seen.set(a.path, {
      ...prior,
      entity_ids: dedupe([...prior.entity_ids, ...a.entity_ids]),
      diff_ids: dedupe([...prior.diff_ids, ...a.diff_ids]),
    });
  };

  const modelsById = new Map(ir.models.map((m) => [m.id, m]));
  const workflowsById = new Map(ir.workflows.map((w) => [w.id, w]));

  for (const diff of diffs) {
    const entryEntityIds = closureFor(graph, diff.entity_ids);
    const affectedModelIds = filterIds(entryEntityIds, modelsById);
    const affectedWorkflowIds = filterIds(entryEntityIds, workflowsById);

    addArtifactsForDiff(
      diff,
      ir,
      modelsById,
      workflowsById,
      affectedModelIds,
      affectedWorkflowIds,
      upsert,
      options,
    );
  }

  // Always rewrite the metadata files so apply preserves bookkeeping
  // invariants.
  upsert({
    artifact_id: "metadata.artifact-map",
    path: ARTIFACT_MAP_PATH,
    kind: "artifact_map",
    entity_ids: [],
    diff_ids: diffs.map((d) => d.diff_id),
    impact: "rewrite",
  });
  upsert({
    artifact_id: "metadata.ownership",
    path: OWNERSHIP_PATH,
    kind: "ownership",
    entity_ids: [],
    diff_ids: diffs.map((d) => d.diff_id),
    impact: "rewrite",
  });

  const artifacts = [...seen.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return { artifacts, artifactIds: artifacts.map((a) => a.path) };
}

// -------------------------------------------------------------------------
// Per-diff dispatch.
// -------------------------------------------------------------------------

function addArtifactsForDiff(
  diff: DiffV1,
  ir: CanonicalIR,
  modelsById: Map<string, ModelIR>,
  workflowsById: Map<string, WorkflowIR>,
  affectedModelIds: readonly string[],
  affectedWorkflowIds: readonly string[],
  upsert: (a: AffectedArtifact) => void,
  options: ResolveOptions,
): void {
  const diff_id = diff.diff_id;
  const migrationName = options.migrationId ?? defaultMigrationId(diff);
  const recordGenerated = (
    artifact_id: string,
    path: string,
    kind: AffectedArtifactKind,
    entityIds: readonly string[] = [],
    impact: AffectedArtifact["impact"] = "rewrite",
  ) =>
    upsert({
      artifact_id,
      path,
      kind,
      entity_ids: entityIds,
      diff_ids: [diff_id],
      impact,
    });

  const recordPackageJson = () =>
    recordGenerated("tmpl.package-json", "package.json", "package_json");
  const recordTsconfig = () =>
    recordGenerated("tmpl.tsconfig", "tsconfig.json", "tsconfig");
  const recordVitestConfig = () =>
    recordGenerated("tmpl.vitest-config", "vitest.config.ts", "vitest_config");
  const recordDockerCompose = () =>
    recordGenerated("tmpl.docker-compose", "docker-compose.yml", "docker_compose");
  const recordPrismaSchema = (entityIds: readonly string[]) =>
    upsert({
      artifact_id: "tmpl.prisma-schema",
      path: "prisma/schema.prisma",
      kind: "prisma_schema",
      entity_ids: entityIds,
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordPrismaMigration = (entityIds: readonly string[]) =>
    upsert({
      artifact_id: `tmpl.prisma-migration.${migrationName}`,
      path: `prisma/migrations/${migrationName}/migration.sql`,
      kind: "prisma_migration",
      entity_ids: entityIds,
      diff_ids: [diff_id],
      impact: "create",
    });
  const recordRuntimeConfig = () =>
    recordGenerated("tmpl.runtime-config", "src/runtime/config.ts", "runtime_config");
  const recordRuntimeDb = (entityIds: readonly string[]) =>
    upsert({
      artifact_id: "tmpl.runtime-db",
      path: runtimeDbPath(),
      kind: "runtime_db",
      entity_ids: entityIds,
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordRuntimeCache = () =>
    recordGenerated("tmpl.runtime-cache", "src/runtime/cache.ts", "runtime_cache");
  const recordRuntimeAuth = () =>
    recordGenerated("tmpl.runtime-auth", "src/runtime/auth.ts", "runtime_auth");
  const recordApp = () =>
    recordGenerated(
      "tmpl.fastify-app",
      "src/app.ts",
      "app",
      ir.workflows.map((w) => w.id),
    );
  const recordServer = () =>
    recordGenerated("tmpl.fastify-server", "src/server.ts", "server");
  const recordModel = (m: ModelIR) =>
    upsert({
      artifact_id: `tmpl.model.${m.name}`,
      path: modelPath(m),
      kind: "model",
      entity_ids: [m.id],
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordValidator = (m: ModelIR) =>
    upsert({
      artifact_id: `tmpl.validator.${m.name}`,
      path: validatorPath(m),
      kind: "validator",
      entity_ids: [m.id],
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordModelTest = (m: ModelIR) =>
    upsert({
      artifact_id: `tmpl.model-test.${m.name}`,
      path: modelTestPath(m),
      kind: "model_test",
      entity_ids: [m.id],
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordWorkflow = (w: WorkflowIR) =>
    upsert({
      artifact_id: `tmpl.workflow.${w.name}`,
      path: workflowPath(w),
      kind: "workflow",
      entity_ids: [w.id, ...w.steps.map((s) => s.id), ...w.guarantees.map((g) => g.id)],
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordWorkflowTest = (w: WorkflowIR) =>
    upsert({
      artifact_id: `tmpl.workflow-test.${w.name}`,
      path: workflowTestPath(w),
      kind: "workflow_test",
      entity_ids: [w.id, ...w.steps.map((s) => s.id), ...w.guarantees.map((g) => g.id)],
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordRoute = (w: WorkflowIR) =>
    upsert({
      artifact_id: `tmpl.route.${w.name}`,
      path: routePathFor(w),
      kind: "route",
      entity_ids: [w.id],
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordGuaranteeTest = (w: WorkflowIR, guaranteeName: string) =>
    upsert({
      artifact_id: `tmpl.guarantee-test.${w.name}.${guaranteeTestPath(w, guaranteeName)}`,
      path: guaranteeTestPath(w, guaranteeName),
      kind: "guarantee_test",
      entity_ids: [w.id, ...w.steps.map((s) => s.id), ...w.guarantees.map((g) => g.id)],
      diff_ids: [diff_id],
      impact: "rewrite",
    });
  const recordPolicy = (p: PolicyIR) =>
    recordGenerated(`tmpl.policy.${p.name}`, policyPath(p), "policy", [p.id]);
  const recordIntegrationStub = (i: IntegrationIR) =>
    recordGenerated(
      `tmpl.integration-stub.${i.name}`,
      integrationStubPath(i),
      "integration_stub",
      [i.id],
      "create",
    );
  const recordCustomStub = (c: CustomExtensionIR) =>
    recordGenerated(
      `tmpl.custom-stub.${c.name}`,
      customStubPath(c),
      "custom_extension_stub",
      [c.id],
      "create",
    );
  const recordCustomReadme = () =>
    recordGenerated(
      "tmpl.custom-readme",
      "src/custom/README.md",
      "custom_readme",
      [],
      "create",
    );

  const recordWorkflowBundle = (w: WorkflowIR) => {
    recordWorkflow(w);
    recordRoute(w);
    recordWorkflowTest(w);
    for (const g of w.guarantees) recordGuaranteeTest(w, g.name);
  };

  switch (diff.type) {
    case "initial_generation": {
      recordPackageJson();
      recordTsconfig();
      recordVitestConfig();
      recordDockerCompose();
      recordPrismaSchema(ir.models.map((m) => m.id));
      recordRuntimeConfig();
      recordRuntimeDb(ir.models.map((m) => m.id));
      recordRuntimeCache();
      recordRuntimeAuth();
      recordApp();
      recordServer();
      for (const m of ir.models) {
        recordModel(m);
        recordValidator(m);
        recordModelTest(m);
      }
      for (const w of ir.workflows) recordWorkflowBundle(w);
      for (const p of ir.policies) recordPolicy(p);
      for (const i of ir.integrations) recordIntegrationStub(i);
      for (const c of ir.customs) recordCustomStub(c);
      recordCustomReadme();
      return;
    }
    case "model_added": {
      const m = modelsById.get(diff.model_id);
      if (!m) return;
      recordPrismaSchema([m.id]);
      recordPrismaMigration([m.id]);
      recordRuntimeDb([m.id]);
      recordModel(m);
      recordValidator(m);
      recordModelTest(m);
      // Workflows that touch the model.
      for (const w of relatedWorkflowsForModel(ir, m.id)) {
        recordWorkflowBundle(w);
      }
      return;
    }
    case "model_removed": {
      // Removed model is no longer in `ir`, so we cannot resolve its
      // artifact paths from the current IR. The plan emits delete actions
      // separately; here we still rewrite the schema so the SQL migration
      // drops the table.
      recordPrismaSchema([diff.model_id]);
      recordPrismaMigration([diff.model_id]);
      recordRuntimeDb([diff.model_id]);
      return;
    }
    case "model_field_added":
    case "model_field_removed":
    case "model_field_type_changed":
    case "model_field_constraint_changed":
    case "relation_added":
    case "relation_removed":
    case "relation_changed":
    case "model_index_added":
    case "model_index_removed":
    case "model_index_changed": {
      const modelIds = modelIdsForSchemaDiff(diff, ir, affectedModelIds);
      if (modelIds.length === 0) return;
      recordPrismaSchema(modelIds);
      recordPrismaMigration(modelIds);
      recordRuntimeDb(modelIds);
      for (const id of modelIds) {
        const m = modelsById.get(id);
        if (!m) continue;
        recordModel(m);
        recordValidator(m);
        recordModelTest(m);
      }
      for (const w of dependentWorkflowsForModels(
        ir,
        workflowsById,
        modelIds,
        affectedWorkflowIds,
      )) {
        recordWorkflowBundle(w);
      }
      return;
    }
    case "workflow_added":
    case "workflow_removed":
    case "workflow_step_added":
    case "workflow_step_removed":
    case "workflow_step_reordered":
    case "workflow_step_changed": {
      const w = workflowsById.get(diff.workflow_id);
      if (!w) return;
      recordWorkflowBundle(w);
      // Workflow step changes typically touch a model.
      for (const id of affectedModelIds) {
        const m = modelsById.get(id);
        if (m) recordModel(m);
      }
      return;
    }
    case "guarantee_added":
    case "guarantee_changed":
    case "guarantee_removed": {
      const w = workflowsById.get(diff.workflow_id);
      if (!w) return;
      recordWorkflow(w);
      recordWorkflowTest(w);
      // Find the guarantee node by id; emit its specific guarantee test.
      const g = w.guarantees.find((gg) => gg.id === diff.guarantee_id);
      if (g) recordGuaranteeTest(w, g.name);
      return;
    }
    case "integration_added":
    case "integration_removed":
    case "integration_changed": {
      if (diff.type === "integration_added") {
        const i = ir.integrations.find((candidate) => candidate.id === diff.integration_id);
        if (i) recordIntegrationStub(i);
      }
      // Integration is consumed by workflows that reference it.
      for (const id of affectedWorkflowIds) {
        const w = workflowsById.get(id);
        if (w) {
          recordWorkflow(w);
          recordWorkflowTest(w);
        }
      }
      return;
    }
    case "policy_added":
    case "policy_removed":
    case "policy_changed": {
      const p = ir.policies.find((candidate) => candidate.id === diff.policy_id);
      if (p) recordPolicy(p);
      for (const id of affectedWorkflowIds) {
        const w = workflowsById.get(id);
        if (w) {
          recordWorkflow(w);
          recordWorkflowTest(w);
        }
      }
      return;
    }
    case "custom_extension_added":
    case "custom_extension_removed":
    case "custom_extension_changed": {
      if (diff.type === "custom_extension_added") {
        const c = ir.customs.find((candidate) => candidate.id === diff.custom_id);
        if (c) recordCustomStub(c);
      }
      for (const id of affectedWorkflowIds) {
        const w = workflowsById.get(id);
        if (w) recordWorkflow(w);
      }
      return;
    }
    case "test_added":
    case "test_removed":
    case "test_changed":
      // V1: tests are emitted as part of the model/workflow/guarantee
      // bundles; explicit test diffs become a no-op here.
      return;
    case "target_changed":
      // Cache change rewrites runtime config + workflows that consume it.
      recordRuntimeConfig();
      recordRuntimeCache();
      for (const w of ir.workflows) recordWorkflow(w);
      return;
  }
}

// -------------------------------------------------------------------------
// Helpers.
// -------------------------------------------------------------------------

function dedupe<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function closureFor(graph: DependencyGraph, seeds: readonly string[]): readonly string[] {
  const set = closure(graph, seeds);
  return [...set].sort();
}

function filterIds<T>(ids: readonly string[], byId: Map<string, T>): string[] {
  return ids.filter((id) => byId.has(id));
}

function relatedWorkflowsForModel(ir: CanonicalIR, modelId: string): WorkflowIR[] {
  const out: WorkflowIR[] = [];
  for (const w of ir.workflows) {
    let touches = false;
    for (const s of w.steps) {
      const op = s.operation;
      if (
        (op.kind === "insert" || op.kind === "update" || op.kind === "delete") &&
        op.model_id === modelId
      ) {
        touches = true;
        break;
      }
    }
    if (touches) out.push(w);
  }
  return out;
}

function dependentWorkflowsForModels(
  ir: CanonicalIR,
  workflowsById: Map<string, WorkflowIR>,
  modelIds: readonly string[],
  affectedWorkflowIds: readonly string[],
): WorkflowIR[] {
  const out = new Map<string, WorkflowIR>();
  for (const id of affectedWorkflowIds) {
    const w = workflowsById.get(id);
    if (w) out.set(w.id, w);
  }
  for (const modelId of modelIds) {
    for (const w of relatedWorkflowsForModel(ir, modelId)) {
      out.set(w.id, w);
    }
  }
  return [...out.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

function modelIdsForSchemaDiff(
  diff: DiffV1,
  ir: CanonicalIR,
  affectedModelIds: readonly string[],
): string[] {
  const ids: string[] = [];
  if ("model_id" in diff) ids.push(diff.model_id);
  ids.push(...affectedModelIds);
  const relationModelId = extractModelIdFromRelation(ir, diff.entity_ids);
  if (relationModelId) ids.push(relationModelId);
  return dedupe(ids).sort();
}

function extractModelIdFromRelation(
  ir: CanonicalIR,
  entityIds: readonly string[],
): string | undefined {
  for (const m of ir.models) {
    for (const f of m.fields) {
      if (f.relation && entityIds.includes(f.relation.id)) return m.id;
    }
  }
  return undefined;
}

function defaultMigrationId(diff: DiffV1): string {
  return `add_${normalizeSlug(diff.diff_id)}`;
}

function normalizeSlug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
}
