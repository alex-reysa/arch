import type { SourceLocationIR } from "./schema.js";

export interface SourceMap {
  readonly entries: readonly SourceLocationIR[];
}

export function emptySourceMap(): SourceMap {
  return { entries: [] };
}
