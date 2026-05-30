#!/usr/bin/env tsx
/**
 * End-to-end harness for the V1 prototype loop.
 *
 * This intentionally drives the real CLI transcript instead of reaching into
 * package internals:
 *
 *   1. create a clean temp project and copy SocialFeed v1 backend.arch
 *   2. arch init, parse, plan, apply with verification enabled
 *   3. run generated pnpm typecheck and pnpm test explicitly
 *   4. replace backend.arch with v2 visibility
 *   5. arch plan, apply with verification enabled
 *   6. run generated pnpm typecheck and pnpm test explicitly
 *   7. arch check (expect clean)
 *   8. induce drift (delete a generated guarantee test) -> arch check reports it
 *   9. arch repair regenerates it -> arch check is clean again
 *
 * Set ARCH_E2E_KEEP_TMP=1 to keep the scratch directory after completion.
 */

import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI_ENTRY = resolve(REPO_ROOT, "packages/arch-cli/src/main.ts");
const V1_FIXTURE = resolve(REPO_ROOT, "examples/social-feed/v1/backend.arch");
const V2_FIXTURE = resolve(REPO_ROOT, "examples/social-feed/v2-visibility/backend.arch");
const KEEP_TMP = process.env["ARCH_E2E_KEEP_TMP"] === "1";

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

interface StepOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
}

interface LatestPlan {
  readonly schema_version?: string;
  readonly diff?: {
    readonly initial_generation?: boolean;
    readonly diffs?: readonly {
      readonly type?: string;
      readonly field_id?: string;
      readonly reason?: string;
    }[];
  };
}

class E2EError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

async function main(): Promise<number> {
  assertFixture(V1_FIXTURE);
  assertFixture(V2_FIXTURE);

  let projectDir: string | undefined;
  let completed = false;

  try {
    projectDir = await mkdtemp(resolve(tmpdir(), "arch-e2e-"));
    process.stdout.write(`e2e: scratch dir = ${projectDir}\n`);
    const commandEnv = await createPnpmShim(projectDir);

    await copyFile(V1_FIXTURE, resolve(projectDir, "backend.arch"));
    process.stdout.write("e2e: copied SocialFeed v1 backend.arch\n");

    await runArchStep("init project", ["init", "--cwd", projectDir], commandEnv);
    await runArchStep("parse v1 and emit IR", ["parse", "--emit-ir", resolve(projectDir, "backend.arch")], commandEnv);
    await assertFile(resolve(projectDir, ".arch", "ir.current.json"), "parse did not write .arch/ir.current.json");

    await runArchStep("plan v1 initial generation", ["plan", "--cwd", projectDir], commandEnv);
    await assertLatestPlan(projectDir, { initialGeneration: true });

    await runArchStep("apply v1 with verification", ["apply", "--cwd", projectDir], commandEnv);
    await assertGeneratedV1(projectDir);
    await assertFile(resolve(projectDir, ".arch", "ir.previous.json"), "apply did not promote .arch/ir.previous.json");

    await runGeneratedStep("generated v1 typecheck", ["typecheck"], projectDir, commandEnv);
    await runGeneratedStep("generated v1 tests", ["test"], projectDir, commandEnv);

    await copyFile(V2_FIXTURE, resolve(projectDir, "backend.arch"));
    process.stdout.write("e2e: replaced backend.arch with SocialFeed v2 visibility\n");

    await runArchStep("plan v2 visibility change", ["plan", "--cwd", projectDir], commandEnv);
    await assertLatestPlan(projectDir, {
      initialGeneration: false,
      expectedDiff: { type: "model_field_added", fieldId: "field:Post.visibility" },
    });

    await runArchStep("apply v2 visibility with verification", ["apply", "--cwd", projectDir], commandEnv);
    await assertGeneratedVisibility(projectDir);

    await runGeneratedStep("generated v2 typecheck", ["typecheck"], projectDir, commandEnv);
    await runGeneratedStep("generated v2 tests", ["test"], projectDir, commandEnv);

    await runArchStep("check final project drift", ["check", "--cwd", projectDir], commandEnv);

    // Steps H + I — demonstrate drift detection and bounded repair on the
    // verified project.
    await demonstrateDriftAndRepair(projectDir, commandEnv);

    completed = true;
    process.stdout.write("e2e: ok\n");
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`e2e: FAILED\n${message}\n`);
    if (projectDir && !KEEP_TMP) {
      process.stderr.write("e2e: scratch dir will be removed; rerun with ARCH_E2E_KEEP_TMP=1 to inspect it\n");
    } else if (projectDir) {
      process.stderr.write(`e2e: kept scratch dir ${projectDir}\n`);
    }
    return err instanceof E2EError ? err.exitCode : 1;
  } finally {
    if (projectDir && !KEEP_TMP) {
      await rm(projectDir, { recursive: true, force: true });
      if (completed) process.stdout.write(`e2e: removed scratch dir ${projectDir}\n`);
    }
  }
}

function assertFixture(path: string): void {
  if (!existsSync(path)) {
    throw new E2EError(`required fixture is missing: ${path}`, 70);
  }
}

async function assertFile(path: string, message: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new E2EError(`${message}\n  missing: ${path}`);
  }
}

async function assertGeneratedV1(projectDir: string): Promise<void> {
  const expected = [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "vitest.config.ts",
    "prisma/schema.prisma",
    "src/app.ts",
    "src/server.ts",
    "src/runtime/db.ts",
    "src/models/Post.ts",
    "src/validators/Post.ts",
    "src/workflows/CreatePost.ts",
    "src/routes/CreatePost.ts",
    "src/policies/sanitizeHtml.ts",
    "src/integrations/PushNotifier.ts",
    "tests/guarantees/no_unsanitized_html_persisted.CreatePost.test.ts",
    "tests/guarantees/notification_failure_does_not_rollback_post.CreatePost.test.ts",
  ];

  for (const rel of expected) {
    await assertFile(resolve(projectDir, rel), `v1 generation did not create expected artifact ${rel}`);
  }
}

async function demonstrateDriftAndRepair(
  projectDir: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const guaranteeTest = resolve(
    projectDir,
    "tests/guarantees/no_unsanitized_html_persisted.CreatePost.test.ts",
  );

  // Induce drift: a developer deletes a generated guarantee test.
  await rm(guaranteeTest);
  process.stdout.write("e2e: deleted a generated guarantee test to induce drift\n");

  const driftCheck = await runArchAllowingNonZero(
    "check detects induced drift",
    ["check", "--cwd", projectDir],
    env,
  );
  if (driftCheck.code !== 1) {
    throw new E2EError(`expected arch check to report drift (exit 1), got ${driftCheck.code}`);
  }
  const drift = JSON.parse(
    await readFile(resolve(projectDir, ".arch", "drift.json"), "utf8"),
  ) as { entries?: readonly { kind?: string }[] };
  if (!(drift.entries ?? []).some((e) => e.kind === "missing_generated_test")) {
    throw new E2EError("drift.json did not contain a missing_generated_test entry");
  }

  // Repair regenerates the missing test from the IR and re-verifies.
  await runArchStep("repair regenerates the missing test", ["repair", "--cwd", projectDir], env);
  if (!existsSync(guaranteeTest)) {
    throw new E2EError("repair did not regenerate the missing guarantee test");
  }

  // The project is clean again.
  await runArchStep("check after repair is clean", ["check", "--cwd", projectDir], env);
}

async function assertGeneratedVisibility(projectDir: string): Promise<void> {
  const postModel = await readFile(resolve(projectDir, "src/models/Post.ts"), "utf8");
  const validator = await readFile(resolve(projectDir, "src/validators/Post.ts"), "utf8");
  const prisma = await readFile(resolve(projectDir, "prisma/schema.prisma"), "utf8");

  if (!postModel.includes("visibility")) {
    throw new E2EError("v2 apply did not update src/models/Post.ts with Post.visibility");
  }
  if (!validator.includes("visibility")) {
    throw new E2EError("v2 apply did not update src/validators/Post.ts with Post.visibility");
  }
  if (!prisma.includes("visibility")) {
    throw new E2EError("v2 apply did not update prisma/schema.prisma with Post.visibility");
  }
}

async function assertLatestPlan(
  projectDir: string,
  expectation: {
    readonly initialGeneration: boolean;
    readonly expectedDiff?: { readonly type: string; readonly fieldId: string };
  },
): Promise<void> {
  const path = resolve(projectDir, ".arch", "plans", "latest.plan.json");
  await assertFile(path, "arch plan did not write .arch/plans/latest.plan.json");

  const plan = JSON.parse(await readFile(path, "utf8")) as LatestPlan;
  if (plan.schema_version !== "arch.plan.v1") {
    throw new E2EError(`latest plan has unexpected schema_version: ${String(plan.schema_version)}`);
  }
  if (plan.diff?.initial_generation !== expectation.initialGeneration) {
    throw new E2EError(
      `latest plan initial_generation=${String(plan.diff?.initial_generation)}; expected ${String(expectation.initialGeneration)}`,
    );
  }

  const expectedDiff = expectation.expectedDiff;
  if (!expectedDiff) return;
  const diffs = plan.diff?.diffs ?? [];
  const found = diffs.some(
    (diff) =>
      diff.type === expectedDiff.type &&
      diff.field_id === expectedDiff.fieldId,
  );
  if (!found) {
    const seen = diffs.map((diff) => `${String(diff.type)}:${String(diff.field_id ?? diff.reason ?? "")}`).join(", ");
    throw new E2EError(
      `latest plan did not include ${expectedDiff.type}(${expectedDiff.fieldId})\n` +
        `  seen diffs: ${seen || "<none>"}`,
    );
  }
}

async function createPnpmShim(projectDir: string): Promise<NodeJS.ProcessEnv> {
  const binDir = resolve(projectDir, ".arch-e2e-bin");
  const shimPath = resolve(binDir, "pnpm");
  const pnpmCli = process.env["npm_execpath"];
  const command = pnpmCli && existsSync(pnpmCli)
    ? `${shellQuote(process.execPath)} ${shellQuote(pnpmCli)}`
    : "corepack pnpm@9.0.0";

  await mkdir(binDir, { recursive: true });
  await writeFile(shimPath, `#!/usr/bin/env sh\nexec ${command} "$@"\n`, "utf8");
  await chmod(shimPath, 0o755);

  process.stdout.write(`e2e: pinned nested pnpm via ${shimPath}\n`);
  return {
    PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  };
}

async function runArchStep(name: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return await runRequiredStep(
    name,
    "pnpm",
    ["exec", "tsx", CLI_ENTRY, ...args],
    { cwd: REPO_ROOT, env },
  );
}

async function runGeneratedStep(
  name: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return await runRequiredStep(name, "pnpm", args, { cwd, env });
}

/** Run an arch CLI step that is EXPECTED to exit non-zero (e.g. drift found). */
async function runArchAllowingNonZero(
  name: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<RunResult> {
  process.stdout.write(`\n== ${name} ==\n`);
  process.stdout.write(`$ ${formatCommand("pnpm", ["exec", "tsx", CLI_ENTRY, ...args])}\n`);
  return await run("pnpm", ["exec", "tsx", CLI_ENTRY, ...args], { cwd: REPO_ROOT, env });
}

async function runRequiredStep(
  name: string,
  command: string,
  args: readonly string[],
  options: StepOptions,
): Promise<RunResult> {
  process.stdout.write(`\n== ${name} ==\n`);
  process.stdout.write(`$ ${formatCommand(command, args)}\n`);

  const result = await run(command, args, options);
  if (result.code !== 0) {
    const details = [
      `step failed: ${name}`,
      `  cwd: ${options.cwd}`,
      `  command: ${formatCommand(command, args)}`,
      `  exit: ${result.code}`,
      result.error ? `  spawn error: ${result.error.message}` : "",
      result.stdout.trim() ? `\nstdout:\n${result.stdout.trimEnd()}` : "",
      result.stderr.trim() ? `\nstderr:\n${result.stderr.trimEnd()}` : "",
    ].filter(Boolean).join("\n");
    throw new E2EError(details);
  }
  return result;
}

function run(command: string, args: readonly string[], options: StepOptions): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let error: Error | undefined;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (err) => {
      error = err;
    });
    child.on("close", (code) => {
      resolveRun({ code: code ?? -1, stdout, stderr, ...(error ? { error } : {}) });
    });
  });
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

main().then((code) => process.exit(code));
