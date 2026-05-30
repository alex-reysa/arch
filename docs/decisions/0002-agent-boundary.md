# 0002 — Agent boundary

## Status

Accepted (V1 plan §3.2, §4.1, §7 agents)

## Context

V1 needs an agent task protocol so LLM-assisted patching is possible, but the
core product is the deterministic compiler — diff, plan, patch, verify. Real
LLM integration is risky to introduce before the deterministic substrate is
solid.

## Decision

1. Build deterministic templates and patch operations first.
2. Define the agent task protocol up front, even though the first prototype
   uses a deterministic provider exclusively.
3. Real LLM-provider integration only after **all** of the following are
   stable and tested:
   - deterministic patching
   - patch validation
   - ownership / `write_scope` enforcement
   - verification gating

The agent must never:

- parse `.arch` text
- decide semantic diffs
- create sync plans from scratch
- bypass ownership / `write_scope` checks
- modify human-owned files
- weaken guarantees
- mark verification passed

Agents only propose structured patches for allowlisted artifact paths that
already appear in the active sync plan. The orchestrator validates output and
caps attempts so a failed apply cannot loop forever.

## Consequences

- The `arch-agents` package owns the protocol and a `DeterministicProvider`.
- A real provider is added behind the same `LLMProvider` interface later.
- The patch validator and ownership checks in `arch-sync` are the authority,
  not the agent — even when the agent is deterministic.
