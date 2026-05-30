import type { CanonicalIR } from "@arch/ir";

/**
 * Emit a deterministic package.json for the generated Fastify backend.
 * Scripts and package-manager settings are stable across runs so verifier
 * installs do not drift to a different pnpm major.
 */
export function renderPackageJson(ir: CanonicalIR): string {
  const usesRedis = ir.target.cache === "redis";
  const dependencies: Record<string, string> = {
    "@prisma/client": "5.11.0",
    fastify: "4.26.0",
  };
  if (usesRedis) dependencies["ioredis"] = "5.3.2";

  const devDependencies: Record<string, string> = {
    "@types/node": "20.19.39",
    prisma: "5.11.0",
    typescript: "5.9.3",
    vitest: "1.6.1",
    tsx: "4.21.0",
  };

  const pkg = {
    name: "arch-generated-backend",
    version: "0.1.0",
    private: true,
    type: "module",
    packageManager: "pnpm@9.0.0",
    scripts: {
      typecheck: "tsc -p tsconfig.json --noEmit",
      build: "tsc -p tsconfig.json",
      test: "vitest run",
      start: "node dist/server.js",
      // Real Postgres path (opt-in). Requires DATABASE_URL + a running Postgres.
      "prisma:generate": "prisma generate",
      "prisma:push": "prisma db push",
      "prisma:migrate": "prisma migrate deploy",
    },
    pnpm: {
      onlyBuiltDependencies: ["@prisma/client", "@prisma/engines", "esbuild", "prisma"],
    },
    dependencies,
    devDependencies,
  };

  return JSON.stringify(pkg, null, 2);
}
