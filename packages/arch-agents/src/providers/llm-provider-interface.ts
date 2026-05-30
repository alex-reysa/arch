import type { AgentTaskSpec, AgentTaskOutput } from "../agent-task.js";

/**
 * An agent provider turns a constrained `AgentTaskSpec` into a structured
 * `AgentTaskOutput`. The provider may NOT read `.arch` source, compute diffs,
 * or invent plans — it only proposes patches for the artifact the spec names.
 *
 * V1 ships a deterministic provider. A real LLM-backed provider implements the
 * same interface but is OPTIONAL and DISABLED BY DEFAULT: the orchestrator
 * re-validates every output regardless of provider, so an LLM can never bypass
 * the ownership/allowlist/guarantee boundary.
 */
export interface AgentProvider {
  readonly id: string;
  /**
   * The concrete model this provider routes to (e.g. "claude-opus-4",
   * "deterministic"). Recorded in every `AgentRunRecord` for review. Omitted
   * for providers that are not model-backed.
   */
  readonly model_id?: string;
  /** Default false. A provider must be explicitly enabled to make network calls. */
  readonly enabled?: boolean;
  run(spec: AgentTaskSpec): Promise<AgentTaskOutput>;
}
