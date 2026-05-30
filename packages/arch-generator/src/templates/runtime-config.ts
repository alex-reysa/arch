import type { CanonicalIR } from "@arch/ir";

/**
 * Emit a typed config loader. Tests can call `loadConfig({ ... })` with an
 * explicit env map; production reads `process.env`.
 */
export function renderRuntimeConfig(ir: CanonicalIR): string {
  const usesRedis = ir.target.cache === "redis";
  const lines = [
    'export type DatabaseAdapter = "memory" | "prisma";',
    "",
    "export interface AppConfig {",
    "  readonly databaseUrl: string;",
    "  /** Persistence backend: in-memory (default) or real Prisma/Postgres. */",
    "  readonly databaseAdapter: DatabaseAdapter;",
    "  readonly port: number;",
    usesRedis ? "  readonly redisUrl: string;" : "",
    "}",
    "",
    "export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {",
    "  return {",
    '    databaseUrl: env.DATABASE_URL ?? "postgres://arch:arch@localhost:5432/arch_app",',
    '    databaseAdapter: env.ARCH_DB === "prisma" ? "prisma" : "memory",',
    "    port: env.PORT ? Number(env.PORT) : 3000,",
    usesRedis ? '    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",' : "",
    "  };",
    "}",
  ].filter(Boolean);
  return lines.join("\n");
}
