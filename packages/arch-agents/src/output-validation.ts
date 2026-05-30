import { isSafeRelativePath, matchGlob } from "@arch/sync";
import type { AgentTaskSpec, AgentTaskOutput, AgentPatchOp } from "./agent-task.js";

export interface AgentOutputValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Re-validate a proposed `AgentTaskOutput` against the authoritative
 * `AgentTaskSpec`. This is the enforcement point for the agent boundary — it
 * runs regardless of which provider produced the output, so a (future) LLM
 * provider can never widen its own permissions. Every violation is collected.
 *
 * Enforced:
 *   - identity: task/action/artifact ids and schema_version must match the spec
 *   - repo-root containment (no `..`, absolute, `.git`, `node_modules`)
 *   - forbidden_paths win over allowed_paths; every path must be allowlisted
 *   - ownership/write_scope: `none` forbids writes; `stub_only` allows only
 *     `write_extension_stub`; region patches require `generated_region` + a
 *     marker id; whole-file ops require whole_file scope
 *   - structurally, an agent CANNOT mark verification passed: `AgentTaskOutput`
 *     has no such field.
 */
export function validateAgentTaskOutput(
  spec: AgentTaskSpec,
  output: AgentTaskOutput,
): AgentOutputValidation {
  const errors: string[] = [];

  if (output.schema_version !== "arch.agent.output.v1") {
    errors.push(`unexpected output schema_version: ${String(output.schema_version)}`);
  }
  if (output.task_id !== spec.task_id) errors.push(`task_id mismatch: ${output.task_id} ≠ ${spec.task_id}`);
  if (output.action_id !== spec.action_id) errors.push(`action_id mismatch: ${output.action_id} ≠ ${spec.action_id}`);
  if (output.artifact_id !== spec.artifact_id) {
    errors.push(`artifact_id mismatch: ${output.artifact_id} ≠ ${spec.artifact_id}`);
  }
  if (output.patches.length === 0) errors.push("output proposes no patches");

  for (const op of output.patches) {
    errors.push(...validateOp(spec, op));
  }

  return { ok: errors.length === 0, errors };
}

function validateOp(spec: AgentTaskSpec, op: AgentPatchOp): string[] {
  const errors: string[] = [];
  const p = op.path;

  if (!isSafeRelativePath(p)) {
    errors.push(`patch path escapes repo root or targets a forbidden directory: ${p}`);
  }
  if (spec.forbidden_paths.some((g) => matchGlob(p, g))) {
    errors.push(`patch path matches a forbidden glob: ${p}`);
  } else if (spec.allowed_paths.length > 0 && !spec.allowed_paths.some((g) => matchGlob(p, g))) {
    errors.push(`patch path is not in the allowlist: ${p}`);
  }

  const ws = spec.ownership.write_scope;
  if (ws === "none") {
    errors.push(`ownership write_scope=none forbids writing ${p} (human-owned)`);
  }
  if (ws === "stub_only" && op.kind !== "write_extension_stub") {
    errors.push(`stub_only ownership permits only write_extension_stub, got ${op.kind} for ${p}`);
  }
  if ((op.kind === "create_file" || op.kind === "rewrite_whole_file") && ws !== "whole_file") {
    errors.push(`${op.kind} requires whole_file ownership, got ${ws} for ${p}`);
  }
  if (op.kind === "patch_generated_region") {
    if (ws !== "generated_region") {
      errors.push(`patch_generated_region requires generated_region ownership, got ${ws} for ${p}`);
    }
    if (!op.region_marker_id) {
      errors.push(`patch_generated_region missing region_marker_id for ${p}`);
    }
  }

  return errors;
}
