import { BROAD_CONSTRAINT_SYSTEM_PROMPT } from "../llm/prompts.js";
import type { BaselineId } from "../manifest/schema.js";
import { archTypedSync } from "./arch-typed-sync.js";
import { fullRegeneration } from "./full-regeneration.js";
import { makeClaudeBaseline } from "./claude-baseline.js";
import { makeLiveAgentBaseline } from "./live-agent-baseline.js";
import type { Baseline } from "./types.js";

export const claudeDirectEdit: Baseline = makeClaudeBaseline({ id: "claude-direct-edit" });

export const claudeBroadConstrained: Baseline = makeClaudeBaseline({
  id: "claude-broad-constrained",
  appendSystemPrompt: BROAD_CONSTRAINT_SYSTEM_PROMPT,
});

export const grokDirectEdit: Baseline = makeLiveAgentBaseline({
  id: "grok-direct-edit",
  provider: "grok-build",
});

export const grokBroadConstrained: Baseline = makeLiveAgentBaseline({
  id: "grok-broad-constrained",
  provider: "grok-build",
  appendSystemPrompt: BROAD_CONSTRAINT_SYSTEM_PROMPT,
});

export const composerDirectEdit: Baseline = makeLiveAgentBaseline({
  id: "composer-direct-edit",
  provider: "cursor-composer",
});

export const composerBroadConstrained: Baseline = makeLiveAgentBaseline({
  id: "composer-broad-constrained",
  provider: "cursor-composer",
  appendSystemPrompt: BROAD_CONSTRAINT_SYSTEM_PROMPT,
});

export const BASELINES: Record<BaselineId, Baseline> = {
  "arch-typed-sync": archTypedSync,
  "full-regeneration": fullRegeneration,
  "claude-direct-edit": claudeDirectEdit,
  "claude-broad-constrained": claudeBroadConstrained,
  "grok-direct-edit": grokDirectEdit,
  "grok-broad-constrained": grokBroadConstrained,
  "composer-direct-edit": composerDirectEdit,
  "composer-broad-constrained": composerBroadConstrained,
};

export function getBaseline(id: BaselineId): Baseline {
  return BASELINES[id];
}
