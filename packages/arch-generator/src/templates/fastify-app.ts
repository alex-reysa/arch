import type { CanonicalIR } from "@arch/ir";
import { pascal } from "../naming.js";

/**
 * Emit `src/app.ts`. The app wires runtime services and registers one route
 * plugin per workflow trigger. We expose `buildApp()` so tests can mount the
 * Fastify instance without binding a port.
 */
export function renderFastifyApp(ir: CanonicalIR): string {
  const imports = ir.workflows
    .map((w) => `import { register${pascal(w.name)}Route } from "./routes/${pascal(w.name)}.js";`)
    .join("\n");
  const registrations = ir.workflows
    .map((w) => `  await register${pascal(w.name)}Route(app);`)
    .join("\n");
  return [
    'import Fastify, { type FastifyInstance } from "fastify";',
    imports,
    "",
    "export async function buildApp(): Promise<FastifyInstance> {",
    "  const app = Fastify({ logger: false });",
    registrations,
    "  return app;",
    "}",
  ].join("\n");
}

export function renderFastifyServer(_ir: CanonicalIR): string {
  return [
    'import { buildApp } from "./app.js";',
    'import { loadConfig } from "./runtime/config.js";',
    'import { setDb } from "./runtime/db.js";',
    'import { createPrismaDb, type PrismaClientLike } from "./runtime/db-prisma.js";',
    "",
    "async function main(): Promise<void> {",
    "  const cfg = loadConfig();",
    '  if (cfg.databaseAdapter === "prisma") {',
    "    // Load @prisma/client only when selected. The non-literal specifier",
    "    // keeps the hermetic typecheck independent of `prisma generate`.",
    "    const mod = (await import(prismaClientModule())) as { PrismaClient: new () => unknown };",
    "    const client = new mod.PrismaClient() as unknown as PrismaClientLike;",
    "    setDb(createPrismaDb(client));",
    "  }",
    "  const app = await buildApp();",
    '  await app.listen({ port: cfg.port, host: "0.0.0.0" });',
    "}",
    "",
    "function prismaClientModule(): string {",
    '  return "@prisma/client";',
    "}",
    "",
    "main().catch((err) => {",
    "  // eslint-disable-next-line no-console",
    "  console.error(err);",
    "  process.exit(1);",
    "});",
  ].join("\n");
}
