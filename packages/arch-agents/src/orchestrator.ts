import { canonicalStringify, hashCanonical } from "@arch/ir";
import type { AgentTaskSpec, AgentTaskOutput, AgentPatchOp } from "./agent-task.js";
import type { AgentProvider } from "./providers/llm-provider-interface.js";
import { validateAgentTaskOutput, type AgentOutputValidation } from "./output-validation.js";

export interface OrchestratorOptions {
  readonly provider: AgentProvider;
}

/**
 * The reviewable record of a single agent task. It carries enough provenance
 * for an auditor to answer "which provider/model produced this, against which
 * task and IR fragment, and did the independent re-validation pass?" without
 * trusting the provider:
 *   - `provider_id` / `model_id`: which adapter + concrete model ran
 *   - `task_id` / `action_id` / `artifact_id`: what was attempted
 *   - `task_hash`: content hash of the canonical `AgentTaskSpec` (tamper-evident)
 *   - `ir_fragment_hash`: the IR slice the task was scoped to
 *   - `output_validation`: the orchestrator's independent verdict (never the
 *     provider's `satisfied_criteria` claim)
 *   - `attempts` / `outcome`
 */
export interface AgentRunRecord {
  readonly task_id: string;
  readonly action_id: string;
  readonly artifact_id: string;
  readonly provider_id: string;
  readonly model_id: string;
  readonly task_hash: string;
  readonly ir_fragment_hash: string;
  readonly attempts: number;
  readonly outcome: "ok" | "validation_failed" | "criteria_failed" | "provider_error";
  readonly output_validation: AgentOutputValidation;
  readonly errors: readonly string[];
}

export interface AgentRunResult {
  readonly output: AgentTaskOutput;
  readonly record: AgentRunRecord;
}

export class AgentTaskError extends Error {
  constructor(
    readonly record: AgentRunRecord,
  ) {
    super(`agent task ${record.task_id} failed (${record.outcome}): ${record.errors.join("; ")}`);
    this.name = "AgentTaskError";
  }
}

/**
 * Drives a single agent task. The orchestrator:
 *   1. asks the provider for a structured output,
 *   2. re-validates it against the spec (ownership / allowlist / forbidden
 *      paths / op kinds) — provider claims are never trusted,
 *   3. independently checks the content-based acceptance criteria
 *      (`string_present` / `string_absent`) against the proposed patch bodies,
 *   4. retries up to `spec.budget.max_attempts`, and
 *   5. returns the validated output plus a run record, or throws.
 *
 * The orchestrator NEVER marks verification passed and NEVER writes files — it
 * only produces a validated patch proposal for the apply/repair pipeline.
 */
export class AgentOrchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  async runTask(spec: AgentTaskSpec): Promise<AgentRunResult> {
    const max = Math.max(1, spec.budget.max_attempts);
    const provider = this.options.provider;
    const modelId = provider.model_id ?? "none";
    const taskHash = taskSpecHash(spec);
    const irFragmentHash = spec.ir_fragment.fragment_hash;

    let lastValidation: AgentOutputValidation = { ok: false, errors: ["no attempt was run"] };
    let lastOutcome: AgentRunRecord["outcome"] = "validation_failed";

    const base = {
      task_id: spec.task_id,
      action_id: spec.action_id,
      artifact_id: spec.artifact_id,
      provider_id: provider.id,
      model_id: modelId,
      task_hash: taskHash,
      ir_fragment_hash: irFragmentHash,
    } as const;

    for (let attempt = 1; attempt <= max; attempt++) {
      // A misbehaving provider (network error, malformed JSON, timeout) is a
      // failed attempt — never a crash that escapes the orchestrator.
      let output: AgentTaskOutput;
      try {
        output = await provider.run(spec);
      } catch (err) {
        lastValidation = { ok: false, errors: [`provider ${provider.id} threw: ${errorMessage(err)}`] };
        lastOutcome = "provider_error";
        continue;
      }

      const validation = validateAgentTaskOutput(spec, output);
      if (!validation.ok) {
        lastValidation = validation;
        lastOutcome = "validation_failed";
        continue;
      }

      const criteria = checkContentCriteria(spec, output);
      if (!criteria.ok) {
        lastValidation = { ok: false, errors: criteria.errors };
        lastOutcome = "criteria_failed";
        continue;
      }

      return {
        output,
        record: {
          ...base,
          attempts: attempt,
          outcome: "ok",
          output_validation: { ok: true, errors: [] },
          errors: [],
        },
      };
    }

    throw new AgentTaskError({
      ...base,
      attempts: max,
      outcome: lastOutcome,
      output_validation: lastValidation,
      errors: lastValidation.errors,
    });
  }
}

/**
 * Content hash of the canonical `AgentTaskSpec`. The JSON round-trip drops any
 * `undefined`/non-serializable values so the canonical form is stable, and
 * `canonicalStringify` sorts keys so the hash is independent of field order.
 */
function taskSpecHash(spec: AgentTaskSpec): string {
  return hashCanonical(canonicalStringify(JSON.parse(JSON.stringify(spec))));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface CriteriaResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Verify the content-based acceptance criteria independently of the agent's
 * `satisfied_criteria` claims. `file_exists` / `command_zero_exit` checks
 * require the filesystem and are deferred to the apply/verify stage.
 */
function checkContentCriteria(spec: AgentTaskSpec, output: AgentTaskOutput): CriteriaResult {
  const errors: string[] = [];
  const contentByPath = new Map<string, string>();
  for (const op of output.patches) {
    if ("content" in op) contentByPath.set(op.path, op.content);
  }

  for (const criterion of spec.acceptance_criteria) {
    const check = criterion.check;
    if (!check) continue;
    if (check.kind === "string_present" || check.kind === "string_absent") {
      const body = contentByPath.get(check.path);
      if (body === undefined) continue; // file not part of this patch; defer
      const present = body.includes(check.substring);
      if (check.kind === "string_present" && !present) {
        errors.push(`criterion ${criterion.id}: expected substring not present in ${check.path}`);
      }
      if (check.kind === "string_absent" && present) {
        errors.push(`criterion ${criterion.id}: forbidden substring present in ${check.path}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// Re-exported so callers don't need a separate import for the op type.
export type { AgentPatchOp };
