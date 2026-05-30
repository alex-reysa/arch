import { BROAD_CONSTRAINT_SYSTEM_PROMPT } from "../llm/prompts.js";
import type { BaselineId } from "../manifest/schema.js";
import { archTypedSync } from "./arch-typed-sync.js";
import { fullRegeneration } from "./full-regeneration.js";
import { makeClaudeBaseline } from "./claude-baseline.js";
import type { Baseline } from "./types.js";

export const claudeDirectEdit: Baseline = makeClaudeBaseline({ id: "claude-direct-edit" });

export const claudeBroadConstrained: Baseline = makeClaudeBaseline({
  id: "claude-broad-constrained",
  appendSystemPrompt: BROAD_CONSTRAINT_SYSTEM_PROMPT,
});

export const BASELINES: Record<BaselineId, Baseline> = {
  "arch-typed-sync": archTypedSync,
  "full-regeneration": fullRegeneration,
  "claude-direct-edit": claudeDirectEdit,
  "claude-broad-constrained": claudeBroadConstrained,
};

export function getBaseline(id: BaselineId): Baseline {
  return BASELINES[id];
}
