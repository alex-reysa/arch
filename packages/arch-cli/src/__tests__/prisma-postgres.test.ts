/**
 * Gated Postgres persistence integration test (workstream 2).
 *
 * Proves the generated backend can persist and read through the REAL
 * Prisma/Postgres adapter — not the in-memory default. It:
 *   1. generates + installs the SocialFeed v1 project (`arch apply`),
 *   2. runs `prisma generate` + `prisma db push` against a real Postgres,
 *   3. runs a driver that wires the Prisma adapter via `setDb(createPrismaDb(...))`
 *      and exercises `createUser` → `createPost` → `findPostById` end to end,
 *   4. asserts the row round-trips through Postgres.
 *
 * SLOW + GATED. Runs only when BOTH are set:
 *   - ARCH_RUN_POSTGRES=1
 *   - DATABASE_URL=postgres://user:pass@host:5432/db   (a reachable Postgres)
 *
 * Locally:
 *   docker run --rm -d --name arch-pg -e POSTGRES_PASSWORD=arch \
 *     -e POSTGRES_USER=arch -e POSTGRES_DB=arch_app -p 5432:5432 postgres:16-alpine
 *   ARCH_RUN_POSTGRES=1 DATABASE_URL=postgres://arch:arch@localhost:5432/arch_app \
 *     pnpm --filter @arch/cli test -- src/__tests__/prisma-postgres.test.ts
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runApply } from "../commands/apply.js";
import { runInit } from "../commands/init.js";
import { runParse } from "../commands/parse.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const FIXTURE_BACKEND_ARCH = resolve(REPO_ROOT, "examples", "social-feed", "v1", "backend.arch");

const SHOULD_RUN = process.env.ARCH_RUN_POSTGRES === "1" && Boolean(process.env.DATABASE_URL);

const DRIVER = `
import { PrismaClient } from "@prisma/client";
import { setDb } from "./src/runtime/db.js";
import { createPrismaDb, type PrismaClientLike } from "./src/runtime/db-prisma.js";
import { createUser } from "./src/models/User.js";
import { createPost, findPostById } from "./src/models/Post.js";

async function main(): Promise<void> {
  const client = new PrismaClient();
  setDb(createPrismaDb(client as unknown as PrismaClientLike));
  const user = await createUser({ email: "u_" + Date.now() + "@example.com" });
  const post = await createPost({ authorId: user.id, body: "hello postgres" });
  const found = await findPostById(post.id);
  if (!found || found.body !== "hello postgres") {
    throw new Error("round-trip failed: " + JSON.stringify(found));
  }
  const count = await client.post.count();
  // eslint-disable-next-line no-console
  console.log("POSTGRES_OK " + JSON.stringify({ id: post.id, persistedBody: found.body, count }));
  await client.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
`;

function runInProject(projectRoot: string, args: string[], extraEnv: Record<string, string> = {}) {
  const proc = spawnSync("pnpm", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  return proc;
}

describe("generated SocialFeed persists through Prisma/Postgres (gated)", () => {
  it.skipIf(!SHOULD_RUN)(
    "createUser → createPost → findPostById round-trips through a real Postgres",
    { timeout: 480_000 },
    async () => {
      const databaseUrl = process.env.DATABASE_URL!;
      const projectRoot = mkdtempSync(resolve(tmpdir(), "arch-cli-prisma-pg-"));
      try {
        copyFileSync(FIXTURE_BACKEND_ARCH, resolve(projectRoot, "backend.arch"));
        const metadataDir = resolve(projectRoot, ".arch");

        expect(await runInit(["--cwd", projectRoot, "--template", "social-feed"])).toBe(0);
        expect(
          await runParse([resolve(projectRoot, "backend.arch"), "--emit-ir", "--metadata-dir", metadataDir]),
        ).toBe(0);
        // apply installs deps + runs the hermetic (in-memory) verify.
        expect(await runApply(["--cwd", projectRoot, "--metadata-dir", metadataDir])).toBe(0);

        // Generate the Prisma client + create tables in the real database.
        const gen = runInProject(projectRoot, ["exec", "prisma", "generate"], { DATABASE_URL: databaseUrl });
        expect(gen.status, `prisma generate failed:\n${gen.stdout}\n${gen.stderr}`).toBe(0);

        const push = runInProject(
          projectRoot,
          ["exec", "prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
          { DATABASE_URL: databaseUrl },
        );
        expect(push.status, `prisma db push failed:\n${push.stdout}\n${push.stderr}`).toBe(0);

        // Exercise the real adapter.
        writeFileSync(resolve(projectRoot, "pg-driver.ts"), DRIVER);
        const driver = runInProject(projectRoot, ["exec", "tsx", "pg-driver.ts"], {
          DATABASE_URL: databaseUrl,
          ARCH_DB: "prisma",
        });
        expect(driver.status, `driver failed:\n${driver.stdout}\n${driver.stderr}`).toBe(0);
        expect(driver.stdout).toContain("POSTGRES_OK");
        expect(driver.stdout).toContain('"persistedBody":"hello postgres"');
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    },
  );
});
