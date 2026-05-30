import type { SourceSpan } from "./source-map.js";

// -------------------------------------------------------------------------
// Shared diagnostic shape
// -------------------------------------------------------------------------

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly span?: SourceSpan;
  /** Optional structured hint that the diagnostics printer can render. */
  readonly hint?: string;
}

export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];

  add(diagnostic: Diagnostic): void {
    this.items.push(diagnostic);
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  all(): readonly Diagnostic[] {
    return this.items;
  }
}

// -------------------------------------------------------------------------
// Result<T, E> — shared utility type
//
// Every cross-package boundary that can fail returns `Result<T, Diagnostic[]>`
// or `Result<T, ArchError>`. Using a discriminated union (rather than throws)
// makes failures explicit in the type signature and lets the orchestrator
// fan out diagnostics through `DiagnosticBag` without losing structure.
// -------------------------------------------------------------------------

export type Result<T, E = readonly Diagnostic[]> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  r: Result<T, E>,
): r is { readonly ok: true; readonly value: T } {
  return r.ok;
}

export function isErr<T, E>(
  r: Result<T, E>,
): r is { readonly ok: false; readonly error: E } {
  return !r.ok;
}

/** Lifts a synchronous function that may throw into a `Result`. */
export function tryOr<T, E>(
  fn: () => T,
  onError: (cause: unknown) => E,
): Result<T, E> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onError(cause));
  }
}

// -------------------------------------------------------------------------
// Standard error category for cross-package classification.
// -------------------------------------------------------------------------

export type ArchErrorCategory =
  | "parse"
  | "semantic"
  | "ir_validation"
  | "diff"
  | "plan"
  | "patch"
  | "ownership"
  | "drift"
  | "verification"
  | "agent_output"
  | "io"
  | "internal";

export interface ArchError {
  readonly category: ArchErrorCategory;
  readonly code: string;
  readonly message: string;
  readonly span?: SourceSpan;
  readonly cause?: unknown;
}
