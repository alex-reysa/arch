export interface SourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly severity: "error" | "warning";
}

export function printDiagnostics(diagnostics: readonly SourceDiagnostic[]): void {
  for (const d of diagnostics) {
    const loc = d.file ? `${d.file}:${d.line ?? 0}:${d.column ?? 0}` : "<unknown>";
    process.stderr.write(`${loc} ${d.severity} ${d.code}: ${d.message}\n`);
  }
}
