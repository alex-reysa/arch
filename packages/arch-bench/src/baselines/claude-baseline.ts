/**
 * Compatibility wrapper for the two Claude live-agent baselines:
 *  - `claude-direct-edit`       — full edit tools, no constraints, no typed diff.
 *  - `claude-broad-constrained` — same, plus a high-level constraint system
 *                                 prompt (don't touch src/custom, don't weaken
 *                                 tests, preserve shape) but still no typed diff
 *                                 and no affected-path allowlist.
 *
 * Both delegate to the provider-neutral live-agent baseline implementation.
 */

import type { BaselineId } from "../manifest/schema.js";
import type { Baseline } from "./types.js";
import { makeLiveAgentBaseline } from "./live-agent-baseline.js";

export interface ClaudeBaselineConfig {
  readonly id: BaselineId;
  readonly appendSystemPrompt?: string;
}

export function makeClaudeBaseline(config: ClaudeBaselineConfig): Baseline {
  return makeLiveAgentBaseline({ ...config, provider: "claude-code" });
}
