/**
 * Gated HTTP-level + migration-fidelity integration tests (Technical V1.1).
 *
 * These prove the generated backend over a REAL Postgres — not the in-memory
 * default, and not at the unit level:
 *
 *   1. HTTP-level persistence: boot the generated Fastify server against
 *      Postgres (ARCH_DB=prisma), POST /tasks over HTTP, and confirm the row
 *      landed in Postgres (Prisma-generated cuid id + a direct DB read).
 *   2. Migration fidelity: create the v1 schema, insert a row, evolve the spec
 *      (add `priority: int default: 1`), apply the GENERATED migration SQL to
 *      the live database, and confirm the column was added AND the pre-existing
 *      row is preserved with the backfilled default.
 *
 * SLOW + GATED. Runs only when ARCH_RUN_POSTGRES=1 and DATABASE_URL are set:
 *   docker run --rm -d --name arch-pg -e POSTGRES_USER=arch \
 *     -e POSTGRES_PASSWORD=arch -e POSTGRES_DB=arch_app -p 5432:5432 postgres:16-alpine
 *   ARCH_RUN_POSTGRES=1 DATABASE_URL=postgres://arch:arch@localhost:5432/arch_app \
 *     pnpm --filter @arch/cli test -- src/__tests__/http-postgres.test.ts
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { runApply } from "../commands/apply.js";
import { runInit } from "../commands/init.js";
import { runParse } from "../commands/parse.js";
import { runPlan } from "../commands/plan.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const EX = resolve(REPO_ROOT, "examples", "task-tracker");

const SHOULD_RUN = process.env.ARCH_RUN_POSTGRES === "1" && Boolean(process.env.DATABASE_URL);
const DB_URL = process.env.DATABASE_URL ?? "";
const PORT = 38080;

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function pnpm(cwd: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync("pnpm", args, { cwd, encoding: "utf8", env: { ...process.env, ...extraEnv } });
}

async function generateAndInstall(version: string): Promise<string> {
  const dir = mkdtempSync(resolve(tmpdir(), "arch-http-pg-"));
  tmpDirs.push(dir);
  copyFileSync(resolve(EX, version, "backend.arch"), resolve(dir, "backend.arch"));
  const meta = resolve(dir, ".arch");
  expect(await runInit(["--cwd", dir, "--template", "social-feed"])).toBe(0);
  expect(await runParse([resolve(dir, "backend.arch"), "--emit-ir", "--metadata-dir", meta])).toBe(0);
  expect(await runApply(["--cwd", dir, "--metadata-dir", meta])).toBe(0);
  return dir;
}

const HTTP_VERIFY_DRIVER = `
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const row = await p.task.findUnique({ where: { id: process.argv[2] } });
const count = await p.task.count();
console.log("DBROW " + JSON.stringify(row));
console.log("DBCOUNT " + count);
await p.$disconnect();
`;

const INSERT_DRIVER = `
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const row = await p.task.create({ data: { title: "legacy-row" } });
console.log("INSERTED " + row.id);
await p.$disconnect();
`;

const MIGRATION_VERIFY_DRIVER = `
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const row = await p.task.findUnique({ where: { id: process.argv[2] } });
const cols = await p.$queryRawUnsafe(
  "SELECT column_name FROM information_schema.columns WHERE table_name = 'Task'"
);
console.log("MIG_ROW " + JSON.stringify(row));
console.log("MIG_COLS " + JSON.stringify(cols.map((c) => c.column_name).sort()));
await p.$disconnect();
`;

describe("generated backend over real Postgres (gated)", () => {
  it.skipIf(!SHOULD_RUN)(
    "HTTP POST persists a row to Postgres through the generated Fastify server",
    { timeout: 480_000 },
    async () => {
      const dir = await generateAndInstall("v1");
      const env = { DATABASE_URL: DB_URL, ARCH_DB: "prisma" };

      // Prisma client + tables in the real DB.
      expect(pnpm(dir, ["exec", "prisma", "generate"], env).status).toBe(0);
      const push = pnpm(dir, ["exec", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"], env);
      expect(push.status, push.stdout + push.stderr).toBe(0);

      // Boot the generated server against Postgres.
      const server = spawn("pnpm", ["exec", "tsx", "src/server.ts"], {
        cwd: dir,
        env: { ...process.env, ...env, PORT: String(PORT) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let serverLog = "";
      server.stdout.on("data", (d: Buffer) => (serverLog += d.toString()));
      server.stderr.on("data", (d: Buffer) => (serverLog += d.toString()));

      try {
        const created = await postWithRetry(`http://127.0.0.1:${PORT}/tasks`, { title: "buy milk" });
        // The server answered over HTTP with the created row.
        expect(created.status).toBe(201);
        expect(created.body.title).toBe("buy milk");
        expect(typeof created.body.id).toBe("string");
        // A Prisma cuid (starts with 'c', ~25 chars) — NOT the in-memory "task_1"
        // id — proves the write went through Prisma/Postgres.
        expect(created.body.id, `id was ${created.body.id}; server log:\n${serverLog}`).toMatch(/^c[a-z0-9]{20,}$/);

        // Confirm directly in the database.
        const createdId = created.body.id!;
        writeFileSync(resolve(dir, "verify.ts"), HTTP_VERIFY_DRIVER);
        const verify = pnpm(dir, ["exec", "tsx", "verify.ts", createdId], env);
        expect(verify.status, verify.stdout + verify.stderr).toBe(0);
        expect(verify.stdout).toContain(`"id":"${createdId}"`);
        expect(verify.stdout).toContain('"title":"buy milk"');
        expect(verify.stdout).toMatch(/DBCOUNT [1-9]/);
      } finally {
        server.kill("SIGKILL");
      }
    },
  );

  it.skipIf(!SHOULD_RUN)(
    "additive schema evolution preserves data: the generated migration adds a column and backfills the default",
    { timeout: 480_000 },
    async () => {
      const dir = await generateAndInstall("v1");
      const meta = resolve(dir, ".arch");
      const env = { DATABASE_URL: DB_URL };

      // v1 schema in the DB, then insert a legacy row (no `priority` yet).
      expect(pnpm(dir, ["exec", "prisma", "generate"], env).status).toBe(0);
      expect(pnpm(dir, ["exec", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"], env).status).toBe(0);
      writeFileSync(resolve(dir, "insert.ts"), INSERT_DRIVER);
      const ins = pnpm(dir, ["exec", "tsx", "insert.ts"], env);
      expect(ins.status, ins.stdout + ins.stderr).toBe(0);
      const oldId = (ins.stdout.match(/INSERTED (\S+)/) ?? [])[1];
      expect(oldId).toBeTruthy();

      // Evolve the spec: add `priority: int default: 1`, plan + apply.
      copyFileSync(resolve(EX, "v2-priority", "backend.arch"), resolve(dir, "backend.arch"));
      expect(await runParse([resolve(dir, "backend.arch"), "--emit-ir", "--metadata-dir", meta])).toBe(0);
      expect(await runPlan(["--cwd", dir, "--metadata-dir", meta])).toBe(0);
      expect(await runApply(["--cwd", dir, "--metadata-dir", meta])).toBe(0);

      // Apply the GENERATED additive migration SQL to the live database.
      const migrationSql = findPriorityMigration(dir);
      expect(migrationSql, "no generated migration adding priority was found").toBeTruthy();
      const exec = pnpm(
        dir,
        ["exec", "prisma", "db", "execute", "--file", migrationSql!, "--schema", "prisma/schema.prisma"],
        env,
      );
      expect(exec.status, exec.stdout + exec.stderr).toBe(0);

      // Verify: column added AND the legacy row preserved with the default.
      expect(pnpm(dir, ["exec", "prisma", "generate"], env).status).toBe(0);
      writeFileSync(resolve(dir, "migverify.ts"), MIGRATION_VERIFY_DRIVER);
      const v = pnpm(dir, ["exec", "tsx", "migverify.ts", oldId!], env);
      expect(v.status, v.stdout + v.stderr).toBe(0);
      expect(v.stdout).toContain('"title":"legacy-row"'); // data preserved
      expect(v.stdout).toContain('"priority":1'); // default backfilled
      expect(v.stdout).toContain("MIG_COLS");
      expect(v.stdout).toMatch(/"priority"/); // column exists
    },
  );
});

interface PostResult {
  readonly status: number;
  readonly body: { id?: string; title?: string; [k: string]: unknown };
}

async function postWithRetry(url: string, payload: unknown, attempts = 40): Promise<PostResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as PostResult["body"];
      return { status: res.status, body };
    } catch (err) {
      lastErr = err;
      await sleep(500);
    }
  }
  throw new Error(`server never became reachable at ${url}: ${String(lastErr)}`);
}

function findPriorityMigration(dir: string): string | null {
  const root = resolve(dir, "prisma", "migrations");
  let found: string | null = null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sqlPath = resolve(root, entry.name, "migration.sql");
    try {
      const sql = readFileSync(sqlPath, "utf8");
      if (sql.includes("priority") && sql.toUpperCase().includes("ADD COLUMN")) found = sqlPath;
    } catch {
      /* skip */
    }
  }
  return found;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
