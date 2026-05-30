# 0001 — Parser strategy

## Status

Accepted (V1 plan §7.2)

## Context

`backend.arch` is bounded in V1 (`target`, `model`, `field`, `integration`,
`policy`, `workflow`, `step`, `guarantee`, `test`, `custom`). Diagnostics need
to be precise: every error must point at a byte offset and line/column in the
source file. Editor tooling is not a V1 deliverable.

## Decision

Use a **hand-written lexer and recursive-descent parser**.

- The lexer emits tokens with `SourceSpan`s that preserve byte offsets and
  line/column.
- The parser produces a typed `ArchFileAst` and a `DiagnosticBag`. References
  are not resolved here — that happens in the draft IR / semantic validator.
- Reserved-but-unsupported syntax (named/composite source indexes,
  `custom kind: test_generator`, schedule triggers, etc.) is recognised at the
  lexer/parser layer specifically so the semantic validator can reject it
  with a precise diagnostic instead of a generic "unknown construct" error.

## Consequences

- We control diagnostic quality without fighting a parser generator.
- Adopting a parser generator later is still possible if editor tooling
  arrives in V2; the AST is the stable contract.
- Tests must cover lexical edge cases (unterminated strings, unclosed
  blocks, invalid tokens) directly — there is no upstream library doing that
  for us.
