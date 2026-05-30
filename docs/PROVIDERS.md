# LLM provider configuration

Arch can use a real LLM to synthesize patches, but the LLM is **a tool used
inside the compiler — never the compiler itself**. This document explains the
provider abstraction, the trust boundary, how to configure a real provider, how
to run the optional live test, and why Public V1 keeps the live provider
**manually invokable** rather than auto-wiring it into `arch apply`.

## The boundary, in one paragraph

A provider turns a constrained [`AgentTaskSpec`](../packages/arch-agents/src/agent-task.ts)
into a structured `AgentTaskOutput` (a set of file patches). The
[`AgentOrchestrator`](../packages/arch-agents/src/orchestrator.ts)
**re-validates every output against the spec, regardless of which provider
produced it.** A provider — deterministic or LLM-backed — can never:

- read `.arch` source, compute diffs, or invent a plan,
- write outside `allowed_paths`, or to `.git` / `node_modules`, or escape the repo root,
- modify a human-owned file (`write_scope: none`) or a `stub_only` artifact with a non-stub op,
- weaken a guarantee, or
- mark verification as passed (the output type structurally has no such field).

These are enforced in [`output-validation.ts`](../packages/arch-agents/src/output-validation.ts)
and exercised by [`agent-protocol.test.ts`](../packages/arch-agents/test/agent-protocol.test.ts)
and [`http-llm-provider.test.ts`](../packages/arch-agents/test/http-llm-provider.test.ts).

## Providers shipped in V1

| Provider | id | Network | Default | Use |
|---|---|---|---|---|
| `DeterministicProvider` | `deterministic` | none | enabled | the V1 patch-synthesis reference; used by tests |
| `HttpLlmProvider` | `http-llm` | Anthropic Messages API (or any compatible endpoint) | **disabled** | the real, model-backed provider |

`HttpLlmProvider` is **disabled by default**: with no API key and the default
transport, `run()` refuses to make a network call. It only talks to a model when
you explicitly configure it.

## Configuration

Selection happens through [`providerFromEnv`](../packages/arch-agents/src/providers/http-llm-provider.ts).
Without `ARCH_LLM_API_KEY`, it returns the deterministic provider. With it, it
returns an enabled `HttpLlmProvider`.

| Env var | Required | Default | Meaning |
|---|---|---|---|
| `ARCH_LLM_API_KEY` | to enable | — | API key. Its presence is what enables the provider. |
| `ARCH_LLM_MODEL` | no | `claude-opus-4` | Model id recorded in every run record. |
| `ARCH_LLM_BASE_URL` | no | `https://api.anthropic.com/v1/messages` | Anthropic-compatible Messages endpoint. |
| `ARCH_LLM_MAX_OUTPUT_TOKENS` | no | `4096` | Output token cap per task. |

The transport is also injectable in code (`new HttpLlmProvider({ model, transport })`),
which is how the tests drive a "model" deterministically with no network.

### Example: invoking the constrained provider manually

```ts
import {
  AgentOrchestrator,
  buildAgentTaskSpec,
  providerFromEnv,
} from "@arch/agents";

const provider = providerFromEnv(process.env); // deterministic unless ARCH_LLM_API_KEY is set
const spec = buildAgentTaskSpec({
  role: "schema",
  action,            // one SyncPlanActionV1 from an `arch plan`
  diffs,             // the DiffV1[] that motivated it
  irFragment,        // canonical IR slice (the agent never re-parses .arch)
  allowedPaths: ["src/models/Post.ts"],
  forbiddenPaths: ["node_modules/**", ".git/**", "src/custom/**"],
  intentSummary: "regenerate the Post model",
});

const { output, record } = await new AgentOrchestrator({ provider }).runTask(spec);
// `output.patches` is the validated patch set; `record` is the audit trail.
```

## Run metadata (review trail)

Every task produces an `AgentRunRecord` with enough provenance to audit a run
without trusting the provider:

`task_id`, `action_id`, `artifact_id`, `provider_id`, `model_id`, `task_hash`
(sha256 of the canonical spec — tamper-evident), `ir_fragment_hash`, `attempts`,
`outcome` (`ok` / `validation_failed` / `criteria_failed` / `provider_error`),
and `output_validation` (the orchestrator's independent verdict — **not** the
provider's `satisfied_criteria` claim).

## Optional live test

A real network test lives in
[`test/live-provider.test.ts`](../packages/arch-agents/test/live-provider.test.ts)
and is **skipped by default**. It is gated by `ARCH_RUN_LIVE_LLM=1` **and** an API
key, and it asserts the safety property: the model's output is either fully
validated (every patch inside the allowlist) or safely rejected with an
`AgentTaskError` — a live model can never widen its own permissions.

```sh
ARCH_RUN_LIVE_LLM=1 \
ARCH_LLM_API_KEY=sk-... \
ARCH_LLM_MODEL=claude-opus-4 \
pnpm --filter @arch/agents test -- test/live-provider.test.ts
```

> The live test makes a billable API call. Keep it gated; never commit a key.

## Why V1 keeps the provider manually invokable

`arch apply` in Public V1 patches through **deterministic templates**, not the
LLM orchestrator. This is a deliberate cutline, consistent with the founding plan's
"deterministic-first" stance, for three reasons:

1. **Determinism is the product.** The thesis is that spec→code is reproducible.
   The deterministic generator gives byte-identical output for the same IR, which
   is what makes drift detection and `pnpm update-goldens` meaningful. Routing
   apply through a model would trade that away for no V1 benefit.
2. **The boundary is already real and tested** independently of apply: the
   orchestrator, allowlist/ownership validation, run metadata, and the real
   `HttpLlmProvider` all exist and are covered by mocked-provider tests. Wiring is
   a small, additive step the validation layer already guards.
3. **Safety.** Keeping the live model out of the default `apply` path means a
   misconfigured key or a hallucinated patch cannot affect a normal run.

**Path to close:** mark selected `SyncPlanActionV1`s as agent-synthesized and
route them through `AgentOrchestrator` in `apply`; the validation layer already
rejects every out-of-bounds output. See the roadmap in
[`docs/PUBLIC_V1_READINESS_REPORT.md`](./PUBLIC_V1_READINESS_REPORT.md).
