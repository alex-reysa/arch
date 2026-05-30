import type { DiffV1, SyncPlanActionV1 } from "@arch/sync";
import type {
  AgentAcceptanceCriterion,
  AgentIrFragment,
  AgentRole,
  AgentTaskBudget,
  AgentTaskSpec,
} from "./agent-task.js";

const DEFAULT_BUDGET: AgentTaskBudget = {
  max_wall_clock_seconds: 30,
  max_attempts: 2,
};

/**
 * Build a constrained `AgentTaskSpec` for one planned action. This is the
 * orchestrator's bridge from a deterministic `SyncPlanActionV1` (which already
 * carries the ownership decision and generation metadata) to the bounded task
 * an agent is allowed to attempt. The agent never sees `.arch` source — only
 * the canonical `ir_fragment`.
 */
export function buildAgentTaskSpec(args: {
  readonly role: AgentRole;
  readonly action: SyncPlanActionV1;
  readonly diffs: readonly DiffV1[];
  readonly irFragment: AgentIrFragment;
  readonly allowedPaths: readonly string[];
  readonly forbiddenPaths: readonly string[];
  readonly intentSummary: string;
  readonly acceptanceCriteria?: readonly AgentAcceptanceCriterion[];
  readonly budget?: AgentTaskBudget;
  readonly previousContent?: string;
}): AgentTaskSpec {
  return {
    schema_version: "arch.agent.task.v1",
    task_id: `task.${args.action.action_id}`,
    role: args.role,
    action_id: args.action.action_id,
    artifact_id: args.action.artifact_id,
    entity_ids: args.action.entity_ids,
    allowed_paths: args.allowedPaths,
    forbidden_paths: args.forbiddenPaths,
    ownership: args.action.ownership,
    ir_fragment: args.irFragment,
    action: args.action,
    diffs: args.diffs,
    ...(args.previousContent !== undefined ? { previous_content: args.previousContent } : {}),
    intent_summary: args.intentSummary,
    acceptance_criteria: args.acceptanceCriteria ?? [],
    budget: args.budget ?? DEFAULT_BUDGET,
  };
}
