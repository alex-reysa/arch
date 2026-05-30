import type {
  SyncPlanActionV1,
  SyncPlanOwnershipDecision,
} from "@arch/sync";
import type { DiffV1 } from "@arch/sync";

/**
 * The agent task protocol.
 *
 * Agents NEVER:
 *   - parse .arch text
 *   - decide semantic diffs
 *   - create sync plans from scratch
 *   - bypass ownership / write_scope checks
 *   - modify human-owned files
 *   - weaken guarantees
 *   - mark verification passed
 *
 * Agents only propose structured patches (`AgentTaskOutput`) for allowlisted
 * artifacts that already appear in the active sync plan. Every constraint is
 * carried on `AgentTaskSpec` and re-checked by the orchestrator — the agent's
 * own claims are never trusted.
 */
export type AgentRole = "schema" | "api" | "workflow" | "test" | "repair";

// -------------------------------------------------------------------------
// AgentTaskSpec — V1 contract.
//
// The orchestrator builds one `AgentTaskSpec` per `SyncPlanActionV1` it
// dispatches to an agent. Every field is constrained: the agent may only
// write to paths in `allowed_paths`, may only reference entities in
// `entity_ids`, and may only propose ops whose ownership decision matches
// `ownership`. `acceptance_criteria` is the lockstep checklist the orchestrator
// will validate the agent's output against — agents do not get to weaken or
// reinterpret it.
// -------------------------------------------------------------------------

export interface AgentTaskSpec {
  readonly schema_version: "arch.agent.task.v1";
  readonly task_id: string;
  readonly role: AgentRole;
  readonly action_id: string;
  readonly artifact_id: string;
  readonly entity_ids: readonly string[];
  /** POSIX globs evaluated relative to project root. */
  readonly allowed_paths: readonly string[];
  /** POSIX globs that always reject. Wins over `allowed_paths`. */
  readonly forbidden_paths: readonly string[];
  /** The OwnershipIR decision authoritative for this task. */
  readonly ownership: SyncPlanOwnershipDecision;
  /**
   * The IR fragment the action depends on. Canonicalized JSON; the agent
   * MUST NOT re-parse the source `.arch` file to derive an IR.
   */
  readonly ir_fragment: AgentIrFragment;
  /** A snapshot of the SyncPlanActionV1 this task is materializing. */
  readonly action: SyncPlanActionV1;
  /** Diff variants from DiffV1 that motivated this action. */
  readonly diffs: readonly DiffV1[];
  /** Optional starting file content (omitted for `create_file`). */
  readonly previous_content?: string;
  readonly intent_summary: string;
  readonly acceptance_criteria: readonly AgentAcceptanceCriterion[];
  readonly budget: AgentTaskBudget;
}

/**
 * Canonical-JSON IR fragment passed to the agent. The orchestrator computes
 * `fragment_hash` from `body` and asserts it matches the action's
 * `generation.ir_fragment_hash` before dispatch.
 */
export interface AgentIrFragment {
  readonly fragment_hash: string;
  readonly entity_ids: readonly string[];
  /** Canonicalized IR slice as a JSON-serializable value. */
  readonly body: unknown;
}

export interface AgentAcceptanceCriterion {
  readonly id: string;
  /** Free-form description shown to the agent. */
  readonly description: string;
  /** Optional structured check the orchestrator validates after the patch. */
  readonly check?: AgentAcceptanceCheck;
}

export type AgentAcceptanceCheck =
  | { readonly kind: "file_exists"; readonly path: string }
  | { readonly kind: "file_not_modified"; readonly path: string }
  | { readonly kind: "string_present"; readonly path: string; readonly substring: string }
  | { readonly kind: "string_absent"; readonly path: string; readonly substring: string }
  | { readonly kind: "command_zero_exit"; readonly bin: string; readonly args: readonly string[] };

export interface AgentTaskBudget {
  readonly max_wall_clock_seconds: number;
  readonly max_attempts: number;
  /** USD; provider may translate to its own units. */
  readonly max_model_cost_usd?: number;
  readonly max_prompt_tokens?: number;
}

// -------------------------------------------------------------------------
// Structured patch-output schema. Agents return one `AgentTaskOutput` per
// task. Every patch op is bounded: it must target one of `allowed_paths`,
// must declare its op kind, and may carry a content body or a region patch.
// The orchestrator validates the output against the spec before applying.
// -------------------------------------------------------------------------

export type AgentPatchOpKind =
  | "create_file"
  | "rewrite_whole_file"
  | "patch_generated_region"
  | "delete_file"
  | "write_extension_stub";

export interface AgentPatchContentOp {
  readonly kind: "create_file" | "rewrite_whole_file" | "write_extension_stub";
  readonly path: string;
  readonly content: string;
}

export interface AgentPatchRegionOp {
  readonly kind: "patch_generated_region";
  readonly path: string;
  readonly region_marker_id: string;
  readonly content: string;
}

export interface AgentPatchDeleteOp {
  readonly kind: "delete_file";
  readonly path: string;
}

export type AgentPatchOp =
  | AgentPatchContentOp
  | AgentPatchRegionOp
  | AgentPatchDeleteOp;

export interface AgentTaskOutput {
  readonly schema_version: "arch.agent.output.v1";
  readonly task_id: string;
  readonly action_id: string;
  readonly artifact_id: string;
  readonly patches: readonly AgentPatchOp[];
  /**
   * Optional acceptance-criterion ids the agent claims to satisfy. The
   * orchestrator independently verifies each criterion; this field is a
   * hint, not authority.
   */
  readonly satisfied_criteria: readonly string[];
  /** Free-form notes shown to the reviewer. Never authoritative. */
  readonly notes?: string;
}
