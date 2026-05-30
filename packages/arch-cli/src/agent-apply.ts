import type { CanonicalIR } from "@arch/ir";
import type { GeneratedFile } from "@arch/generator";
import type { SyncPlanV1, SyncPlanActionV1 } from "@arch/sync";
import {
  AgentOrchestrator,
  AgentTaskError,
  ClaudeCodeProvider,
  PlannedContentProvider,
  buildAgentTaskSpec,
  type AgentIrFragment,
  type AgentProvider,
  type AgentRole,
  type AgentRunRecord,
} from "@arch/agents";

/**
 * Constrained agent execution for `arch apply --agent <provider>`.
 *
 * For each planned whole-file generated artifact, this builds a constrained
 * `AgentTaskSpec` (the canonical IR fragment + the action's allowlist/ownership
 * + the deterministic content as the baseline), runs it through the
 * `AgentOrchestrator`, and collects the orchestrator-VALIDATED patch content.
 * The orchestrator re-checks allowlist / ownership / write_scope before this
 * returns, and the apply patcher validates again before writing — two gates
 * the provider cannot bypass.
 *
 * On the first rejected output, it stops and returns the failing record so the
 * caller can abort apply WITHOUT writing or promoting anything.
 */

export function resolveAgentProvider(name: string): AgentProvider | null {
  switch (name) {
    case "deterministic":
    case "planned":
    case "planned-content":
      return new PlannedContentProvider();
    case "claude":
    case "claude-code":
      return new ClaudeCodeProvider({});
    default:
      return null;
  }
}

export interface AgentActionsResult {
  readonly contentByPath: Map<string, string>;
  readonly records: AgentRunRecord[];
  readonly error?: { readonly record: AgentRunRecord; readonly message: string };
}

export async function runAgentActions(args: {
  readonly plan: SyncPlanV1;
  readonly ir: CanonicalIR;
  readonly generatedByPath: ReadonlyMap<string, GeneratedFile>;
  readonly provider: AgentProvider;
}): Promise<AgentActionsResult> {
  const { plan, ir, generatedByPath, provider } = args;
  const orchestrator = new AgentOrchestrator({ provider });
  const contentByPath = new Map<string, string>();
  const records: AgentRunRecord[] = [];

  for (const action of plan.actions) {
    if (!isAgentRoutable(action)) continue;
    const generated = generatedByPath.get(action.path);
    if (!generated || generated.write_scope !== "whole_file") continue;

    const spec = buildAgentTaskSpec({
      role: roleForPath(action.path),
      action,
      diffs: plan.diff_index.filter((d) => action.diff_ids.includes(d.diff_id)),
      irFragment: irFragmentForAction(ir, action),
      allowedPaths: [action.path],
      forbiddenPaths: [...plan.path_policy.forbidden],
      intentSummary: `apply ${action.kind} for ${action.artifact_id}`,
      previousContent: generated.content,
    });

    try {
      const { output, record } = await orchestrator.runTask(spec);
      records.push(record);
      const patch = output.patches.find((p) => p.path === action.path);
      if (patch && "content" in patch) {
        contentByPath.set(action.path, patch.content);
      }
    } catch (err) {
      if (err instanceof AgentTaskError) {
        records.push(err.record);
        return { contentByPath, records, error: { record: err.record, message: err.message } };
      }
      throw err;
    }
  }

  return { contentByPath, records };
}

function isAgentRoutable(action: SyncPlanActionV1): boolean {
  return action.kind === "rewrite_whole_file" || action.kind === "create_file";
}

function roleForPath(path: string): AgentRole {
  if (path.includes("/routes/")) return "api";
  if (path.includes("/workflows/")) return "workflow";
  if (path.startsWith("tests/")) return "test";
  return "schema";
}

function irFragmentForAction(ir: CanonicalIR, action: SyncPlanActionV1): AgentIrFragment {
  const entities: unknown[] = [];
  for (const id of action.entity_ids) {
    const model = ir.models.find((m) => m.id === id);
    if (model) {
      entities.push(model);
      continue;
    }
    const workflow = ir.workflows.find((w) => w.id === id);
    if (workflow) entities.push(workflow);
  }
  return {
    fragment_hash: action.generation.ir_fragment_hash,
    entity_ids: action.entity_ids,
    body: { entities },
  };
}
