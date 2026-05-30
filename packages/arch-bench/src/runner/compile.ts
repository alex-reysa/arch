/**
 * In-process `.arch` → canonical IR compile, used by the `full-regeneration`
 * baseline (which calls `generate(ir)` directly). This is the exact pipeline
 * `arch parse` uses — recursive-descent parser (`@arch/language`) → draft IR +
 * semantic validation → canonicalize → IR schema validation (`@arch/ir`) — so
 * the IR is byte-identical to what the CLI produces. Deterministic: equal
 * source → equal `canonical_hash`.
 */

import type { CanonicalIR } from "@arch/ir";
import { buildDraftIR, canonicalize, validateCanonicalIR, validateSemantics } from "@arch/ir";
import { parse, type Diagnostic } from "@arch/language";

export interface CompileDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export type CompileResult =
  | { readonly ok: true; readonly ir: CanonicalIR }
  | { readonly ok: false; readonly diagnostics: readonly CompileDiagnostic[] };

export function compileSpec(source: string, file: string): CompileResult {
  const { ast, diagnostics: parseDiags } = parse(source, file);
  const parseErrors = parseDiags.all().filter((d) => d.severity === "error");
  if (parseErrors.length > 0 || !ast) {
    const diags =
      parseErrors.length > 0
        ? parseErrors
        : [{ code: "ARCH-PARSE", message: "no AST produced", severity: "error" as const }];
    return { ok: false, diagnostics: diags.map(toDiag) };
  }

  const { draft, diagnostics: draftDiags } = buildDraftIR(ast);
  const sem = validateSemantics(draft);
  const blocking: Diagnostic[] = [
    ...draftDiags.all().filter((d) => d.severity === "error"),
    ...sem.diagnostics.all().filter((d) => d.severity === "error"),
  ];
  if (blocking.length > 0) {
    return { ok: false, diagnostics: blocking.map(toDiag) };
  }

  const ir = canonicalize(draft);
  const validation = validateCanonicalIR(ir);
  if (!validation.ok) {
    return {
      ok: false,
      diagnostics: validation.errors.map((message) => ({ code: "ARCH-IR-INVALID", message, line: 1, column: 1 })),
    };
  }

  return { ok: true, ir };
}

function toDiag(d: Diagnostic): CompileDiagnostic {
  return {
    code: d.code,
    message: d.message,
    line: d.span?.start.line ?? 1,
    column: d.span?.start.column ?? 1,
  };
}
