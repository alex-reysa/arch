# Security Policy

Arch generates and synchronizes backend code, and constrains LLM agents inside a
compiler boundary. We take the integrity of that boundary seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's **Security → "Report a vulnerability"**
(private security advisory) flow on this repository. Include:

- a description of the issue and its impact,
- steps to reproduce (a minimal `backend.arch` or agent output is ideal),
- affected package(s)/version(s), and
- any suggested remediation.

We aim to acknowledge a report within a few business days and to keep you updated
as we investigate. Please give us reasonable time to release a fix before any
public disclosure.

## What we consider in scope

Arch's value depends on a small set of trust boundaries. Reports that demonstrate
a way to break any of these are especially valuable:

- **Path containment** — a generated/patched/agent path escaping the repo root,
  or writing to `.git` / `node_modules`.
- **Ownership enforcement** — Arch or an agent overwriting a human-owned file
  (`src/custom/**`, `write_scope: none`) or a `stub_only` artifact.
- **Verification gating** — metadata promotion happening when install or
  verification did **not** pass, or `--skip-verify` promoting metadata.
- **Agent boundary** — a provider (deterministic or LLM) producing output that
  the orchestrator accepts despite violating the allowlist, ownership, or
  acceptance criteria; or any path by which a provider could mark verification
  passed.
- **Plan integrity** — applying a stale or tampered plan (mismatched
  `base_ir_hash` / `target_ir_hash` / `plan_hash`).
- **Drift/repair** — repair touching human-owned files, exceeding its attempt
  cap, or promoting on a failed verify.

## Out of scope

- Vulnerabilities in third-party dependencies of the **generated** project
  (e.g. Fastify, Prisma) — report those upstream. We will, however, address
  cases where Arch generates insecure code by default.
- Issues that require a malicious local operator who already controls the
  machine, the `.arch/` metadata, or the spec.
- The optional live LLM provider making network calls **when you have explicitly
  configured an API key** — that is intended behavior (it is disabled by
  default). See [`docs/PROVIDERS.md`](docs/PROVIDERS.md).

## Handling secrets

Arch does not require or store provider credentials. The LLM provider reads
`ARCH_LLM_API_KEY` from the environment only when you set it; keys are never
written to disk or committed. Never include real keys in tests, fixtures, or
issues.
