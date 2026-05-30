import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CanonicalIR } from "@arch/ir";
import { describe, expect, it } from "vitest";
import { generate } from "../../generator.js";

/**
 * Workstream 2: the generated runtime exposes a real Prisma/Postgres adapter
 * behind the SAME `Db` interface the in-memory store implements, selected by
 * env. The adapter must be a drop-in: it must typecheck against `Db` WITHOUT
 * importing `@prisma/client` (which would require `prisma generate` and break
 * the hermetic typecheck path). The real client is injected at startup.
 */

const require_ = createRequire(import.meta.url);

function twoModelIR(): CanonicalIR {
  return {
    schema_version: "arch.ir.v1",
    canonical_hash: "prisma-persistence",
    target: { stack: "ts.node.fastify.postgres.prisma", cache: "none" },
    models: [
      {
        id: "model:User",
        kind: "model",
        name: "User",
        fields: [
          { id: "field:User.id", kind: "field", name: "id", model_id: "model:User", type: { kind: "id" }, nullable: false, indexed: false },
          { id: "field:User.email", kind: "field", name: "email", model_id: "model:User", type: { kind: "primitive", name: "string" }, nullable: false, indexed: true },
          { id: "field:User.createdAt", kind: "field", name: "createdAt", model_id: "model:User", type: { kind: "primitive", name: "timestamp" }, nullable: false, default: "now", indexed: false },
        ],
        indexes: [],
      },
      {
        id: "model:Post",
        kind: "model",
        name: "Post",
        fields: [
          { id: "field:Post.id", kind: "field", name: "id", model_id: "model:Post", type: { kind: "id" }, nullable: false, indexed: false },
          { id: "field:Post.body", kind: "field", name: "body", model_id: "model:Post", type: { kind: "primitive", name: "string" }, nullable: false, indexed: false },
          { id: "field:Post.visibility", kind: "field", name: "visibility", model_id: "model:Post", type: { kind: "enum", values: ["public", "private"] }, nullable: false, default: "public", indexed: true },
          { id: "field:Post.createdAt", kind: "field", name: "createdAt", model_id: "model:Post", type: { kind: "primitive", name: "timestamp" }, nullable: false, default: "now", indexed: true },
        ],
        indexes: [],
      },
    ],
    integrations: [],
    policies: [],
    workflows: [],
    customs: [],
    artifacts: [],
    ownership: [],
    verification: { typecheck: true, tests: true, migrations: true },
    guarantee_coverage: [],
    source_locations: [],
  };
}

function fileBody(ir: CanonicalIR, path: string): string {
  const f = generate(ir).files.find((g) => g.path === path);
  if (!f) throw new Error(`generator did not emit ${path}`);
  return f.content;
}

describe("generated Prisma/Postgres persistence adapter", () => {
  it("emits src/runtime/db-prisma.ts decoupled from @prisma/client", () => {
    const body = fileBody(twoModelIR(), "src/runtime/db-prisma.ts");
    expect(body).toContain("export function createPrismaDb");
    expect(body).toContain("PrismaClientLike");
    // The adapter must NOT statically import @prisma/client (no prisma generate
    // required for the hermetic typecheck path).
    expect(body).not.toContain('from "@prisma/client"');
    // It bridges per-model delegates.
    expect(body).toContain("client.user");
    expect(body).toContain("client.post");
  });

  it("exposes setDb and a Collection interface on the in-memory db so the adapter can be swapped in", () => {
    const body = fileBody(twoModelIR(), "src/runtime/db.ts");
    expect(body).toContain("export function setDb");
    expect(body).toContain("interface Collection");
  });

  it("selects the adapter from ARCH_DB in runtime config and wires it in server startup", () => {
    const config = fileBody(twoModelIR(), "src/runtime/config.ts");
    expect(config).toContain("ARCH_DB");
    expect(config).toContain("databaseAdapter");

    const server = fileBody(twoModelIR(), "src/server.ts");
    expect(server).toContain("databaseAdapter");
    expect(server).toContain("createPrismaDb");
    expect(server).toContain("setDb");
  });

  it("db.ts + db-prisma.ts typecheck together as a drop-in Db under strict tsc --noEmit (no @prisma/client)", () => {
    const ir = twoModelIR();
    const db = fileBody(ir, "src/runtime/db.ts");
    const dbPrisma = fileBody(ir, "src/runtime/db-prisma.ts");

    const dir = mkdtempSync(join(tmpdir(), "arch-prisma-typecheck-"));
    try {
      const writeAt = (rel: string, content: string): void => {
        const full = join(dir, rel);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      };
      writeAt("src/runtime/db.ts", db);
      writeAt("src/runtime/db-prisma.ts", dbPrisma);
      writeAt(
        "tsconfig.json",
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "ES2022",
              moduleResolution: "Bundler",
              lib: ["ES2022"],
              strict: true,
              esModuleInterop: true,
              forceConsistentCasingInFileNames: true,
              skipLibCheck: true,
              noEmit: true,
              isolatedModules: true,
              types: [],
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ),
      );

      const tscBin = require_.resolve("typescript/bin/tsc");
      const proc = spawnSync(process.execPath, [tscBin, "--noEmit", "-p", dir], { encoding: "utf8" });
      if (proc.status !== 0) {
        throw new Error(
          [
            `tsc --noEmit failed (status=${proc.status}) for db.ts + db-prisma.ts`,
            "--- stdout ---",
            proc.stdout?.trim() || "(empty)",
            "--- db-prisma.ts ---",
            dbPrisma,
          ].join("\n"),
        );
      }
      expect(proc.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
