#!/usr/bin/env tsx
/**
 * Multi-example end-to-end harness (Technical V1.1).
 *
 * For EACH of three distinct backend specs (SocialFeed, TaskTracker, Inventory)
 * it drives the real CLI through the full loop from a CLEAN temp dir:
 *
 *   1. arch init / parse --emit-ir / plan (initial) / apply (install+verify+promote)
 *   2. generated `pnpm typecheck` + `pnpm test` (explicit)
 *   3. edit spec to v2, arch plan (incremental typed diff)
 *   4. arch apply --agent deterministic  (spec evolution applied through the
 *      CONSTRAINED AgentOrchestrator boundary; writes .arch/agent-runs records)
 *   5. generated typecheck + test again
 *   6. arch check (clean) -> induce drift (delete a generated test) ->
 *      arch check (reports) -> arch repair -> arch check (clean)
 *
 * Prints a per-example evidence summary (IR hashes, generated file count,
 * agent run-record count). Set ARCH_E2E_KEEP_TMP=1 to keep scratch dirs.
 */

import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI_ENTRY = resolve(REPO_ROOT, "packages/arch-cli/src/main.ts");
const KEEP_TMP = process.env["ARCH_E2E_KEEP_TMP"] === "1";

interface Example {
  readonly name: string;
  readonly v1: string;
  readonly v2: string;
  readonly model: string; // generated model file that the v2 field lands in
  readonly newField: string; // field added in v2
  readonly driftTest: string; // a generated test deleted to induce drift
  readonly expectFiles: readonly string[];
}

const EXAMPLES: readonly Example[] = [
  {
    name: "social-feed",
    v1: "examples/social-feed/v1/backend.arch",
    v2: "examples/social-feed/v2-visibility/backend.arch",
    model: "src/models/Post.ts",
    newField: "visibility",
    driftTest: "tests/models/Post.test.ts",
    expectFiles: ["prisma/schema.prisma", "src/models/Post.ts", "src/routes/CreatePost.ts", "src/workflows/CreatePost.ts"],
  },
  {
    name: "task-tracker",
    v1: "examples/task-tracker/v1/backend.arch",
    v2: "examples/task-tracker/v2-priority/backend.arch",
    model: "src/models/Task.ts",
    newField: "priority",
    driftTest: "tests/models/Task.test.ts",
    expectFiles: ["prisma/schema.prisma", "src/models/Task.ts", "src/routes/CreateTask.ts", "src/workflows/CreateTask.ts"],
  },
  {
    name: "inventory",
    v1: "examples/inventory/v1/backend.arch",
    v2: "examples/inventory/v2-reorder/backend.arch",
    model: "src/models/Item.ts",
    newField: "reorderLevel",
    driftTest: "tests/models/Item.test.ts",
    expectFiles: ["prisma/schema.prisma", "src/models/Item.ts", "src/models/Warehouse.ts", "src/routes/CreateItem.ts"],
  },
];

interface Evidence {
  readonly name: string;
  readonly tmp: string;
  readonly v1Hash: string;
  readonly v2Hash: string;
  readonly generatedFileCount: number;
  readonly agentRunRecords: number;
}

class E2EError extends Error {}

async function main(): Promise<number> {
  const evidence: Evidence[] = [];
  for (const ex of EXAMPLES) {
    process.stdout.write(`\n████ EXAMPLE: ${ex.name} ████\n`);
    evidence.push(await runExample(ex));
  }

  process.stdout.write("\n================ EVIDENCE SUMMARY ================\n");
  for (const e of evidence) {
    process.stdout.write(
      `${e.name}: v1=${e.v1Hash.slice(0, 12)} v2=${e.v2Hash.slice(0, 12)} ` +
        `generatedFiles=${e.generatedFileCount} agentRunRecords=${e.agentRunRecords}\n`,
    );
  }
  process.stdout.write("examples-e2e: ALL EXAMPLES PASSED\n");
  return 0;
}

async function runExample(ex: Example): Promise<Evidence> {
  const dir = await mkdtemp(resolve(tmpdir(), `arch-ex-${ex.name}-`));
  const env = await createPnpmShim(dir);
  let completed = false;
  try {
    await copyFile(resolve(REPO_ROOT, ex.v1), resolve(dir, "backend.arch"));
    await archStep(ex.name, "init", ["init", "--cwd", dir], env);
    await archStep(ex.name, "parse v1", ["parse", "--emit-ir", resolve(dir, "backend.arch"), "--cwd", dir], env);
    const v1Hash = await readIrHash(dir, "ir.current.json");
    await archStep(ex.name, "plan v1", ["plan", "--cwd", dir], env);
    await archStep(ex.name, "apply v1 (install+verify)", ["apply", "--cwd", dir], env);
    await assertFile(resolve(dir, ".arch/ir.previous.json"), `${ex.name}: apply v1 did not promote ir.previous`);
    for (const f of ex.expectFiles) {
      await assertFile(resolve(dir, f), `${ex.name}: missing generated artifact ${f}`);
    }
    await genStep(ex.name, "generated v1 typecheck", ["typecheck"], dir, env);
    await genStep(ex.name, "generated v1 tests", ["test"], dir, env);

    // Spec evolution applied through the constrained agent.
    await copyFile(resolve(REPO_ROOT, ex.v2), resolve(dir, "backend.arch"));
    await archStep(ex.name, "parse v2", ["parse", "--emit-ir", resolve(dir, "backend.arch"), "--cwd", dir], env);
    const v2Hash = await readIrHash(dir, "ir.current.json");
    await archStep(ex.name, "plan v2", ["plan", "--cwd", dir], env);
    await archStep(
      ex.name,
      "apply v2 via constrained agent",
      ["apply", "--cwd", dir, "--agent", "deterministic"],
      env,
    );
    const model = await readFile(resolve(dir, ex.model), "utf8");
    if (!model.includes(ex.newField)) {
      throw new E2EError(`${ex.name}: v2 apply did not add field ${ex.newField} to ${ex.model}`);
    }
    const agentRunRecords = await countAgentRunRecords(dir);
    if (agentRunRecords === 0) {
      throw new E2EError(`${ex.name}: agent apply wrote no .arch/agent-runs records`);
    }
    await genStep(ex.name, "generated v2 typecheck", ["typecheck"], dir, env);
    await genStep(ex.name, "generated v2 tests", ["test"], dir, env);

    // Drift + repair.
    await archStep(ex.name, "check (clean)", ["check", "--cwd", dir], env);
    // Assert the drift target exists BEFORE deleting it: a generator layout
    // change would otherwise make `rm({force:true})` a silent no-op and the
    // drift assertion below would pass for the wrong reason.
    await assertFile(resolve(dir, ex.driftTest), `${ex.name}: expected drift target ${ex.driftTest} to exist before deletion`);
    await rm(resolve(dir, ex.driftTest));
    const drift = await archAllowNonZero(ex.name, "check (drift)", ["check", "--cwd", dir], env);
    if (drift.code === 0) throw new E2EError(`${ex.name}: arch check did not report deleted ${ex.driftTest}`);
    await archStep(ex.name, "repair", ["repair", "--cwd", dir], env);
    await assertFile(resolve(dir, ex.driftTest), `${ex.name}: repair did not regenerate ${ex.driftTest}`);
    await archStep(ex.name, "check (clean after repair)", ["check", "--cwd", dir], env);

    const generatedFileCount = await countFiles(resolve(dir, "src"));
    completed = true;
    return { name: ex.name, tmp: dir, v1Hash, v2Hash, generatedFileCount, agentRunRecords };
  } finally {
    if (!KEEP_TMP) {
      await rm(dir, { recursive: true, force: true });
    } else if (completed) {
      process.stdout.write(`examples-e2e: kept ${dir}\n`);
    }
  }
}

async function readIrHash(dir: string, file: string): Promise<string> {
  const ir = JSON.parse(await readFile(resolve(dir, ".arch", file), "utf8")) as { canonical_hash: string };
  return ir.canonical_hash;
}

async function countAgentRunRecords(dir: string): Promise<number> {
  const runsDir = resolve(dir, ".arch/agent-runs");
  if (!existsSync(runsDir)) return 0;
  let total = 0;
  for (const name of await readdir(runsDir)) {
    if (!name.endsWith(".json")) continue;
    const f = JSON.parse(await readFile(resolve(runsDir, name), "utf8")) as { records?: unknown[] };
    total += f.records?.length ?? 0;
  }
  return total;
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += await countFiles(resolve(dir, e.name));
    else n += 1;
  }
  return n;
}

async function assertFile(path: string, message: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new E2EError(`${message}\n  missing: ${path}`);
  }
}

async function createPnpmShim(projectDir: string): Promise<NodeJS.ProcessEnv> {
  const binDir = resolve(projectDir, ".arch-e2e-bin");
  const shimPath = resolve(binDir, "pnpm");
  const pnpmCli = process.env["npm_execpath"];
  const command =
    pnpmCli && existsSync(pnpmCli) ? `${shellQuote(process.execPath)} ${shellQuote(pnpmCli)}` : "corepack pnpm@9.0.0";
  await mkdir(binDir, { recursive: true });
  await writeFile(shimPath, `#!/usr/bin/env sh\nexec ${command} "$@"\n`, "utf8");
  await chmod(shimPath, 0o755);
  return { PATH: `${binDir}:${process.env["PATH"] ?? ""}`, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function archStep(ex: string, name: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return required(`${ex}: ${name}`, "pnpm", ["exec", "tsx", CLI_ENTRY, ...args], REPO_ROOT, env);
}

function genStep(ex: string, name: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return required(`${ex}: ${name}`, "pnpm", args, cwd, env);
}

function archAllowNonZero(ex: string, name: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  process.stdout.write(`\n== ${ex}: ${name} ==\n`);
  return run("pnpm", ["exec", "tsx", CLI_ENTRY, ...args], REPO_ROOT, env);
}

async function required(name: string, cmd: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  process.stdout.write(`\n== ${name} ==\n`);
  const r = await run(cmd, args, cwd, env);
  if (r.code !== 0) {
    throw new E2EError(
      [`step failed: ${name}`, `  exit: ${r.code}`, r.stdout.trim() && `stdout:\n${r.stdout}`, r.stderr.trim() && `stderr:\n${r.stderr}`]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return r;
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
      process.stdout.write(c);
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
      process.stderr.write(c);
    });
    child.on("close", (code) => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`examples-e2e: FAILED\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
