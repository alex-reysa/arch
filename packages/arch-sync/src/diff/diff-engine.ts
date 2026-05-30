/**
 * Top-level diff engine: walk both IRs, emit a deterministic V1 diff
 * envelope, and surface unsupported-change diagnostics. The legacy
 * `diffIR` returning `IRDiff` is kept as a thin shim so existing callers
 * that were authored against the prototype union continue to compile.
 */

import type { CanonicalIR } from "@arch/ir";
import type { DiffV1Envelope, IntentChange, IRDiff } from "./diff-schema.js";
import { compareIR, type UnsupportedDiagnostic } from "./comparators.js";

export interface DiffV1Result {
  readonly envelope: DiffV1Envelope;
  readonly diagnostics: readonly UnsupportedDiagnostic[];
}

/**
 * Compute the V1 diff envelope between two canonical IRs.
 *
 * `previous === null` is the **initial generation** path; the engine emits
 * a single synthetic `initial_generation` diff so plan IDs / paths still
 * resolve uniformly.
 */
export function diffIRV1(
  previous: CanonicalIR | null,
  current: CanonicalIR,
): DiffV1Result {
  if (previous === null) {
    return {
      envelope: {
        schema_version: "arch.diff.v1",
        previous_ir_hash: null,
        current_ir_hash: current.canonical_hash,
        diffs: [
          {
            type: "initial_generation",
            diff_id: "diff.initial_generation._root",
            entity_ids: [],
            risk: "additive",
            requires_confirmation: false,
            confirmation_kinds: [],
            affected_entity_hints: [],
            reason: "Initial generation: emit every artifact for the IR.",
          },
        ],
        initial_generation: true,
      },
      diagnostics: [],
    };
  }

  const { diffs, diagnostics } = compareIR(previous, current);
  return {
    envelope: {
      schema_version: "arch.diff.v1",
      previous_ir_hash: previous.canonical_hash,
      current_ir_hash: current.canonical_hash,
      diffs,
      initial_generation: false,
    },
    diagnostics,
  };
}

/**
 * Legacy entry point: returns the narrow `IntentChange` form. The V1
 * envelope is the source of truth — we map known `DiffV1` types into the
 * legacy union for the few call sites that still consume it.
 */
export function diffIR(previous: CanonicalIR | null, current: CanonicalIR): IRDiff {
  const { envelope } = diffIRV1(previous, current);
  const changes: IntentChange[] = [];
  for (const d of envelope.diffs) {
    const m = mapToIntentChange(d);
    if (m) changes.push(m);
  }
  return {
    previous_hash: previous?.canonical_hash ?? null,
    current_hash: current.canonical_hash,
    changes,
  };
}

function mapToIntentChange(d: DiffV1Envelope["diffs"][number]): IntentChange | null {
  switch (d.type) {
    case "model_added":
      return { kind: "model_added", modelId: d.model_id, modelName: d.model_id };
    case "model_removed":
      return { kind: "model_removed", modelId: d.model_id, modelName: d.model_id };
    case "model_field_added":
      return {
        kind: "model_field_added",
        modelId: d.model_id,
        fieldId: d.field_id,
        fieldName: d.field_id,
      };
    case "model_field_removed":
      return {
        kind: "model_field_removed",
        modelId: d.model_id,
        fieldId: d.field_id,
        fieldName: d.field_id,
      };
    case "model_field_type_changed":
      return { kind: "model_field_type_changed", modelId: d.model_id, fieldId: d.field_id };
    case "workflow_step_added":
      return { kind: "workflow_step_added", workflowId: d.workflow_id, stepId: d.step_id };
    case "workflow_step_removed":
      return { kind: "workflow_step_removed", workflowId: d.workflow_id, stepId: d.step_id };
    case "workflow_step_reordered":
      return { kind: "workflow_step_reordered", workflowId: d.workflow_id };
    case "guarantee_added":
      return {
        kind: "guarantee_added",
        workflowId: d.workflow_id,
        guaranteeId: d.guarantee_id,
      };
    case "guarantee_removed":
      return {
        kind: "guarantee_removed",
        workflowId: d.workflow_id,
        guaranteeId: d.guarantee_id,
      };
    case "integration_added":
      return { kind: "integration_added", integrationId: d.integration_id };
    case "integration_removed":
      return { kind: "integration_removed", integrationId: d.integration_id };
    case "policy_changed":
      return { kind: "policy_changed", policyId: d.policy_id };
    case "target_changed":
      return { kind: "target_changed", before: d.before, after: d.after };
    default:
      return null;
  }
}
