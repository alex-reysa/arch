/**
 * Stable JSON serializer for canonical IR. Keys are sorted lexicographically;
 * arrays preserve their input order so that workflow step order and enum value
 * order remain semantic.
 */
export function canonicalStringify(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number not allowed in canonical JSON");
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const body = keys
      .map((k) => `${JSON.stringify(k)}:${stringify((value as Record<string, unknown>)[k])}`)
      .join(",");
    return `{${body}}`;
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}
