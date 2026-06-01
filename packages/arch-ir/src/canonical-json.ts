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
    // JSON parity: an `undefined` array element serializes as `null`.
    return `[${value.map((v) => (v === undefined ? "null" : stringify(v))).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // JSON parity: omit keys whose value is `undefined` (rather than throwing).
    // This keeps output byte-identical for objects without undefined keys, so
    // no previously-hashable IR's canonical hash changes.
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(",");
    return `{${body}}`;
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}
