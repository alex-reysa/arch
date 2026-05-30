import type { CanonicalIR } from "@arch/ir";

/**
 * Emit a cache facade. We expose the same `Cache` interface for both
 * `cache: redis` and `cache: none`; the runtime swap is invisible to
 * workflow code. The default in-memory implementation is what the generated
 * tests run against.
 */
export function renderRuntimeCache(_ir: CanonicalIR): string {
  return [
    "export interface Cache {",
    "  get(key: string): Promise<string | null>;",
    "  set(key: string, value: string, ttlSeconds?: number): Promise<void>;",
    "  delete(key: string): Promise<void>;",
    "  reset(): Promise<void>;",
    "}",
    "",
    "export function createMemoryCache(): Cache {",
    "  const map = new Map<string, { value: string; expiresAt: number | null }>();",
    "  return {",
    "    async get(key) {",
    "      const entry = map.get(key);",
    "      if (!entry) return null;",
    "      if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {",
    "        map.delete(key);",
    "        return null;",
    "      }",
    "      return entry.value;",
    "    },",
    "    async set(key, value, ttlSeconds) {",
    "      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;",
    "      map.set(key, { value, expiresAt });",
    "    },",
    "    async delete(key) { map.delete(key); },",
    "    async reset() { map.clear(); },",
    "  };",
    "}",
    "",
    "let _instance: Cache | null = null;",
    "export function cache(): Cache {",
    "  if (!_instance) _instance = createMemoryCache();",
    "  return _instance;",
    "}",
    "",
    "export function setCache(c: Cache): void { _instance = c; }",
    "export async function resetCache(): Promise<void> {",
    "  if (_instance) await _instance.reset();",
    "}",
  ].join("\n");
}
