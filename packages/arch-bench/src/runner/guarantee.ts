/**
 * Classify a `guarantee_change` task's verification status.
 *
 * The explicit manifest `guaranteeVerification` field is the honest source of
 * truth. A verifier-backed structural `guaranteeAssertion` satisfies strict
 * manifest validation (the change is asserted, not merely declared) but does
 * NOT, by itself, upgrade a guarantee to behaviorally verified: a latency
 * guarantee with no real load oracle stays
 * `declared_but_not_behaviorally_verified` and is excluded from correctness
 * claims (roadmap Phase 1, "Latency guarantees").
 *
 * When the manifest does not classify the task, only a real behavioral oracle
 * test (`oracleTests`) counts as behavioral.
 */

import type { BenchTask } from "../manifest/schema.js";
import type { GuaranteeVerification } from "../report/results.js";

export function computeGuaranteeVerification(task: BenchTask): GuaranteeVerification | undefined {
  if (task.kind !== "guarantee_change") return undefined;
  // Explicit manifest classification wins — never silently promoted by the mere
  // presence of a structural assertion.
  if (task.guaranteeVerification) return task.guaranteeVerification;
  // Unclassified: only a real behavioral oracle test counts as behavioral.
  if (task.oracleTests.length > 0) return "behavioral";
  return "declared_but_not_behaviorally_verified";
}
