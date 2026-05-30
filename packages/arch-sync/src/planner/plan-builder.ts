/**
 * Build a `SyncPlanV1` from a diff envelope and the previous/current IR.
 *
 * The plan is *read-only*: it never writes files. It records:
 *   - the diff envelope it was built from
 *   - one `SyncPlanActionV1` per affected artifact, carrying the
 *     `ArtifactGenerationIR` snapshot and the `OwnershipIR` write-scope
 *     decision authoritative for that artifact
 *   - action groups for human-friendly summaries
 *   - an allowlist (`path_policy`) that the patcher enforces
 *   - a deterministic, content-addressed `plan_id` and `plan_hash`
 *
 * Determinism: identical (previous, current, diff) → byte-identical plan.
 */

import type {
  ArtifactGenerationIR,
  CanonicalIR,
  OwnershipIR,
} from "@arch/ir";
import { createHash } from "node:crypto";

import type { DiffV1, DiffV1Envelope, IRDiff } from "../diff/diff-schema.js";
import type {
  SyncPlan,
  SyncPlanV1,
  SyncPlanActionV1,
  SyncPlanActionGroupV1,
  SyncPlanActionGroupKind,
  SyncPlanActionKind,
  SyncPlanOwnershipDecision,
  SyncPlanVerificationObligationV1,
} from "./plan-schema.js";
import {
  resolveAffectedArtifacts,
  type AffectedArtifact,
  type AffectedArtifactKind,
} from "../graph/artifact-resolution.js";
import { canonicalStringify } from "../diff/comparators.js";
import { aggregateChangeClass, maxSeverity } from "../diff/classification.js";

// -------------------------------------------------------------------------
// Public API.
// -------------------------------------------------------------------------

export interface BuildPlanV1Input {
  readonly previous: CanonicalIR | null;
  readonly current: CanonicalIR;
  readonly diff: DiffV1Envelope;
}

export function buildPlanV1(input: BuildPlanV1Input): SyncPlanV1 {
  const affected = resolveAffectedArtifacts(input.current, input.diff.diffs);

  // Group actions by artifact kind for the human summary.
  const actions: SyncPlanActionV1[] = [];
  const groupAccumulator = new Map<SyncPlanActionGroupKind, string[]>();

  for (const a of affected.artifacts) {
    const action = artifactToAction(a, input.current);
    actions.push(action);
    const groupKind = artifactKindToGroup(a.kind);
    if (!groupAccumulator.has(groupKind)) groupAccumulator.set(groupKind, []);
    groupAccumulator.get(groupKind)!.push(action.action_id);
  }

  const groupOrder: SyncPlanActionGroupKind[] = [
    "schema",
    "migration",
    "model",
    "validator",
    "route",
    "workflow",
    "model_test",
    "workflow_test",
    "guarantee_test",
    "policy",
    "integration",
    "custom_extension",
    "config",
    "runtime",
    "metadata",
  ];
  const action_groups: SyncPlanActionGroupV1[] = [];
  for (const k of groupOrder) {
    const ids = groupAccumulator.get(k);
    if (!ids || ids.length === 0) continue;
    action_groups.push({
      group_id: `group.${k}`,
      kind: k,
      summary: groupSummary(k, ids.length),
      action_ids: [...ids].sort(),
    });
  }

  const allowed = actions.map((a) => a.path);
  const path_policy = {
    allowed: dedupe(allowed).sort(),
    forbidden: ["node_modules/**", "**/node_modules/**", ".git/**", "**/.git/**"],
  };

  const verification = computeVerification(input.diff.diffs);

  const confirmations_required = input.diff.diffs
    .filter((d) => d.requires_confirmation)
    .map((d) => d.diff_id)
    .sort();

  const destructive = input.diff.diffs.some(
    (d) =>
      d.risk === "destructive" ||
      d.risk === "critical" ||
      d.risk === "structural",
  );

  const created_at = "1970-01-01T00:00:00.000Z";

  // Plan id + hash are content-addressed for determinism.
  const planBody = {
    schema_version: "arch.plan.v1" as const,
    base_ir_hash: input.diff.previous_ir_hash,
    target_ir_hash: input.diff.current_ir_hash,
    diff: input.diff,
    diff_index: input.diff.diffs,
    action_groups,
    actions,
    path_policy,
    verification,
    confirmations_required,
    destructive,
  };
  const plan_hash = sha256(canonicalStringify(planBody));
  const plan_id = `plan.${plan_hash.slice(0, 16)}`;

  return {
    schema_version: "arch.plan.v1",
    plan_id,
    plan_hash,
    base_ir_hash: input.diff.previous_ir_hash,
    target_ir_hash: input.diff.current_ir_hash,
    created_at,
    diff: input.diff,
    diff_index: input.diff.diffs,
    action_groups,
    actions,
    path_policy,
    verification,
    confirmations_required,
    destructive,
  };
}

// -------------------------------------------------------------------------
// Legacy buildPlan shim — emits a narrow `SyncPlan` for callers that have
// not yet migrated to `SyncPlanV1`. The shim relies on `IRDiff` (which
// carries the prototype `IntentChange[]`) and produces an empty plan; new
// call sites must use `buildPlanV1`.
// -------------------------------------------------------------------------

export interface BuildPlanInput {
  readonly previous: CanonicalIR | null;
  readonly current: CanonicalIR;
  readonly diff: IRDiff;
}

export function buildPlan(input: BuildPlanInput): SyncPlan {
  return {
    plan_id: "plan.legacy.unsupported",
    plan_hash: "0".repeat(64),
    previous_ir_hash: input.previous?.canonical_hash ?? null,
    current_ir_hash: input.current.canonical_hash,
    intent_changes: input.diff.changes.map((c) => ({
      kind: c.kind,
      description: c.kind,
    })),
    affected_artifacts: [],
    patches: [],
    verification: [{ kind: "typecheck" }, { kind: "tests" }],
    destructive_changes: [],
    created_at: "1970-01-01T00:00:00.000Z",
  };
}

// -------------------------------------------------------------------------
// Helpers.
// -------------------------------------------------------------------------

function artifactToAction(
  artifact: AffectedArtifact,
  ir: CanonicalIR,
): SyncPlanActionV1 {
  const action_id = `action.${artifact.path}`;
  const kind: SyncPlanActionKind = artifactImpactToActionKind(artifact);
  const generation = lookupGeneration(artifact, ir);
  const ownership = lookupOwnership(artifact, ir);
  return {
    action_id,
    kind,
    artifact_id: artifact.artifact_id,
    path: artifact.path,
    entity_ids: artifact.entity_ids,
    diff_ids: artifact.diff_ids,
    generation,
    ownership,
    destructive: artifact.impact === "delete",
    requires_confirmation: false,
  };
}

function artifactImpactToActionKind(a: AffectedArtifact): SyncPlanActionKind {
  if (a.impact === "delete") return "delete_file";
  if (a.kind === "prisma_migration") return "create_migration";
  if (
    a.kind === "integration_stub" ||
    a.kind === "custom_extension_stub" ||
    a.kind === "custom_readme"
  ) {
    return "write_extension_stub";
  }
  if (a.impact === "create") return "create_file";
  return "rewrite_whole_file";
}

function artifactKindToGroup(k: AffectedArtifactKind): SyncPlanActionGroupKind {
  switch (k) {
    case "package_json":
    case "tsconfig":
    case "vitest_config":
    case "docker_compose":
      return "config";
    case "prisma_schema":
      return "schema";
    case "prisma_migration":
      return "migration";
    case "model":
      return "model";
    case "validator":
      return "validator";
    case "route":
      return "route";
    case "workflow":
      return "workflow";
    case "app":
    case "server":
      return "runtime";
    case "model_test":
      return "model_test";
    case "workflow_test":
      return "workflow_test";
    case "guarantee_test":
      return "guarantee_test";
    case "integration_stub":
      return "integration";
    case "custom_extension_stub":
    case "custom_readme":
      return "custom_extension";
    case "policy":
      return "policy";
    case "runtime_db":
    case "runtime_config":
    case "runtime_cache":
    case "runtime_auth":
      return "runtime";
    case "artifact_map":
    case "ownership":
      return "metadata";
  }
}

function groupSummary(k: SyncPlanActionGroupKind, count: number): string {
  const noun: Record<SyncPlanActionGroupKind, string> = {
    schema: "schema file",
    migration: "migration",
    model: "model",
    validator: "validator",
    route: "route",
    workflow: "workflow",
    integration: "integration stub",
    policy: "policy",
    guarantee_test: "guarantee test",
    model_test: "model test",
    workflow_test: "workflow test",
    custom_extension: "custom extension stub",
    config: "config",
    runtime: "runtime artifact",
    metadata: "metadata file",
  };
  const tail = count === 1 ? noun[k] : `${noun[k]}s`;
  return `${count} ${tail}`;
}

function lookupGeneration(
  artifact: AffectedArtifact,
  ir: CanonicalIR,
): ArtifactGenerationIR {
  const fromIr = ir.artifacts.find((a) => a.artifact_id === artifact.artifact_id);
  if (fromIr) return fromIr.generation;
  // Synthesize a deterministic ArtifactGenerationIR for artifacts that the
  // current IR does not yet enumerate (e.g. metadata files, prisma
  // migrations).
  return {
    mode: artifact.kind === "prisma_migration" ? "full_file" : "full_file",
    generator_id: "arch.generator.v1",
    template_id: artifactTemplateId(artifact),
    ir_fragment_hash: deriveFragmentHash(artifact),
  };
}

function artifactTemplateId(artifact: AffectedArtifact): string {
  switch (artifact.kind) {
    case "package_json":
      return "ts.package-json";
    case "tsconfig":
      return "ts.tsconfig";
    case "vitest_config":
      return "ts.vitest-config";
    case "docker_compose":
      return "ts.docker-compose";
    case "prisma_schema":
      return "ts.prisma-schema";
    case "prisma_migration":
      return "ts.prisma-migration";
    case "runtime_config":
      return "ts.runtime-config";
    case "model":
      return "ts.model";
    case "validator":
      return "ts.validator";
    case "route":
      return "ts.route";
    case "workflow":
      return "ts.workflow";
    case "app":
      return "ts.fastify-app";
    case "server":
      return "ts.fastify-server";
    case "model_test":
      return "ts.model-test";
    case "workflow_test":
      return "ts.workflow-test";
    case "guarantee_test":
      return "ts.guarantee-test";
    case "integration_stub":
      return "ts.integration-stub";
    case "custom_extension_stub":
      return "ts.custom-stub";
    case "custom_readme":
      return "md.custom-readme";
    case "policy":
      return "ts.policy";
    case "runtime_db":
      return "ts.runtime-db";
    case "runtime_cache":
      return "ts.runtime-cache";
    case "runtime_auth":
      return "ts.runtime-auth";
    case "artifact_map":
      return "json.artifact-map";
    case "ownership":
      return "json.ownership";
  }
}

function deriveFragmentHash(artifact: AffectedArtifact): string {
  return sha256(
    canonicalStringify({
      path: artifact.path,
      kind: artifact.kind,
      entity_ids: [...artifact.entity_ids].sort(),
    }),
  );
}

function lookupOwnership(
  artifact: AffectedArtifact,
  ir: CanonicalIR,
): SyncPlanOwnershipDecision {
  const irOwnership = ir.ownership.find(
    (o: OwnershipIR) => o.artifact_id === artifact.artifact_id,
  );
  if (irOwnership) {
    return {
      ownership_id: irOwnership.ownership_id,
      ownership_kind: irOwnership.ownership_kind,
      write_scope: irOwnership.write_scope,
      owner: irOwnership.owner,
    };
  }
  if (
    artifact.kind === "integration_stub" ||
    artifact.kind === "custom_extension_stub" ||
    artifact.kind === "custom_readme"
  ) {
    return {
      ownership_id: `own.${artifact.artifact_id}`,
      ownership_kind: "extension_point",
      write_scope: "stub_only",
      owner: "arch",
    };
  }
  // Default: generated whole-file, owned by arch. Metadata artifacts are
  // also generated_file.
  return {
    ownership_id: `own.${artifact.artifact_id}`,
    ownership_kind: "generated_file",
    write_scope: "whole_file",
    owner: "arch",
  };
}

function computeVerification(
  diffs: readonly DiffV1[],
): SyncPlanVerificationObligationV1[] {
  const out: SyncPlanVerificationObligationV1[] = [
    { kind: "typecheck" },
    { kind: "tests" },
  ];
  if (
    diffs.some(
      (d) =>
        d.type.startsWith("model_") ||
        d.type === "relation_added" ||
        d.type === "relation_removed" ||
        d.type === "relation_changed",
    )
  ) {
    out.push({ kind: "migrations" }, { kind: "prisma_validate" });
  }
  for (const d of diffs) {
    if (d.type === "guarantee_added" || d.type === "guarantee_changed") {
      out.push({ kind: "guarantee_test", target: d.guarantee_id });
    }
  }
  out.push({ kind: "drift_check" });
  return out;
}

export function aggregatePlanRisk(plan: SyncPlanV1) {
  return {
    change_class: aggregateChangeClass(plan.diff.diffs),
    severity: maxSeverity(plan.diff.diffs),
  };
}

function dedupe<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
