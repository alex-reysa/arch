/**
 * Risk and severity classification for diffs.
 *
 * Two distinct dimensions per `SYNC_ENGINE_SPEC.md` §13:
 *
 *   - `change_class` (the existing `DiffRiskClass`) describes the *shape* of
 *     the change — additive, modifying, destructive, structural, or critical.
 *     This is what the diff envelope already tracks per entry.
 *
 *   - `severity` describes the *blast radius* of the change on operations —
 *     low, medium, high, or critical. The same `change_class` can map to
 *     different severities depending on context (e.g. an `additive`
 *     `model_field_added` is `low` if the field is optional, `medium` if
 *     required with a default, and `high` if required without a default).
 *
 * The legacy `classify(IntentChange)` shim is preserved so old call sites
 * compile while the rest of the system migrates to `DiffV1`.
 */

import type { IntentChange, DiffV1, DiffRiskClass } from "./diff-schema.js";

export type ChangeRiskClass = "additive" | "mutating" | "destructive" | "structural";

export type DiffSeverity = "low" | "medium" | "high" | "critical";

// -------------------------------------------------------------------------
// Legacy IntentChange classifier — preserved for the migration window.
// -------------------------------------------------------------------------

export function classify(change: IntentChange): ChangeRiskClass {
  switch (change.kind) {
    case "model_added":
    case "model_field_added":
    case "guarantee_added":
    case "integration_added":
    case "workflow_step_added":
      return "additive";
    case "model_field_type_changed":
    case "policy_changed":
    case "workflow_step_reordered":
      return "mutating";
    case "model_removed":
    case "model_field_removed":
    case "integration_removed":
    case "workflow_step_removed":
    case "guarantee_removed":
      return "destructive";
    case "target_changed":
      return "structural";
  }
}

// -------------------------------------------------------------------------
// V1 classifier.
// -------------------------------------------------------------------------

/** Default change-class for a V1 diff type. The diff envelope's `risk`
 *  is already populated by the comparator, so this exists for symmetry +
 *  re-classification by the planner. */
export function classifyDiffV1(diff: DiffV1): DiffRiskClass {
  return diff.risk;
}

/** Severity bucket for a V1 diff. Mirrors `SYNC_ENGINE_SPEC.md` §13's
 *  per-type table; safe defaults keep unhandled future variants at `medium`. */
export function severityOfDiffV1(diff: DiffV1): DiffSeverity {
  switch (diff.type) {
    case "initial_generation":
      return "low";
    case "model_added":
    case "model_index_added":
    case "workflow_added":
    case "workflow_step_added":
    case "guarantee_added":
    case "integration_added":
    case "policy_added":
    case "test_added":
    case "relation_added":
      return "medium";
    case "model_field_added":
      if (diff.required_without_default || diff.risk === "destructive") {
        return "high";
      }
      return diff.nullable ? "low" : "medium";
    case "custom_extension_added":
      return "low";
    case "model_field_constraint_changed":
    case "model_index_changed":
    case "model_field_type_changed":
    case "workflow_step_changed":
    case "workflow_step_reordered":
    case "integration_changed":
    case "custom_extension_changed":
    case "policy_changed":
    case "test_changed":
    case "relation_changed":
    case "model_index_removed":
      return "medium";
    case "guarantee_changed":
      return diff.risk === "destructive" ||
        diff.confirmation_kinds.includes("guarantee_weakening")
        ? "high"
        : "medium";
    case "model_removed":
    case "model_field_removed":
    case "integration_removed":
    case "workflow_removed":
    case "workflow_step_removed":
    case "guarantee_removed":
    case "custom_extension_removed":
    case "policy_removed":
    case "test_removed":
    case "relation_removed":
      return "high";
    case "target_changed":
      return diff.field === "language" || diff.field === "runtime"
        ? "critical"
        : "medium";
    default: {
      const _: never = diff;
      return "medium" as DiffSeverity;
    }
  }
}

/** Maximum severity over a list of diffs. */
export function maxSeverity(diffs: readonly DiffV1[]): DiffSeverity {
  const order: DiffSeverity[] = ["low", "medium", "high", "critical"];
  let best = 0;
  for (const d of diffs) {
    const idx = order.indexOf(severityOfDiffV1(d));
    if (idx > best) best = idx;
  }
  return order[best]!;
}

/** Aggregate change-class for the plan summary. */
export function aggregateChangeClass(diffs: readonly DiffV1[]): DiffRiskClass {
  const order: DiffRiskClass[] = ["additive", "modifying", "structural", "destructive", "critical"];
  let best = 0;
  for (const d of diffs) {
    const idx = order.indexOf(d.risk);
    if (idx > best) best = idx;
  }
  return order[best] ?? "additive";
}
