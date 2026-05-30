import type { AgentProvider } from "./llm-provider-interface.js";
import { DeterministicProvider } from "./deterministic-provider.js";
import type { AgentTaskSpec, AgentTaskOutput } from "../agent-task.js";
import { buildAgentPrompt, parseAgentPatches, ProviderOutputError } from "./output-parsing.js";

export { ProviderOutputError } from "./output-parsing.js";

/**
 * A real, model-backed `AgentProvider`.
 *
 * It is the ONLY place in Arch that talks to an LLM, and it is constrained by
 * the same task protocol as every other provider:
 *   - it never reads `.arch` source or computes diffs — it only sees the
 *     canonical `AgentTaskSpec` the orchestrator hands it;
 *   - its output is re-validated by `AgentOrchestrator` against the spec, so it
 *     cannot write outside the allowlist, touch human-owned files, escape the
 *     repo root, or mark verification passed;
 *   - it is DISABLED BY DEFAULT: without an API key (and with the default
 *     transport) `run()` refuses to make a network call.
 *
 * The wire format is the Anthropic Messages API, but `transport` is injectable
 * so tests (and alternative Anthropic-compatible endpoints) need no network.
 */

export interface LlmCompletionRequest {
  readonly system: string;
  readonly user: string;
  readonly model: string;
  readonly maxOutputTokens: number;
}

/** Turns a constrained prompt into the assistant's raw text completion. */
export type LlmTransport = (req: LlmCompletionRequest) => Promise<string>;

export interface HttpLlmProviderConfig {
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly id?: string;
  readonly maxOutputTokens?: number;
  /** Inject to avoid network (tests) or to target an Anthropic-compatible endpoint. */
  readonly transport?: LlmTransport;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export class HttpLlmProvider implements AgentProvider {
  readonly id: string;
  readonly model_id: string;
  readonly enabled: boolean;
  private readonly transport: LlmTransport;
  private readonly maxOutputTokens: number;
  private readonly model: string;

  constructor(config: HttpLlmProviderConfig) {
    this.id = config.id ?? "http-llm";
    this.model = config.model;
    this.model_id = config.model;
    this.enabled = Boolean(config.apiKey);
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.transport = config.transport ?? anthropicMessagesTransport(config);
  }

  async run(spec: AgentTaskSpec): Promise<AgentTaskOutput> {
    const prompt = buildAgentPrompt(spec);
    const text = await this.transport({
      system: prompt.system,
      user: prompt.user,
      model: this.model,
      maxOutputTokens: this.maxOutputTokens,
    });
    const patches = parseAgentPatches(text);
    // Identity fields are stamped from the spec (never the model) so the
    // orchestrator's security checks — paths, ownership, write_scope — are what
    // actually gate the patch, not an echoed id the model could forge.
    return {
      schema_version: "arch.agent.output.v1",
      task_id: spec.task_id,
      action_id: spec.action_id,
      artifact_id: spec.artifact_id,
      patches,
      satisfied_criteria: [],
      notes: `http-llm(${this.model_id})`,
    };
  }
}

/**
 * Select a provider from the environment. Arch stays deterministic unless a
 * real model is explicitly configured via `ARCH_LLM_API_KEY`.
 */
export function providerFromEnv(
  env: Record<string, string | undefined> = process.env,
): AgentProvider {
  const apiKey = env.ARCH_LLM_API_KEY;
  if (!apiKey) return new DeterministicProvider();
  const config: HttpLlmProviderConfig = {
    apiKey,
    model: env.ARCH_LLM_MODEL ?? "claude-opus-4",
    ...(env.ARCH_LLM_BASE_URL !== undefined ? { baseUrl: env.ARCH_LLM_BASE_URL } : {}),
    ...(env.ARCH_LLM_MAX_OUTPUT_TOKENS !== undefined
      ? { maxOutputTokens: Number(env.ARCH_LLM_MAX_OUTPUT_TOKENS) }
      : {}),
  };
  return new HttpLlmProvider(config);
}

function anthropicMessagesTransport(config: HttpLlmProviderConfig): LlmTransport {
  return async (req) => {
    if (!config.apiKey) {
      throw new Error(
        "HttpLlmProvider is disabled: set ARCH_LLM_API_KEY (or inject a transport) to enable model calls",
      );
    }
    const url = config.baseUrl ?? DEFAULT_BASE_URL;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM HTTP ${res.status}: ${await safeText(res)}`);
    }
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    if (!text) throw new ProviderOutputError("LLM response contained no text content");
    return text;
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<no body>";
  }
}
