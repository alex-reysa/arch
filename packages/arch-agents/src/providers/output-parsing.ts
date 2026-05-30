import type { AgentTaskSpec, AgentPatchOp } from "../agent-task.js";

/**
 * Shared, provider-agnostic helpers for LLM-backed `AgentProvider`s:
 *   - `buildAgentPrompt` turns a constrained `AgentTaskSpec` into a strict
 *     system+user prompt that asks for ONLY an AgentTaskOutput-shaped JSON.
 *   - `parseAgentPatches` parses a model's raw text reply into well-typed
 *     patch ops (tolerating a markdown code fence), and throws
 *     `ProviderOutputError` on anything it cannot turn into patches.
 *
 * Neither helper is a security boundary — the `AgentOrchestrator` re-validates
 * every parsed output against the spec before any write. They only keep a model
 * honest about producing parseable, well-typed patches.
 */

/** Thrown when a model returns output Arch cannot parse into a patch set. */
export class ProviderOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderOutputError";
  }
}

const KNOWN_OP_KINDS = new Set([
  "create_file",
  "rewrite_whole_file",
  "patch_generated_region",
  "delete_file",
  "write_extension_stub",
]);

export interface AgentPrompt {
  readonly system: string;
  readonly user: string;
}

export function buildAgentPrompt(spec: AgentTaskSpec): AgentPrompt {
  const system = [
    "You are a constrained patch agent inside the Arch spec-to-code compiler.",
    "You do NOT design the system, parse .arch source, or decide diffs — those are done.",
    "You receive ONE task scoped to ONE artifact and must propose file patches for it.",
    "Hard rules you must obey:",
    "- Only write to paths in allowed_paths; never to forbidden_paths, .git, or node_modules.",
    "- Respect the ownership write_scope. Never modify human-owned files.",
    "- Never weaken a guarantee and never claim verification passed.",
    "Respond with ONLY a JSON object of the form:",
    '{ "patches": [ { "kind": "rewrite_whole_file"|"create_file"|"patch_generated_region"|"write_extension_stub"|"delete_file", "path": "<allowed path>", "content": "<file body>", "region_marker_id": "<only for patch_generated_region>" } ], "notes": "<optional>" }',
    "No prose outside the JSON.",
  ].join("\n");

  const user = JSON.stringify(
    {
      role: spec.role,
      intent_summary: spec.intent_summary,
      artifact_id: spec.artifact_id,
      entity_ids: spec.entity_ids,
      allowed_paths: spec.allowed_paths,
      forbidden_paths: spec.forbidden_paths,
      ownership: spec.ownership,
      action: spec.action,
      ir_fragment: spec.ir_fragment,
      acceptance_criteria: spec.acceptance_criteria,
      previous_content: spec.previous_content,
    },
    null,
    2,
  );

  return { system, user };
}

/** Parse a model's text reply into a structured, well-typed patch list. */
export function parseAgentPatches(text: string): readonly AgentPatchOp[] {
  const obj = parseJsonObject(text);
  const patches = (obj as { patches?: unknown }).patches;
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new ProviderOutputError("model output has no 'patches' array");
  }
  return patches.map((p, i) => coerceOp(p, i));
}

function coerceOp(value: unknown, index: number): AgentPatchOp {
  if (typeof value !== "object" || value === null) {
    throw new ProviderOutputError(`patch[${index}] is not an object`);
  }
  const op = value as Record<string, unknown>;
  if (typeof op.kind !== "string" || !KNOWN_OP_KINDS.has(op.kind)) {
    throw new ProviderOutputError(`patch[${index}] has unknown kind: ${String(op.kind)}`);
  }
  if (typeof op.path !== "string" || op.path.length === 0) {
    throw new ProviderOutputError(`patch[${index}] has no path`);
  }
  if (op.kind === "delete_file") {
    return { kind: "delete_file", path: op.path };
  }
  if (op.kind === "patch_generated_region") {
    if (typeof op.content !== "string") throw new ProviderOutputError(`patch[${index}] missing content`);
    return {
      kind: "patch_generated_region",
      path: op.path,
      region_marker_id: typeof op.region_marker_id === "string" ? op.region_marker_id : "",
      content: op.content,
    };
  }
  if (typeof op.content !== "string") throw new ProviderOutputError(`patch[${index}] missing content`);
  return {
    kind: op.kind as "create_file" | "rewrite_whole_file" | "write_extension_stub",
    path: op.path,
    content: op.content,
  };
}

function parseJsonObject(text: string): unknown {
  const candidate = stripCodeFence(text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new ProviderOutputError("model output is not valid JSON");
  }
}

function stripCodeFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1]! : text;
}
