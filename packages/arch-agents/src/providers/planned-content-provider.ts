import type { AgentProvider } from "./llm-provider-interface.js";
import type { AgentTaskSpec, AgentTaskOutput, AgentPatchOp } from "../agent-task.js";
import { ProviderOutputError } from "./output-parsing.js";

/**
 * The deterministic agent provider used to route `arch apply --agent` through
 * the FULL constrained-agent boundary while keeping output verifiable.
 *
 * It proposes exactly the planned (deterministic-template) content for the one
 * artifact in the spec — supplied as `spec.previous_content`. Its value is not
 * synthesis; it is that the deterministic content now flows through the same
 * `AgentOrchestrator` validation (allowlist / ownership / write_scope) and
 * produces a reviewable `AgentRunRecord`, identically to an LLM-backed run.
 *
 * It deliberately CANNOT fabricate content: with no planned content it errors,
 * so the orchestrator records a `provider_error` rather than writing nothing.
 */
export class PlannedContentProvider implements AgentProvider {
  readonly id = "planned-content";
  readonly model_id = "deterministic-template";
  readonly enabled = true;

  async run(spec: AgentTaskSpec): Promise<AgentTaskOutput> {
    if (typeof spec.previous_content !== "string") {
      throw new ProviderOutputError(
        `planned-content provider has no planned content for ${spec.artifact_id}`,
      );
    }
    return {
      schema_version: "arch.agent.output.v1",
      task_id: spec.task_id,
      action_id: spec.action_id,
      artifact_id: spec.artifact_id,
      patches: [buildPatch(spec, spec.previous_content)],
      satisfied_criteria: [],
      notes: `planned-content for ${spec.artifact_id}`,
    };
  }
}

function buildPatch(spec: AgentTaskSpec, content: string): AgentPatchOp {
  switch (spec.action.kind) {
    case "create_file":
      return { kind: "create_file", path: spec.action.path, content };
    case "write_extension_stub":
      return { kind: "write_extension_stub", path: spec.action.path, content };
    case "patch_generated_region":
      return {
        kind: "patch_generated_region",
        path: spec.action.path,
        region_marker_id: spec.action.region_marker_id ?? "arch:region",
        content,
      };
    default:
      return { kind: "rewrite_whole_file", path: spec.action.path, content };
  }
}
